import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { getBuiltinProfile, listBuiltinProfiles, type CollisionStrategy, type RuleSet } from "@nestify/rules";
import type { ChangePlan, Entry, Job, Library } from "@nestify/shared";
import { asJobId, asLibraryId, type JobId } from "@nestify/shared";
import { loadAppConfig } from "../config/load.ts";
import { openDatabase } from "../db/open.ts";
import { createJob, listJobOps, listJobs, updateJobStatus } from "../db/repos/jobs.ts";
import {
  countEntries,
  createLibrary,
  createRuleSetRecord,
  deleteLibrary,
  deleteRuleSetRecord,
  getLibrary,
  getRuleSetRecord,
  listRuleSetRecords,
  listEntries,
  listLibraries,
  parseRuleSetYaml,
  serializeRuleSet,
  setRuleSetEnabled,
  setRuleSetPriority,
  updateRuleSetRecord,
  type RuleSetCreateInput,
  type RuleSetPatch,
  type RuleSetRecord,
} from "../db/repos/index.ts";
import { ensureAppDirs, resolveAppPaths } from "../layout/index.ts";
import type { HashStrategy, KeepStrategy, OrganizeScope, ScanProgress } from "../modules/types.ts";
import { planRename, planRuleset } from "../plan/planner.ts";
import { executePlan, rollbackPlan, type PlanExecuteResult, type PlanRollbackResult } from "../plan/executor.ts";
import { runScan } from "../scan/indexer.ts";
import { searchEntries, type SearchEntriesRequest } from "../search/index.ts";
import { analyzeDuplicates, type RuntimeDuplicateAnalyzeResult } from "../duplicates/analyzer.ts";
import {
  persistDuplicateAnalysis,
  type DuplicateAnalysisPersistenceSummary,
} from "../duplicates/persistence.ts";

export interface RuntimeOptions {
  appDataRoot?: string;
  bundledConfigDir?: string;
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

