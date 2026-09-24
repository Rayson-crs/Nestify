import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Job, JobId, Library } from "@nestify/shared";
import { asJobId, asLibraryId } from "@nestify/shared";
import { createJob, updateJobStatus } from "../db/repos/jobs.ts";
import { getLibrary } from "../db/repos/index.ts";
import type { ScanProgress } from "../modules/types.ts";
import { runScan } from "../scan/indexer.ts";
import { isActiveScan, RuntimePauseGate } from "./runtime-helpers.ts";
import { refreshRuntimeLibrary } from "./runtime-plans.ts";

type ActiveScanJob = { jobId: JobId; libraryId: string; status: Job["status"] };

interface ScanWorkerHost {
  execute(input: {
    jobId: string;
    libraryId: string;
    concurrency?: number;
    onProgress?: (progress: ScanProgress) => void;
  }): Promise<{
    filesScanned: number;
    dirsScanned: number;
    errors: number;
    errorDetails?: Array<{ path: string; operation: string; message: string; code?: string }>;
    errorSummary?: Record<string, number>;
  }>;
  pause(jobId: string): void;
  resume(jobId: string): void;
  cancel(jobId: string): void;
  close(): Promise<void>;
}

type ScanWorkerFactory = () => ScanWorkerHost;

export class RuntimeScanCoordinator {
  private readonly db: DatabaseSync;
  private progress: ScanProgress = {
    phase: "idle",
    filesScanned: 0,
    dirsScanned: 0,
    bytesScanned: 0,
    errors: 0,
  };
  private abort: AbortController | null = null;
  private gate: RuntimePauseGate | null = null;
  private active: ActiveScanJob | null = null;
  private readonly progressListeners = new Set<(progress: ScanProgress) => void>();
  private readonly finishedListeners = new Set<(libraryId: string) => void>();
  private concurrency: number;
  private readonly scanWorkerFactory: ScanWorkerFactory | null;
  private scanWorker: ScanWorkerHost | null = null;
  private executionTail: Promise<void> = Promise.resolve();

  constructor(db: DatabaseSync, concurrency: number, scanWorkerFactory?: ScanWorkerFactory) {
    this.db = db;
    this.concurrency = normalizeConcurrency(concurrency);
    this.scanWorkerFactory = scanWorkerFactory ?? null;
  }

  get activeJob(): ActiveScanJob | null {
    return this.active;
  }

  setConcurrency(concurrency: number): void {
    this.concurrency = normalizeConcurrency(concurrency);
  }

