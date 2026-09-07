import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { getBuiltinProfile, listBuiltinProfiles, type CollisionStrategy, type RuleSet } from "@nestify/rules";
import type { ChangePlan, Job, Library } from "@nestify/shared";
import { asJobId, asLibraryId, type JobId } from "@nestify/shared";
import { loadAppConfig } from "../config/load.ts";
import { openDatabase } from "../db/open.ts";
import { createJob, listJobOps, listJobs, updateJobStatus } from "../db/repos/jobs.ts";
import {
  countEntries,
  createLibrary,
  deleteLibrary,
  getLibrary,
  listEntries,
  listLibraries,
} from "../db/repos/index.ts";
import { ensureAppDirs, resolveAppPaths } from "../layout/index.ts";
import type { ScanProgress } from "../modules/types.ts";
import { planRename, planRuleset } from "../plan/planner.ts";
import { executePlan, rollbackPlan, type PlanExecuteResult, type PlanRollbackResult } from "../plan/executor.ts";
import { runScan } from "../scan/indexer.ts";
import { searchEntries } from "../search/index.ts";
import { analyzeDuplicates, type RuntimeDuplicateAnalyzeResult } from "../duplicates/analyzer.ts";

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
    if (this.activeScan?.status === "running") {
      return { job: { id: this.activeScan.jobId, status: this.activeScan.status } };
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
    this.emitProgress(this.scanProgress);
    void this.runScanJob(library, jobId);
    return { job: { id: jobId, status: "running" } };
  }

  async scanLibrary(libraryId: string) {
    const started = this.startScan(libraryId);
    while (this.activeScan?.jobId === started.job.id && this.activeScan.status === "running") {
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
          onProgress: (progress) => {
            this.scanProgress = progress;
            this.emitProgress(progress);
          },
        },
      );
      const status = this.scanProgress.phase === "cancelled" ? "cancelled" : "completed";
      updateJobStatus(this.db, jobId, status, {
        finishedAt: Date.now(),
        stats: result,
      });
      this.activeScan = { jobId, libraryId: library.id, status };
      if (this.scanProgress.phase === "walk" || this.scanProgress.phase === "upsert") {
        this.scanProgress = { ...this.scanProgress, phase: "idle" };
      }
      this.emitProgress(this.scanProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateJobStatus(this.db, jobId, "failed", { finishedAt: Date.now(), error: message });
      this.activeScan = { jobId, libraryId: library.id, status: "failed" };
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

  search(libraryId: string, text: string, limit = 200) {
    return searchEntries(this.db, { libraryId, text, limit });
  }

  listRuleSets(): RuleSet[] {
    return listBuiltinProfiles();
  }

  previewRules(input: { libraryId: string; ruleSetId: string; collision?: CollisionStrategy }): ChangePlan {
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error(`library not found: ${input.libraryId}`);
    const profile = getBuiltinProfile(input.ruleSetId);
    if (!profile) throw new Error(`ruleset not found: ${input.ruleSetId}`);
    const entries = listEntries(this.db, input.libraryId);
    return planRuleset({
      libraryId: input.libraryId,
      entries,
      ruleSet: profile,
      collision: input.collision,
      libraryRoot: library.roots[0],
      quarantineDir: this.paths.quarantineDir,
    });
  }

  previewRename(input: { libraryId: string; template: string; collision?: CollisionStrategy }): ChangePlan {
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error(`library not found: ${input.libraryId}`);
    const entries = listEntries(this.db, input.libraryId);
    return planRename({
      libraryId: input.libraryId,
      entries,
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
    keepStrategy?: "newest" | "oldest" | "shortest_path";
  }): Promise<RuntimeDuplicateAnalyzeResult> {
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error(`library not found: ${input.libraryId}`);
    return analyzeDuplicates({
      entries: listEntries(this.db, input.libraryId),
      quarantineDir: this.paths.quarantineDir,
      keepStrategy: input.keepStrategy ?? "newest",
    });
  }

  close() {
    this.progressListeners.clear();
    this.db.close();
  }

  private emitProgress(progress: ScanProgress): void {
    for (const listener of this.progressListeners) listener(progress);
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