  constructor(options: RuntimeOptions = {}) {
    const appDataRoot = options.appDataRoot ?? defaultAppDataRoot();
    this.paths = resolveAppPaths(appDataRoot);
    ensureAppDirs(this.paths);
    this.config = loadAppConfig({
      appDataRoot,
      bundledConfigDir: options.bundledConfigDir ?? defaultBundledConfigDir(),
    });
    this.db = openDatabase(process.env.NESTIFY_DB_PATH || this.paths.dbPath);
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
    return this.scanProgress;
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
    return [...listBuiltinProfiles().map((profile, index) => toBuiltinRecord(profile, index)), ...listRuleSetRecords(this.db)].sort(
      (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
    );
  }

  getRuleSet(id: string): RuleSetRecord | undefined {
    const builtin = getBuiltinProfile(id);
    if (getRuleSetRecord(this.db, id)) return getRuleSetRecord(this.db, id);
    if (!builtin) return undefined;
    const priority = listBuiltinProfiles().findIndex((profile) => profile.id === builtin.id);
    return {
      ...builtin,
      builtin: true,
      enabled: true,
      priority: priority >= 0 ? priority : Number.MAX_SAFE_INTEGER,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  createRuleSet(input: RuleSetCreateInput): RuleSetRecord {
    if (input.id && getBuiltinProfile(input.id)) {
      throw new Error(`builtin ruleset id is reserved: ${input.id}`);
    }
    return createRuleSetRecord(this.db, input);
  }

  updateRuleSet(id: string, patch: RuleSetPatch): RuleSetRecord {
    this.assertCustomRuleSet(id);
    return updateRuleSetRecord(this.db, id, patch);
  }

  deleteRuleSet(id: string): void {
    this.assertCustomRuleSet(id);
    deleteRuleSetRecord(this.db, id);
  }

  setRuleSetEnabled(id: string, enabled: boolean): RuleSetRecord {
    this.assertCustomRuleSet(id);
    return setRuleSetEnabled(this.db, id, enabled);
  }

  setRuleSetPriority(id: string, priority: number): RuleSetRecord {
    this.assertCustomRuleSet(id);
    return setRuleSetPriority(this.db, id, priority);
  }

  cloneRuleSet(
    sourceId: string,
    options: { name?: string; priority?: number; enabled?: boolean } = {},
  ): RuleSetRecord {
    const source = this.getRuleSet(sourceId);
    if (!source) throw new Error(`ruleset not found: ${sourceId}`);
    return createRuleSetRecord(this.db, {
      ...toRuleSetProfile(source),
      id: undefined,
      name: options.name ?? `${source.name} Copy`,
      priority: options.priority ?? source.priority,
      enabled: options.enabled ?? true,
    });
  }

  exportRuleSet(id: string): string {
    const source = this.getRuleSet(id);
    if (!source) throw new Error(`ruleset not found: ${id}`);
    return serializeRuleSet(toRuleSetProfile(source));
  }

  importRuleSet(yaml: string): RuleSetRecord {
    const profile = parseRuleSetYaml(yaml);
    const requestedId = getRuleSetRecord(this.db, profile.id) || getBuiltinProfile(profile.id)
      ? undefined
      : profile.id;
    return createRuleSetRecord(this.db, {
      ...profile,
      id: requestedId,
    });
  }

  previewRules(input: {
    libraryId: string;
    ruleSetId: string;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
  }): ChangePlan {
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error(`library not found: ${input.libraryId}`);
    const profile = this.getRuleSet(input.ruleSetId);
    if (!profile) throw new Error(`ruleset not found: ${input.ruleSetId}`);
    if (!profile.enabled) throw new Error(`ruleset is disabled: ${input.ruleSetId}`);
    const entries = listEntries(this.db, input.libraryId);
    const candidateEntryIds = previewCandidateEntries(entries, input).map((entry) => entry.id);
    return planRuleset({
      libraryId: input.libraryId,
      entries,
      candidateEntryIds,
      ruleSet: profile,
      collision: input.collision,
      libraryRoot: library.roots[0],
      quarantineDir: this.paths.quarantineDir,
    });
  }

  previewRename(input: {
    libraryId: string;
    template: string;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
  }): ChangePlan {
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error(`library not found: ${input.libraryId}`);
    const entries = listEntries(this.db, input.libraryId);
    const candidateEntryIds = previewCandidateEntries(entries, input).map((entry) => entry.id);
    return planRename({
      libraryId: input.libraryId,
      entries,
      candidateEntryIds,
      template: input.template,
      collision: input.collision,
      libraryRoot: library.roots[0],
    });
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

  close() {
    this.progressListeners.clear();
    this.db.close();
  }

  private emitProgress(progress: ScanProgress): void {
    for (const listener of this.progressListeners) listener(progress);
  }

  private assertControllableScan(jobId: string, statuses: Job["status"][]): void {
    if (this.activeScan?.jobId !== jobId || !statuses.includes(this.activeScan.status)) {
      throw new Error(`scan job is not ${statuses.join("/")}: ${jobId}`);
    }
  }

  private assertCustomRuleSet(id: string): void {
    if (getBuiltinProfile(id)) throw new Error(`builtin ruleset is readonly: ${id}`);
    if (!getRuleSetRecord(this.db, id)) throw new Error(`ruleset not found: ${id}`);
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

function isActiveScan(scan: { status: Job["status"] } | null): scan is { status: Job["status"] } {
  return scan?.status === "running" || scan?.status === "paused" || scan?.status === "cancelling";
}

function previewCandidateEntries(
  entries: readonly Entry[],
  input: { scope?: OrganizeScope; entryIds?: string[]; directory?: string },
): Entry[] {
  const scope = input.scope ?? "library";
  if (scope === "selection" && (input.entryIds?.length ?? 0) === 0) {
    throw new Error("selection scope requires at least one entryId");
  }
  if (scope === "directory" && !input.directory?.trim()) {
    throw new Error("directory scope requires a directory");
  }

  const liveEntries = entries.filter((entry) => !entry.tombstone);
  if (scope === "library") return liveEntries;
  if (scope === "directory") {
    const directory = normalizePreviewPath(input.directory!);
    return liveEntries.filter((entry) => isWithinPreviewDirectory(entry.path, directory));
  }

  const selectedIds = new Set(input.entryIds);
  const selectedDirectories = liveEntries
    .filter((entry) => selectedIds.has(entry.id) && entry.isDir)
    .map((entry) => normalizePreviewPath(entry.path));
  return liveEntries.filter(
    (entry) =>
      selectedIds.has(entry.id) ||
      selectedDirectories.some((directory) => isWithinPreviewDirectory(entry.path, directory)),
  );
}

function normalizePreviewPath(path: string): string {
  const normalized = path.trim().replaceAll(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  return /^[a-z]:$/.test(normalized) ? `${normalized}/` : normalized;
}

function isWithinPreviewDirectory(path: string, directory: string): boolean {
  const normalized = normalizePreviewPath(path);
  const prefix = directory.endsWith("/") ? directory : `${directory}/`;
  return normalized === directory || normalized.startsWith(prefix);
}

function toBuiltinRecord(profile: RuleSet, priority: number): RuleSetRecord {
  return {
    ...profile,
    builtin: true,
    enabled: true,
    priority,
    createdAt: 0,
    updatedAt: 0,
  };
}

function toRuleSetProfile(record: RuleSetRecord): RuleSet {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    dryRunDefault: record.dryRunDefault,
    collision: record.collision,
    rules: record.rules,
  };
}

class RuntimePauseGate {
  private paused = false;
  private waiters = new Set<() => void>();

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.wake();
  }

  cancel(): void {
    this.paused = false;
    this.wake();
  }

  isPaused(): boolean {
    return this.paused;
  }

  async waitWhilePaused(signal?: AbortSignal): Promise<void> {
    if (!this.paused || signal?.aborted) return;
    await new Promise<void>((resolve) => {
      const wake = () => {
        signal?.removeEventListener("abort", wake);
        this.waiters.delete(wake);
        resolve();
      };
      this.waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
    });
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }
}

function defaultAppDataRoot(): string {
  if (process.env.NESTIFY_APPDATA) return process.env.NESTIFY_APPDATA;
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Nestify");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Nestify");
  }
  return join(homedir(), ".config", "Nestify");
}

function defaultBundledConfigDir(): string {
  if (process.env.NESTIFY_CONFIG_DIR) return process.env.NESTIFY_CONFIG_DIR;
  const seeds = [
    join(process.cwd(), "config"),
    join(process.cwd(), "..", "config"),
    join(process.cwd(), "..", "..", "config"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "config"),
  ];
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) seeds.unshift(join(resources, "config"));
  for (const dir of seeds) {
    if (existsSync(join(dir, "app.default.yaml"))) return dir;
  }
  return join(process.cwd(), "config");
}
