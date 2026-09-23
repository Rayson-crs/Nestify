import type { DatabaseSync } from "node:sqlite";
import type { ChangePlan, DuplicateAnalysisProgress, ExecutionModule, Library, LibraryPatch, LibraryRemovalProgress, MediaMergeDuration, MediaMergePlan, MediaMergePlanInput, MediaMergeProgress, MediaMergeTimeline, MediaMergeWaveform, OrganizeRuleInput, PlanExecutionProgress } from "@nestify/shared";
import { loadAppConfig } from "../config/load.ts";
import { maintainDatabase } from "../db/maintenance.ts";
import { openDatabase, type DatabaseLogFunction } from "../db/open.ts";
import {
  listJobOps,
  listJobs,
  reconcileInterruptedMediaMergeJobs,
} from "../db/repos/jobs.ts";
import {
  countEntries,
  createLibrary,
  deleteLibrary,
  getLibrary,
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
import { ALL_LIBRARIES_ID, listDirectoryChildren, searchEntries, type SearchEntriesRequest } from "../search/index.ts";
import { ChangeProcessor, recoverProcessingChanges, startLibraryWatcher, type LibraryWatcher } from "../sync/index.ts";
import { ensureInitialReconciliation, updateSyncState } from "../db/repos/sync.ts";
import {
  defaultAppDataRoot,
  defaultBundledConfigDir,
  isActiveScan,
  isWithinRoot,
  runStartupStep,
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
  rollbackRuntimePlan,
} from "./runtime-plans.ts";
import type { CollisionStrategy, MatchTree } from "@nestify/rules";
import type { OrganizeSnapshot } from "../organize/types.ts";
import { RuntimeMediaMergeCoordinator } from "./runtime-media-merge.ts";
import { RuntimeScanCoordinator } from "./runtime-scan.ts";
import { startRuntimeLibraryRemoval } from "./runtime-library-removal.ts";
import { RuntimeOrganizeCoordinator } from "./runtime-organize.ts";
import { RuntimeThumbnailCoordinator } from "./runtime-thumbnails.ts";

export interface RuntimeOptions {
  appDataRoot?: string;
  bundledConfigDir?: string;
  onStartupLog?: DatabaseLogFunction;
  scanConcurrency?: number;
  fileSync?: boolean;
  mediaMergeWorkerPath?: string;
  mediaMergeWorkerFactory?: (workerPath: string) => {
    plan(input: MediaMergePlanInput): Promise<MediaMergePlan>;
    execute(input: {
      jobId: string;
      plan: MediaMergePlan;
      workspacePath: string;
      resume?: { checkpoint?: MediaMergeProgress["checkpoint"]; completedStages?: readonly string[] };
      onProgress?: (progress: MediaMergeProgress) => void;
    }): Promise<{ outputPath: string }>;
    duration(path: string): Promise<MediaMergeDuration>;
    timeline(path: string): Promise<MediaMergeTimeline>;
    waveform(path: string): Promise<MediaMergeWaveform>;
    cancel(jobId: string): void;
    close(): Promise<void>;
  };
}

export class NestifyRuntime {
  readonly paths;
  readonly config;
  readonly db: DatabaseSync;
  private readonly scan: RuntimeScanCoordinator;
  private readonly mediaMerge: RuntimeMediaMergeCoordinator;
  private readonly thumbnails: RuntimeThumbnailCoordinator;
  private readonly syncResources = new Map<string, { watcher: LibraryWatcher; processor: ChangeProcessor }>();
  private readonly organize: RuntimeOrganizeCoordinator;
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
    this.thumbnails = new RuntimeThumbnailCoordinator({
      db: this.db,
      thumbnailsDir: this.paths.thumbnailsDir,
      concurrency: this.config.workers.thumbnailConcurrency.localSsd,
      thumbnailSize: this.config.preview.thumbnailSize,
      format: this.config.preview.format,
    });
    this.organize = new RuntimeOrganizeCoordinator(this.db);
    this.mediaMerge = new RuntimeMediaMergeCoordinator({
      db: this.db,
      tmpDir: this.paths.tmpDir,
      workerPath: options.mediaMergeWorkerPath,
      workerFactory: options.mediaMergeWorkerFactory,
      refreshLibrariesContainingPaths: (paths) => this.refreshLibrariesContainingPaths(paths),
    });
    runStartupStep(log, "runtime.media-merge.reconcile", () =>
      reconcileInterruptedMediaMergeJobs(this.db),
    );
    this.scan = new RuntimeScanCoordinator(
      this.db,
      Math.max(
      1,
      Math.min(
        32,
        Math.trunc(options.scanConcurrency ?? this.config.workers.scanConcurrency.localSsd),
      ),
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
    this.scan.setConcurrency(concurrency);
  }

  onScanProgress(listener: (progress: ScanProgress) => void): () => void {
    return this.scan.onProgress(listener);
  }

  onScanFinished(listener: (libraryId: string) => void): () => void {
    return this.scan.onFinished(listener);
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
    if (this.scan.activeJob?.libraryId === input.id && isActiveScan(this.scan.activeJob)) {
      throw new Error("cannot update a library while its scan is active");
    }
    const updated = updateLibrary(this.db, input.id, input.patch);
    this.stopLibrarySync(input.id);
    this.startLibrarySync(updated);
    return updated;
  }

  removeLibrary(libraryId: string): void {
    if (this.scan.activeJob?.libraryId === libraryId && isActiveScan(this.scan.activeJob)) {
      throw new Error("cannot remove a library while its scan is active");
    }
    this.stopLibrarySync(libraryId);
    deleteLibrary(this.db, libraryId);
  }

  /**
   * Remove only the library's index and local metadata. The source folders are
   * never touched. The callbacks let the Electron host stop its resources
   * around the database operation without blocking the IPC response.
   */
  startLibraryRemoval(input: {
    libraryId: string;
    beforeDelete?: (report: (stage: string, current: number) => void) => Promise<void>;
    removeData?: (report: (stage: string, current: number) => void) => Promise<void>;
    afterDelete?: (report: (stage: string, current: number) => void) => Promise<void>;
    onProgress?: (progress: LibraryRemovalProgress) => void;
  }): { jobId: string; completion: Promise<void> } {
    return startRuntimeLibraryRemoval({
      db: this.db,
      libraryId: input.libraryId,
      activeScan: this.scan.activeJob,
      beforeDelete: input.beforeDelete,
      removeData: input.removeData,
      afterDelete: input.afterDelete,
      onProgress: input.onProgress,
    });
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
    return this.scan.start(libraryId);
  }

  async scanLibrary(libraryId: string) {
    return this.scan.scanLibrary(libraryId);
  }

  getScanProgress() {
    return this.scan.getProgress();
  }

  getActiveScanJob() {
    return this.scan.activeJob;
  }

  pauseScan(jobId: string): { job: { id: string; status: string } } {
    return this.scan.pause(jobId);
  }

  resumeScan(jobId: string): { job: { id: string; status: string } } {
    return this.scan.resume(jobId);
  }

  cancelScan(jobId: string): { job: { id: string; status: string } } {
    return this.scan.cancel(jobId);
  }

  onMediaMergeProgress(listener: (progress: MediaMergeProgress) => void): () => void {
    return this.mediaMerge.onProgress(listener);
  }

  async buildMediaMergePlan(input: MediaMergePlanInput): Promise<MediaMergePlan> {
    return this.mediaMerge.buildPlan(input);
  }

  startMediaMerge(plan: MediaMergePlan): { jobId: string; progress: MediaMergeProgress } {
    return this.mediaMerge.start(plan);
  }

  async resumeMediaMerge(jobId: string): Promise<MediaMergeProgress> {
    return this.mediaMerge.resume(jobId);
  }

  cancelMediaMerge(jobId: string): { jobId: string; status: MediaMergeProgress["status"] } {
    return this.mediaMerge.cancel(jobId);
  }

  getMediaMergeProgress(jobId: string): MediaMergeProgress | null {
    return this.mediaMerge.getProgress(jobId);
  }

  async getMediaMergeTimeline(input: {
    path: string;
    selectedPaths: readonly string[];
  }): Promise<MediaMergeTimeline> {
    return this.mediaMerge.getTimeline(input);
  }

  async getMediaMergeWaveform(input: {
    path: string;
    selectedPaths: readonly string[];
  }): Promise<MediaMergeWaveform> {
    return this.mediaMerge.getWaveform(input);
  }

  async getMediaMergeDuration(input: {
    path: string;
    selectedPaths: readonly string[];
  }): Promise<MediaMergeDuration> {
    return this.mediaMerge.getDuration(input);
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    await this.mediaMerge.shutdown();
    this.close();
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

  createOrganizeSnapshot(input: {
    libraryId: string;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    now?: number;
  }) {
    return this.organize.createSnapshot(input);
  }

  getOrganizeSnapshot(snapshotId: string): OrganizeSnapshot | undefined {
    return this.organize.getSnapshot(snapshotId);
  }

  previewOrganize(input: {
    libraryId: string;
    rules?: OrganizeRuleInput[];
    /** @deprecated old ruleset callers only */
    ruleSetId?: string;
    snapshotId?: string;
    snapshot?: OrganizeSnapshot;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
    filter?: string;
    now?: number;
  }) {
    return this.organize.preview({
      ...input,
      quarantineDir: this.paths.quarantineDir,
      libraryId: input.libraryId,
    });
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
    module?: ExecutionModule;
    onProgress?: (progress: PlanExecutionProgress) => void;
  }) {
    return executeRuntimePlan({
      db: this.db,
      libraryId: input.libraryId,
      plan: input.plan,
      selectedOps: input.selectedOps,
      trashHandler: input.trashHandler,
      module: input.module,
      onProgress: input.onProgress,
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

  listJobOps(jobId: string, input: { offset?: number; limit?: number } = {}) {
    return listJobOps(this.db, jobId, input);
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
    onProgress?: (progress: DuplicateAnalysisProgress) => void;
  }) {
    return analyzeRuntimeDuplicates({
      db: this.db,
      ...input,
      quarantineDir: this.paths.quarantineDir,
      onProgress: input.onProgress,
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
    return this.thumbnails.get(request, ctx);
  }

  async cancelThumbnail(entryId: string): Promise<boolean> {
    return this.thumbnails.cancel(entryId);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const libraryId of this.syncResources.keys()) this.stopLibrarySync(libraryId);
    this.mediaMerge.abortForClose();
    this.scan.close();
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

  private async refreshAfterPlan(libraryId: string): Promise<void> {
    await this.scan.refreshLibrary(libraryId);
  }
}
