import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  JobId,
  MediaMergeJobStats,
  MediaMergePlan,
  MediaMergePlanInput,
  MediaMergeProgress,
  MediaMergeDuration,
  MediaMergeTimeline,
  MediaMergeWaveform,
} from "@nestify/shared";
import { asJobId } from "@nestify/shared";
import { createJob, getJobById, updateJobStatus } from "../db/repos/jobs.ts";
import { enrichMediaMergePlan } from "../media/analysis.ts";
import { MediaMergeCancelledError, MediaMergeInterruptedError } from "../media/errors.ts";
import { extractAudioWaveform, extractVideoTimelineFrames } from "../media/ffmpeg.ts";
import { probeVideo } from "../media/ffmpeg.ts";
import { executeMediaMerge } from "../media/executor.ts";
import { buildMediaMergePlan } from "../media/plan.ts";

interface MediaMergeSession {
  controller: AbortController;
  progress: MediaMergeProgress;
  plan: MediaMergePlan;
  completion: Promise<void>;
}

export class RuntimeMediaMergeCoordinator {
  private readonly options: {
    db: DatabaseSync;
    tmpDir: string;
    refreshLibrariesContainingPaths: (paths: readonly string[]) => Promise<void>;
  };
  private readonly sessions = new Map<string, MediaMergeSession>();
  private readonly listeners = new Set<(progress: MediaMergeProgress) => void>();
  private readonly assetCache = new Map<string, {
    promise: Promise<MediaMergeTimeline | MediaMergeWaveform>;
    usedAt: number;
  }>();

  constructor(options: {
    db: DatabaseSync;
    tmpDir: string;
    refreshLibrariesContainingPaths: (paths: readonly string[]) => Promise<void>;
  }) {
    this.options = options;
  }

