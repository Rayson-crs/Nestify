import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChangePlan, Job, Library, LibraryPatch } from "@nestify/shared";
import { asJobId, asLibraryId, type JobId } from "@nestify/shared";
import { loadAppConfig } from "../config/load.ts";
import { maintainDatabase } from "../db/maintenance.ts";
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
import { runScan } from "../scan/indexer.ts";
import { ALL_LIBRARIES_ID, listDirectoryChildren, searchEntries, type SearchEntriesRequest } from "../search/index.ts";
import { ChangeProcessor, recoverProcessingChanges, startLibraryWatcher, type LibraryWatcher } from "../sync/index.ts";
import { ensureInitialReconciliation, updateSyncState } from "../db/repos/sync.ts";
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
import {
  analyzeRuntimeDuplicates,
  executeRuntimePlan,
  refreshRuntimeLibrary,
  rollbackRuntimePlan,
} from "./runtime-plans.ts";
import type { CollisionStrategy, MatchTree } from "@nestify/rules";

export interface RuntimeOptions {
  appDataRoot?: string;
  bundledConfigDir?: string;
  onStartupLog?: DatabaseLogFunction;
  scanConcurrency?: number;
  fileSync?: boolean;
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
  private scanConcurrency: number;
  private readonly syncResources = new Map<string, { watcher: LibraryWatcher; processor: ChangeProcessor }>();
  private readonly fileSyncEnabled: boolean;
  private closed = false;

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
    this.scanConcurrency = Math.max(
      1,
      Math.min(
        32,
        Math.trunc(options.scanConcurrency ?? this.config.workers.scanConcurrency.localSsd),
      ),
    );
    this.fileSyncEnabled = options.fileSync !== false;
    if (this.fileSyncEnabled) {
      recoverProcessingChanges(this.db);
      for (const library of listLibraries(this.db)) {
        this.startLibrarySync(library);
      }
    }
  }

  setScanConcurrency(concurrency: number): void {
    this.scanConcurrency = Math.max(1, Math.min(32, Math.trunc(Number(concurrency) || 1)));
  }

  onScanProgress(listener: (progress: ScanProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  listLibraries() {
    return listLibraries(this.db);
  }

  addLibrary(input: { name: string; roots: string[] }): Library {
    const library = createLibrary(this.db, {
      name: input.name,
      roots: input.roots,
    });
    this.startLibrarySync(library);
    return library;
  }

  updateLibrary(input: { id: string; patch: LibraryPatch }): Library {
    if (this.activeScan?.libraryId === input.id && isActiveScan(this.activeScan)) {
      throw new Error("cannot update a library while its scan is active");
    }
    const updated = updateLibrary(this.db, input.id, input.patch);
    this.stopLibrarySync(input.id);
    this.startLibrarySync(updated);
    return updated;
  }

  removeLibrary(libraryId: string): void {
    if (this.activeScan?.libraryId === libraryId && isActiveScan(this.activeScan)) {
      throw new Error("cannot remove a library while its scan is active");
    }
    this.stopLibrarySync(libraryId);
    deleteLibrary(this.db, libraryId);
  }

  listLibraryEntries(libraryId: string) {
    return listEntries(this.db, libraryId);
  }

  libraryStats(libraryId: string) {
    return countEntries(this.db, libraryId);
  }

  maintainDatabase() {
    return maintainDatabase(this.db);
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
          concurrency: this.scanConcurrency,
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

  listDirectoryChildren(libraryId: string, directory: string, options: Omit<SearchEntriesRequest, "libraryId" | "text" | "scope" | "directory" | "directChildren"> & { parentId?: string } = {}) {
    return listDirectoryChildren(this.db, libraryId, directory, options);
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
    groups?: Array<{ filter?: string; template: string }>;
    match?: MatchTree;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    filter?: string;
    collision?: CollisionStrategy;
  }): ChangePlan {
    return previewRuntimeRename(this.db, input);
  }

  async executePlan(input: {
    libraryId: string;
    plan: ChangePlan;
    selectedOps?: number[];
    trashHandler?: (path: string) => Promise<boolean>;
  }) {
    return executeRuntimePlan({
      db: this.db,
      libraryId: input.libraryId,
      plan: input.plan,
      selectedOps: input.selectedOps,
      trashHandler: input.trashHandler,
      quarantineDir: this.paths.quarantineDir,
    });
  }

  async rollbackPlan(jobId: string) {
    return rollbackRuntimePlan({
      db: this.db,
      jobId,
    });
  }

  async refreshLibrary(libraryId: string): Promise<void> {
    await this.refreshAfterPlan(libraryId);
  }

  async refreshLibrariesContainingPaths(paths: readonly string[]): Promise<void> {
    const libraryIds = this.listLibraries()
      .filter((library) => library.roots.some((root) => paths.some((path) => isWithinRoot(path, root))))
      .map((library) => library.id);
    for (const libraryId of libraryIds) {
      await this.refreshAfterPlan(libraryId);
    }
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
    filter?: string;
    hashStrategy?: Exclude<HashStrategy, "off">;
    keepStrategy?: KeepStrategy;
    dispose?: "quarantine" | "delete";
  }) {
    return analyzeRuntimeDuplicates({
      db: this.db,
      ...input,
      quarantineDir: this.paths.quarantineDir,
    });
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
    if (this.closed) return;
    this.closed = true;
    for (const libraryId of this.syncResources.keys()) this.stopLibrarySync(libraryId);
    this.progressListeners.clear();
    this.db.close();
  }

  private startLibrarySync(library: Library): void {
    if (!this.fileSyncEnabled || this.closed || this.syncResources.has(library.id)) return;
    const processor = new ChangeProcessor(this.db, {
      library,
      onError: (error, item) => {
        updateSyncState(this.db, item.libraryId, { dirty: true, watcherState: "dirty" });
      },
    });
    const watcher = startLibraryWatcher(this.db, library, () => processor.schedule());
    ensureInitialReconciliation(this.db, library);
    this.syncResources.set(library.id, { watcher, processor });
    void processor.process();
  }

  private stopLibrarySync(libraryId: string): void {
    const resource = this.syncResources.get(libraryId);
    if (!resource) return;
    resource.processor.stop();
    resource.watcher.close();
    this.syncResources.delete(libraryId);
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
    await refreshRuntimeLibrary(
      this.db,
      libraryId,
      (progress) => this.emitProgress(progress),
      this.scanConcurrency,
    );
  }
}
