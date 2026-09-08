import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChangePlan, Job, Library, LibraryPatch } from "@nestify/shared";
import { asJobId, asLibraryId, type JobId } from "@nestify/shared";
import { loadAppConfig } from "../config/load.ts";
import { openDatabase, type DatabaseLogFunction } from "../db/open.ts";
import { createJob, listJobOps, listJobs, updateJobStatus } from "../db/repos/jobs.ts";
import {
  countEntries,
  createLibrary,
  deleteLibrary,
  getEntryById,
  getLibrary,
  membershipLibraryIdFor,
  listEntries,
  listLibraries,
  type RuleSetCreateInput,
  type RuleSetPatch,
  type RuleSetRecord,
  updateLibrary,
} from "../db/repos/index.ts";
import { ensureAppDirs, resolveAppPaths } from "../layout/index.ts";
import type {
  HashStrategy,
  KeepStrategy,
  ModuleContext,
  OrganizeScope,
  ScanProgress,
  ThumbnailRequest,
} from "../modules/types.ts";
import { executePlan, rollbackPlan, type PlanExecuteResult, type PlanRollbackResult } from "../plan/executor.ts";
import { runScan } from "../scan/indexer.ts";
import { ALL_LIBRARIES_ID, searchEntries, type SearchEntriesRequest } from "../search/index.ts";
import { analyzeDuplicates, type RuntimeDuplicateAnalyzeResult } from "../duplicates/analyzer.ts";
import {
  persistDuplicateAnalysis,
  type DuplicateAnalysisPersistenceSummary,
} from "../duplicates/persistence.ts";
import {
  THUMBNAIL_GENERATOR_VERSION,
  ThumbnailCacheService,
} from "../preview/thumbnail-service.ts";
import {
  RuntimePauseGate,
  defaultAppDataRoot,
  defaultBundledConfigDir,
  isActiveScan,
  isWithinRoot,
  runStartupStep,
  thumbnailPriority,
} from "./runtime-helpers.ts";
import {
  cloneRuntimeRuleSet,
  createRuntimeRuleSet,
  deleteRuntimeRuleSet,
  enableRuntimeRuleSet,
  exportRuntimeRuleSet,
  getRuntimeRuleSet,
  importRuntimeRuleSet,
  listRuntimeRuleSets,
  previewRuntimeRename,
  previewRuntimeRules,
  prioritizeRuntimeRuleSet,
  updateRuntimeRuleSet,
} from "./runtime-rules.ts";
import type { CollisionStrategy, MatchTree } from "@nestify/rules";

export interface RuntimeOptions {
  appDataRoot?: string;
  bundledConfigDir?: string;
  onStartupLog?: DatabaseLogFunction;
}

export class NestifyRuntime {
  readonly paths;
  readonly config;
  readonly db: DatabaseSync;
  private scanProgress: ScanProgress = {
    phase: "idle",
    filesScanned: 0,
    dirsScanned: 0,
    bytesScanned: 0,
    errors: 0,
  };
  private scanAbort: AbortController | null = null;
  private scanGate: RuntimePauseGate | null = null;
  private activeScan: { jobId: JobId; libraryId: string; status: Job["status"] } | null = null;
  private progressListeners = new Set<(progress: ScanProgress) => void>();
  private thumbnailService: ThumbnailCacheService | null = null;

  constructor(options: RuntimeOptions = {}) {
    const log = options.onStartupLog;
    const appDataRoot = runStartupStep(log, "runtime.app-data-root.resolve", () =>
      options.appDataRoot ?? defaultAppDataRoot(),
    );
    this.paths = runStartupStep(log, "runtime.paths.resolve", () => resolveAppPaths(appDataRoot), {
      appDataRoot,
    });
    runStartupStep(log, "runtime.directories.ensure", () => ensureAppDirs(this.paths));
    this.config = runStartupStep(
      log,
      "runtime.config.load",
      () =>
        loadAppConfig({
          appDataRoot,
          bundledConfigDir: options.bundledConfigDir ?? defaultBundledConfigDir(),
        }),
      { appDataRoot },
    );
    const dbPath = process.env.NESTIFY_DB_PATH || this.paths.dbPath;
    this.db = runStartupStep(log, "runtime.db.open", () => openDatabase(dbPath, log), { dbPath });
  }