  onProgress(listener: (progress: MediaMergeProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async buildPlan(input: MediaMergePlanInput): Promise<MediaMergePlan> {
    return enrichMediaMergePlan(await buildMediaMergePlan(input));
  }

  start(plan: MediaMergePlan): { jobId: string; progress: MediaMergeProgress } {
    if (plan.version !== 1) throw new Error(`unsupported media merge plan version: ${plan.version}`);
    const jobId = asJobId(randomUUID());
    const controller = new AbortController();
    const progress: MediaMergeProgress = {
      jobId,
      status: "running",
      phase: "validating",
      percent: 0,
      current: 0,
      total: plan.items.length,
      outputPath: null,
      error: null,
      checkpoint: null,
      resumeSupported: true,
    };
    createJob(this.options.db, {
      id: jobId,
      kind: "media-merge",
      status: "running",
      startedAt: Date.now(),
      dryRun: false,
      stats: createJobStats(plan, progress),
    });
    const session: MediaMergeSession = {
      controller,
      progress,
      plan,
      completion: Promise.resolve(),
    };
    this.sessions.set(jobId, session);
    session.completion = this.runJob(
      plan,
      jobId,
      controller,
      this.workspacePath(jobId),
    );
    this.emit(progress);
    return { jobId, progress };
  }

  async resume(jobId: string): Promise<MediaMergeProgress> {
    if (this.sessions.has(jobId)) {
      throw new Error(`媒体合并任务正在运行：${jobId}`);
    }
    const job = getJobById(this.options.db, asJobId(jobId));
    if (!job) throw new Error(`媒体合并任务不存在：${jobId}`);
    if (job.kind !== "media-merge") throw new Error(`任务不是媒体合并：${jobId}`);
    if (job.status !== "failed") throw new Error(`只有失败的媒体合并任务可以恢复：${jobId}`);

    const stats = job.stats as MediaMergeJobStats | null;
    const plan = stats?.plan;
    const progress = stats?.progress;
    const checkpoint = stats?.checkpoint ?? progress?.checkpoint;
    if (!stats || !plan || !progress || !checkpoint) {
      throw new Error("恢复失败：任务缺少可恢复的计划或断点");
    }
    if (!progress.resumeSupported) throw new Error("恢复失败：该任务不支持断点恢复");
    if (checkpoint.version !== 1 || checkpoint.jobId !== jobId) {
      throw new Error("恢复失败：断点与任务不匹配");
    }

    const workspacePath = this.workspacePath(jobId);
    if (normalizeWorkspacePath(checkpoint.workspacePath) !== normalizeWorkspacePath(workspacePath)) {
      throw new Error("恢复失败：断点工作区不在应用受管目录内");
    }
    if (checkpoint.preferredOutputPath !== plan.outputPath) {
      throw new Error("恢复失败：计划输出路径不匹配");
    }
    const recordedOutputPath = stats.outputPath ?? progress.outputPath;
    if (recordedOutputPath && checkpoint.outputPath !== recordedOutputPath) {
      throw new Error("恢复失败：断点输出路径不匹配");
    }
    await stat(workspacePath);

    const resumedProgress: MediaMergeProgress = {
      ...progress,
      jobId,
      status: "running",
      phase: "validating",
      error: null,
      checkpoint,
      resumeSupported: true,
    };
    updateJobStatus(this.options.db, asJobId(jobId), "running", {
      error: null,
      finishedAt: null,
      stats: createJobStats(plan, resumedProgress),
    });
    const controller = new AbortController();
    const session: MediaMergeSession = {
      controller,
      progress: resumedProgress,
      plan,
      completion: Promise.resolve(),
    };
    this.sessions.set(jobId, session);
    session.completion = this.runJob(plan, asJobId(jobId), controller, workspacePath, {
      checkpoint,
      completedStages: checkpoint.completedStages,
    });
    this.emit(resumedProgress);
    return resumedProgress;
  }

  cancel(jobId: string): { jobId: string; status: MediaMergeProgress["status"] } {
    const session = this.sessions.get(jobId);
    if (!session) throw new Error(`media merge job not found: ${jobId}`);
    if (session.progress.status !== "running") {
      return { jobId, status: session.progress.status };
    }
    session.progress = {
      ...session.progress,
      status: "cancelling",
      error: null,
    };
    session.controller.abort();
    updateJobStatus(this.options.db, asJobId(jobId), "cancelling");
    this.emit(session.progress);
    return { jobId, status: "cancelling" };
  }

  getProgress(jobId: string): MediaMergeProgress | null {
    return this.sessions.get(jobId)?.progress ?? null;
  }

  async getTimeline(input: {
    path: string;
    selectedPaths: readonly string[];
  }): Promise<MediaMergeTimeline> {
    return this.getAsset<MediaMergeTimeline>("timeline", input, async (path) => {
      const extracted = await extractVideoTimelineFrames(path, { count: 8 });
      return {
        frames: extracted.frames.map((frame) => ({
          timeSeconds: frame.timeSeconds,
          dataUrl: `data:image/jpeg;base64,${frame.data.toString("base64")}`,
        })),
        durationSeconds: extracted.durationSeconds,
        error: null,
      };
    });
  }

  async getWaveform(input: {
    path: string;
    selectedPaths: readonly string[];
  }): Promise<MediaMergeWaveform> {
    return this.getAsset<MediaMergeWaveform>("waveform", input, async (path) => {
      const result = await extractAudioWaveform(path, { peakCount: 180 });
      return {
        peaks: result.peaks,
        sampleRate: result.sampleRate,
        durationSeconds: result.durationSeconds,
        error: null,
      };
    });
  }

  async getDuration(input: {
    path: string;
    selectedPaths: readonly string[];
  }): Promise<MediaMergeDuration> {
    return this.getAsset<MediaMergeDuration>("duration", input, async (path) => {
      const probe = await probeVideo(path);
      return { durationSeconds: probe.durationSeconds, error: null };
    });
  }

  async shutdown(): Promise<void> {
    const sessions = [...this.sessions.values()];
    for (const session of sessions) {
      session.controller.abort(new MediaMergeInterruptedError());
    }
    await Promise.allSettled(sessions.map((session) => session.completion));
  }

  abortForClose(): void {
    for (const session of this.sessions.values()) {
      session.controller.abort(new MediaMergeInterruptedError());
    }
  }

  private async runJob(
    plan: MediaMergePlan,
    jobId: JobId,
    controller: AbortController,
    workspacePath: string,
    resume?: {
      checkpoint: MediaMergeProgress["checkpoint"];
      completedStages: readonly string[];
    },
  ): Promise<void> {
    const session = this.sessions.get(jobId);
    try {
      const result = await executeMediaMerge({
        jobId,
        plan,
        workspacePath,
        resume,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!session || session.controller !== controller) return;
          session.progress = progress;
          this.persistProgress(jobId, plan, progress);
          this.emit(progress);
        },
      });
      if (!session) return;
      session.progress = {
        ...session.progress,
        status: "completed",
        phase: "finalizing",
        percent: 100,
        outputPath: result.outputPath,
        error: null,
        checkpoint: null,
        resumeSupported: false,
      };
      updateJobStatus(this.options.db, jobId, "completed", {
        finishedAt: Date.now(),
        stats: createJobStats(plan, session.progress),
      });
      await this.options.refreshLibrariesContainingPaths([result.outputPath]);
    } catch (error) {
      const interrupted = error instanceof MediaMergeInterruptedError;
      const cancelled = !interrupted && (
        error instanceof MediaMergeCancelledError || controller.signal.aborted
      );
      const message = error instanceof Error ? error.message : String(error);
      const previousProgress = session?.progress
        ? {
          ...session.progress,
          phase: "finalizing" as const,
          percent: 100,
        }
        : {
          jobId,
          phase: "finalizing" as const,
          percent: 100,
          current: 0,
          total: plan.items.length,
          outputPath: null,
          checkpoint: null,
          resumeSupported: true,
        };
      const progress: MediaMergeProgress = {
        ...previousProgress,
        status: interrupted || !cancelled ? "failed" : "cancelled",
        error: cancelled ? null : message,
        resumeSupported: cancelled
          ? false
          : interrupted
            ? true
            : previousProgress.resumeSupported,
      };
      if (session) session.progress = progress;
      updateJobStatus(this.options.db, jobId, progress.status, {
        finishedAt: Date.now(),
        error: progress.status === "failed" ? message : undefined,
        stats: createJobStats(plan, progress),
      });
      this.emit(progress);
    }
  }