  onProgress(listener: (progress: ScanProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  onFinished(listener: (libraryId: string) => void): () => void {
    this.finishedListeners.add(listener);
    return () => this.finishedListeners.delete(listener);
  }

  start(libraryId: string): { job: { id: string; status: string } } {
    const library = getLibrary(this.db, libraryId);
    if (!library) throw new Error(`library not found: ${libraryId}`);
    if (isActiveScan(this.active)) {
      if (this.active.libraryId === libraryId) {
        return { job: { id: this.active.jobId, status: this.active.status } };
      }
      throw new Error(`another scan is active: ${this.active.libraryId}`);
    }
    const jobId = asJobId(randomUUID());
    createJob(this.db, {
      id: jobId,
      libraryId: asLibraryId(libraryId),
      kind: "scan",
      status: "running",
      startedAt: Date.now(),
    });
    this.active = { jobId, libraryId, status: "running" };
    this.progress = {
      phase: "walk",
      filesScanned: 0,
      dirsScanned: 0,
      bytesScanned: 0,
      errors: 0,
    };
    this.abort = new AbortController();
    this.gate = new RuntimePauseGate();
    this.emit(this.progress);
    this.enqueue(() => this.runJob(library, jobId));
    return { job: { id: jobId, status: "running" } };
  }

  async scanLibrary(libraryId: string) {
    const started = this.start(libraryId);
    while (this.active?.jobId === started.job.id && isActiveScan(this.active)) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return {
      jobId: started.job.id,
      result: {
        filesScanned: this.progress.filesScanned,
        dirsScanned: this.progress.dirsScanned,
        errors: this.progress.errors,
      },
      progress: this.progress,
    };
  }

  getProgress() {
    const active = isActiveScan(this.active) ? this.active : null;
    return {
      ...this.progress,
      jobId: active?.jobId ?? null,
      libraryId: active?.libraryId ?? null,
      jobStatus: active?.status ?? null,
    };
  }

  pause(jobId: string): { job: { id: string; status: string } } {
    this.assertControllable(jobId, ["running"]);
    this.gate?.pause();
    this.scanWorker?.pause(jobId);
    this.active!.status = "paused";
    updateJobStatus(this.db, asJobId(jobId), "paused");
    this.progress = { ...this.progress, paused: true };
    this.emit(this.progress);
    return { job: { id: jobId, status: "paused" } };
  }

  resume(jobId: string): { job: { id: string; status: string } } {
    this.assertControllable(jobId, ["paused"]);
    this.gate?.resume();
    this.scanWorker?.resume(jobId);
    this.active!.status = "running";
    updateJobStatus(this.db, asJobId(jobId), "running");
    this.progress = { ...this.progress, paused: false };
    this.emit(this.progress);
    return { job: { id: jobId, status: "running" } };
  }

  cancel(jobId: string): { job: { id: string; status: string } } {
    this.assertControllable(jobId, ["running", "paused"]);
    this.active!.status = "cancelling";
    updateJobStatus(this.db, asJobId(jobId), "cancelling");
    this.gate?.cancel();
    this.abort?.abort();
    this.scanWorker?.cancel(jobId);
    this.progress = { ...this.progress, paused: false };
    this.emit(this.progress);
    return { job: { id: jobId, status: "cancelling" } };
  }

  async refreshLibrary(libraryId: string): Promise<void> {
    if (this.scanWorkerFactory) {
      await this.enqueue(async () => {
        const worker = this.worker();
        await worker.execute({
          jobId: `refresh:${libraryId}:${Date.now()}`,
          libraryId,
          concurrency: this.concurrency,
        });
      });
      return;
    }
    await refreshRuntimeLibrary(this.db, libraryId, () => undefined, this.concurrency);
  }

  close(): void {
    this.progressListeners.clear();
    this.finishedListeners.clear();
  }

  async shutdown(): Promise<void> {
    const worker = this.scanWorker;
    this.scanWorker = null;
    if (this.active && isActiveScan(this.active)) this.cancel(this.active.jobId);
    await worker?.close();
  }

  private async runJob(library: Library, jobId: JobId): Promise<void> {
    try {
      const result = this.scanWorkerFactory
        ? await this.worker().execute({
          jobId,
          libraryId: library.id,
          concurrency: this.concurrency,
          onProgress: (progress) => {
            this.progress = { ...progress, paused: this.gate?.isPaused() ?? false };
            this.emit(this.progress);
          },
        })
        : await runScan(
          this.db,
          { roots: library.roots, incremental: true, hashStrategy: library.hashStrategy },
          {
            libraryId: library.id,
            abortSignal: this.abort?.signal,
            pauseGate: this.gate ?? undefined,
            onProgress: (progress) => {
              this.progress = { ...progress, paused: this.gate?.isPaused() ?? false };
              this.emit(this.progress);
            },
            concurrency: this.concurrency,
          },
        );
      const status = this.progress.phase === "cancelled" ? "cancelled" : "completed";
      updateJobStatus(this.db, jobId, status, {
        finishedAt: Date.now(),
        stats: result,
        ...(result.errors > 0 ? { error: scanErrorMessage(result) } : { error: undefined }),
      });
      this.active = { jobId, libraryId: library.id, status };
      this.abort = null;
      this.gate = null;
      if (this.progress.phase === "walk" || this.progress.phase === "upsert") {
        this.progress = { ...this.progress, phase: "idle" };
      }
      this.checkpointDatabase();
      this.emit(this.progress);
      for (const listener of this.finishedListeners) listener(library.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateJobStatus(this.db, jobId, "failed", { finishedAt: Date.now(), error: message });
      this.active = { jobId, libraryId: library.id, status: "failed" };
      this.abort = null;
      this.gate = null;
      this.progress = { ...this.progress, phase: "idle", errors: this.progress.errors + 1 };
      this.emit(this.progress);
      for (const listener of this.finishedListeners) listener(library.id);
    }
  }

  private checkpointDatabase(): void {
    try {
      this.db.exec("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {
      // A failed checkpoint must not mark a successful scan as failed.
    }
  }

  private assertControllable(jobId: string, statuses: Job["status"][]): void {
    if (this.active?.jobId !== jobId || !statuses.includes(this.active.status)) {
      throw new Error(`scan job is not ${statuses.join("/")}: ${jobId}`);
    }
  }

  private emit(progress: ScanProgress): void {
    for (const listener of this.progressListeners) listener(progress);
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const execution = this.executionTail.then(operation);
    this.executionTail = execution.then(() => undefined, () => undefined);
    return execution;
  }

  private worker(): ScanWorkerHost {
    this.scanWorker ??= this.scanWorkerFactory?.() ?? null;
    if (!this.scanWorker) throw new Error("scan worker is unavailable");
    return this.scanWorker;
  }
}

function normalizeConcurrency(value: number): number {
  return Math.max(1, Math.min(32, Math.trunc(Number(value) || 1)));
}

function scanErrorMessage(result: {
  errors: number;
  errorDetails?: Array<{ path: string; operation: string; message: string; code?: string }>;
}): string {
  const first = result.errorDetails?.[0];
  if (!first) return `扫描完成，但有 ${result.errors} 个错误；请打开任务详情查看统计`;
  const code = first.code ? ` [${first.code}]` : "";
  return `扫描完成，但有 ${result.errors} 个读取错误；${first.path} (${first.operation})${code}: ${first.message}`;
}