  onScanProgress(listener: (progress: ScanProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  listLibraries() {
    return listLibraries(this.db);
  }

  addLibrary(input: { name: string; roots: string[] }): Library {
    return createLibrary(this.db, {
      name: input.name,
      roots: input.roots,
    });
  }

  updateLibrary(input: { id: string; patch: LibraryPatch }): Library {
    if (this.activeScan?.libraryId === input.id && isActiveScan(this.activeScan)) {
      throw new Error("cannot update a library while its scan is active");
    }
    return updateLibrary(this.db, input.id, input.patch);
  }

  removeLibrary(libraryId: string): void {
    if (this.activeScan?.libraryId === libraryId && isActiveScan(this.activeScan)) {
      throw new Error("cannot remove a library while its scan is active");
    }
    deleteLibrary(this.db, libraryId);
  }

  listLibraryEntries(libraryId: string) {
    return listEntries(this.db, libraryId);
  }

  libraryStats(libraryId: string) {
    return countEntries(this.db, libraryId);
  }

  startScan(libraryId: string): { job: { id: string; status: string } } {
    const library = getLibrary(this.db, libraryId);
    if (!library) throw new Error(`library not found: ${libraryId}`);
    if (isActiveScan(this.activeScan)) {
      if (this.activeScan.libraryId === libraryId) {
        return { job: { id: this.activeScan.jobId, status: this.activeScan.status } };
      }
      throw new Error(`another scan is active: ${this.activeScan.libraryId}`);
    }
    const jobId = asJobId(randomUUID());
    createJob(this.db, {
      id: jobId,
      libraryId: asLibraryId(libraryId),
      kind: "scan",
      status: "running",
      startedAt: Date.now(),
    });
    this.activeScan = { jobId, libraryId, status: "running" };
    this.scanProgress = {
      phase: "walk",
      filesScanned: 0,
      dirsScanned: 0,
      bytesScanned: 0,
      errors: 0,
    };
    this.scanAbort = new AbortController();
    this.scanGate = new RuntimePauseGate();
    this.emitProgress(this.scanProgress);
    void this.runScanJob(library, jobId);
    return { job: { id: jobId, status: "running" } };
  }

  async scanLibrary(libraryId: string) {
    const started = this.startScan(libraryId);
    while (this.activeScan?.jobId === started.job.id && isActiveScan(this.activeScan)) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return {
      jobId: started.job.id,
      result: {
        filesScanned: this.scanProgress.filesScanned,
        dirsScanned: this.scanProgress.dirsScanned,
        errors: this.scanProgress.errors,
      },
      progress: this.scanProgress,
    };
  }

  private async runScanJob(library: Library, jobId: JobId): Promise<void> {
    try {
      const result = await runScan(
        this.db,
        { roots: library.roots, incremental: true, hashStrategy: library.hashStrategy },
        {
          libraryId: library.id,
          abortSignal: this.scanAbort?.signal,
          pauseGate: this.scanGate ?? undefined,
          onProgress: (progress) => {
            this.scanProgress = { ...progress, paused: this.scanGate?.isPaused() ?? false };
            this.emitProgress(this.scanProgress);
          },
        },
      );
      const status = this.scanProgress.phase === "cancelled" ? "cancelled" : "completed";
      updateJobStatus(this.db, jobId, status, {
        finishedAt: Date.now(),
        stats: result,
      });
      this.activeScan = { jobId, libraryId: library.id, status };
      this.scanAbort = null;
      this.scanGate = null;
      if (this.scanProgress.phase === "walk" || this.scanProgress.phase === "upsert") {
        this.scanProgress = { ...this.scanProgress, phase: "idle" };
      }
      this.emitProgress(this.scanProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateJobStatus(this.db, jobId, "failed", { finishedAt: Date.now(), error: message });
      this.activeScan = { jobId, libraryId: library.id, status: "failed" };
      this.scanAbort = null;
      this.scanGate = null;
      this.scanProgress = { ...this.scanProgress, phase: "idle", errors: this.scanProgress.errors + 1 };
      this.emitProgress(this.scanProgress);
    }
  }

  getScanProgress() {
    const active = isActiveScan(this.activeScan) ? this.activeScan : null;
    return {
      ...this.scanProgress,
      jobId: active?.jobId ?? null,
      libraryId: active?.libraryId ?? null,
      jobStatus: active?.status ?? null,
    };
  }

  getActiveScanJob() {
    return this.activeScan;
  }

  pauseScan(jobId: string): { job: { id: string; status: string } } {
    this.assertControllableScan(jobId, ["running"]);
    this.scanGate?.pause();
    this.activeScan!.status = "paused";
    updateJobStatus(this.db, asJobId(jobId), "paused");
    this.scanProgress = { ...this.scanProgress, paused: true };
    this.emitProgress(this.scanProgress);
    return { job: { id: jobId, status: "paused" } };
  }

  resumeScan(jobId: string): { job: { id: string; status: string } } {
    this.assertControllableScan(jobId, ["paused"]);
    this.scanGate?.resume();
    this.activeScan!.status = "running";
    updateJobStatus(this.db, asJobId(jobId), "running");
    this.scanProgress = { ...this.scanProgress, paused: false };
    this.emitProgress(this.scanProgress);
    return { job: { id: jobId, status: "running" } };
  }

  cancelScan(jobId: string): { job: { id: string; status: string } } {
    this.assertControllableScan(jobId, ["running", "paused"]);
    this.activeScan!.status = "cancelling";
    updateJobStatus(this.db, asJobId(jobId), "cancelling");
    this.scanGate?.cancel();
    this.scanAbort?.abort();
    this.scanProgress = { ...this.scanProgress, paused: false };
    this.emitProgress(this.scanProgress);
    return { job: { id: jobId, status: "cancelling" } };
  }

  search(
    libraryId: string,
    text: string,
    limitOrOptions: number | Omit<SearchEntriesRequest, "libraryId" | "text"> = {},
  ) {
    const options =
      typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
    return searchEntries(this.db, { ...options, libraryId, text });
  }

  listRuleSets(): RuleSetRecord[] {
    return listRuntimeRuleSets(this.db);
  }

  getRuleSet(id: string): RuleSetRecord | undefined {
    return getRuntimeRuleSet(this.db, id);
  }

  createRuleSet(input: RuleSetCreateInput): RuleSetRecord {
    return createRuntimeRuleSet(this.db, input);
  }

  updateRuleSet(id: string, patch: RuleSetPatch): RuleSetRecord {
    return updateRuntimeRuleSet(this.db, id, patch);
  }

  deleteRuleSet(id: string): void {
    deleteRuntimeRuleSet(this.db, id);
  }

  setRuleSetEnabled(id: string, enabled: boolean): RuleSetRecord {
    return enableRuntimeRuleSet(this.db, id, enabled);
  }

  setRuleSetPriority(id: string, priority: number): RuleSetRecord {
    return prioritizeRuntimeRuleSet(this.db, id, priority);
  }

  cloneRuleSet(
    sourceId: string,
    options: { name?: string; priority?: number; enabled?: boolean } = {},
  ): RuleSetRecord {
    return cloneRuntimeRuleSet(this.db, sourceId, options);
  }

  exportRuleSet(id: string): string {
    return exportRuntimeRuleSet(this.db, id);
  }

  importRuleSet(yaml: string): RuleSetRecord {
    return importRuntimeRuleSet(this.db, yaml);
  }

  previewRules(input: {
    libraryId: string;
    ruleSetId: string;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
  }): ChangePlan {
    return previewRuntimeRules(this.db, this.paths.quarantineDir, input);
  }

  previewRename(input: {
    libraryId: string;
    template: string;
    match?: MatchTree;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
  }): ChangePlan {
    return previewRuntimeRename(this.db, input);
  }

  async executePlan(input: {
    libraryId: string;
    plan: ChangePlan;
    selectedOps?: number[];
  }): Promise<PlanExecuteResult> {
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error(`library not found: ${input.libraryId}`);
    if (input.plan.libraryId !== input.libraryId) throw new Error("plan does not belong to library");
    if (input.plan.status !== "draft") throw new Error("plan is not executable");
    if (input.plan.dryRun !== true) throw new Error("only preview plans can be executed");
    const result = await executePlan({
      db: this.db,
      plan: input.plan,
      library: { id: library.id, roots: library.roots },
      selectedOps: input.selectedOps,
      quarantineDir: this.paths.quarantineDir,
    });
    await this.refreshAfterPlan(library.id);
    return result;
  }

  async rollbackPlan(jobId: string): Promise<PlanRollbackResult> {
    const job = this.db
      .prepare(`SELECT library_id FROM jobs WHERE id = ?`)
      .get(jobId) as { library_id: string | null } | undefined;
    if (!job?.library_id) throw new Error(`job not found: ${jobId}`);
    const result = await rollbackPlan(this.db, jobId);
    await this.refreshAfterPlan(job.library_id);
    return result;
  }

  listJobs(input: { libraryId?: string; limit?: number } = {}) {
    return listJobs(this.db, input);
  }

  listJobOps(jobId: string) {
    return listJobOps(this.db, jobId);
  }

  async analyzeDuplicates(input: {
    libraryId: string;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    hashStrategy?: Exclude<HashStrategy, "off">;
    keepStrategy?: KeepStrategy;
  }): Promise<RuntimeDuplicateAnalyzeResult & { persistence: DuplicateAnalysisPersistenceSummary }> {
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error(`library not found: ${input.libraryId}`);
    const result = await analyzeDuplicates({
      entries: listEntries(this.db, input.libraryId),
      quarantineDir: this.paths.quarantineDir,
      scope: input.scope,
      entryIds: input.entryIds,
      directory: input.directory,
      hashStrategy: input.hashStrategy,
      keepStrategy: input.keepStrategy ?? "newest",
    });
    const persistence = persistDuplicateAnalysis(this.db, {
      libraryId: input.libraryId,
      result,
    });
    return {
      ...result,
      plan: { ...result.plan, libraryId: asLibraryId(input.libraryId) },
      persistence,
    };
  }

  async getThumbnail(
    request: ThumbnailRequest,
    ctx: Pick<ModuleContext, "libraryId" | "abortSignal">,
  ): Promise<{
    entryId: string;
    cachePath?: string;
    mime?: string;
    fallbackIcon?: string;
  }> {
    const entry = getEntryById(this.db, request.entryId);
    const libraryId = membershipLibraryIdFor(this.db, entry?.id ?? request.entryId, ctx.libraryId === ALL_LIBRARIES_ID ? undefined : ctx.libraryId);
    if (!entry || !libraryId || entry.tombstone) {
      throw new Error(`entry not found in library: ${request.entryId}`);
    }
    const library = getLibrary(this.db, libraryId);
    if (!library) throw new Error(`library not found: ${libraryId}`);
    if (!library.roots.some((root) => isWithinRoot(entry.path, root))) {
      throw new Error("entry is outside its library roots");
    }
    if (entry.kind !== "image" || (request.kind && request.kind !== "image")) {
      throw new Error(`thumbnail kind is not supported: ${request.kind ?? entry.kind}`);
    }

    const result = await this.getThumbnailService().getThumbnail(
      {
        entryId: entry.id,
        sourcePath: entry.path,
        sizeBytes: entry.size,
        mtime: entry.mtime,
        generatorVersion: THUMBNAIL_GENERATOR_VERSION,
      },
      {
        priority: thumbnailPriority(request.priority),
        signal: ctx.abortSignal,
      },
    );
    return {
      entryId: result.entryId,
      cachePath: result.cachePath,
      mime: result.mime,
    };
  }

  async cancelThumbnail(entryId: string): Promise<boolean> {
    return this.thumbnailService?.cancel(entryId) ?? false;
  }

  close() {
    this.progressListeners.clear();
    this.db.close();
  }

  private emitProgress(progress: ScanProgress): void {
    for (const listener of this.progressListeners) listener(progress);
  }

  private getThumbnailService(): ThumbnailCacheService {
    this.thumbnailService ??= new ThumbnailCacheService({
      db: this.db,
      thumbnailsDir: this.paths.thumbnailsDir,
      concurrency: this.config.workers.thumbnailConcurrency.localSsd,
      thumbnailSize: this.config.preview.thumbnailSize,
      format: this.config.preview.format,
    });
    return this.thumbnailService;
  }

  private assertControllableScan(jobId: string, statuses: Job["status"][]): void {
    if (this.activeScan?.jobId !== jobId || !statuses.includes(this.activeScan.status)) {
      throw new Error(`scan job is not ${statuses.join("/")}: ${jobId}`);
    }
  }

  private async refreshAfterPlan(libraryId: string): Promise<void> {
    const library = getLibrary(this.db, libraryId);
    if (!library) return;
    await runScan(
      this.db,
      { roots: library.roots, incremental: true, hashStrategy: library.hashStrategy },
      { libraryId, onProgress: (progress) => this.emitProgress(progress) },
    );
  }
}