  private workspacePath(jobId: string | JobId): string {
    return join(this.options.tmpDir, "media-merge", jobId);
  }

  private persistProgress(
    jobId: string,
    plan: MediaMergePlan,
    progress: MediaMergeProgress,
  ): void {
    updateJobStatus(this.options.db, asJobId(jobId), progress.status, {
      stats: createJobStats(plan, progress),
    });
  }

  private emit(progress: MediaMergeProgress): void {
    for (const listener of this.listeners) listener(progress);
  }

  private async getAsset<TResult extends MediaMergeTimeline | MediaMergeWaveform>(
    kind: "timeline" | "waveform" | "duration",
    input: { path: string; selectedPaths: readonly string[] },
    build: (path: string) => Promise<TResult>,
  ): Promise<TResult> {
    try {
      const path = this.assertSelectedVideo(input.path, input.selectedPaths);
      const info = await stat(path);
      const key = [
        kind,
        path.replaceAll("\\", "/").toLowerCase(),
        info.size,
        Math.trunc(info.mtimeMs),
        1,
      ].join("|");
      const cached = this.assetCache.get(key);
      if (cached) {
        cached.usedAt = Date.now();
        return cached.promise as Promise<TResult>;
      }
      const promise = build(path).catch((error: unknown) => {
        this.assetCache.delete(key);
        throw error;
      });
      this.assetCache.set(key, { promise, usedAt: Date.now() });
      this.trimAssetCache();
      return await promise;
    } catch (error) {
      return {
        ...(kind === "duration"
          ? { durationSeconds: 0 }
          : kind === "timeline"
          ? { frames: [] }
          : { peaks: [], sampleRate: 0, durationSeconds: 0 }),
        error: error instanceof Error ? error.message : String(error),
      } as unknown as TResult;
    }
  }

  private assertSelectedVideo(path: string, selectedPaths: readonly string[]): string {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    if (!selectedPaths.some((selected) => selected.replaceAll("\\", "/").toLowerCase() === normalized)) {
      throw new Error("只能为当前合并列表中的视频生成时间轴");
    }
    return path;
  }

  private trimAssetCache(): void {
    while (this.assetCache.size > 32) {
      let oldestKey: string | null = null;
      let oldestUsedAt = Number.POSITIVE_INFINITY;
      for (const [key, value] of this.assetCache) {
        if (value.usedAt < oldestUsedAt) {
          oldestUsedAt = value.usedAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.assetCache.delete(oldestKey);
    }
  }
}

function createJobStats(
  plan: MediaMergePlan,
  progress: MediaMergeProgress,
): MediaMergeJobStats {
  return {
    kind: plan.kind,
    itemCount: plan.items.length,
    outputPath: progress.outputPath,
    progress,
    plan,
    checkpoint: progress.checkpoint ?? null,
  };
}

function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase().replace(/\/+$/, "");
}
