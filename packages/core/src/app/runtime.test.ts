import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { asEntryId, asJobId, asLibraryId, type Entry } from "@nestify/shared";
import { createJob, updateJobStatus } from "../db/repos/jobs.ts";
import { getEntryByPath, upsertEntry } from "../db/repos/index.ts";
import { MediaMergeWorkspace, mediaMergeStageCount } from "../media/resume.ts";
import { RuntimeMediaMergeCoordinator } from "./runtime-media-merge.ts";
import { inferRenameTarget } from "./runtime-rules.ts";
import { NestifyRuntime } from "./runtime.ts";

function createRuntime(): { runtime: NestifyRuntime; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "nestify-runtime-"));
  writeFileSync(join(root, "a.txt"), "a");
  writeFileSync(join(root, "b.txt"), "b");
  const runtime = new NestifyRuntime({ appDataRoot: join(root, "appdata") });
  return {
    runtime,
    root,
    cleanup: () => {
      runtime.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function createIsolatedScanRuntime(): { runtime: NestifyRuntime; root: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), "nestify-scan-settings-"));
  const root = join(base, "root");
  mkdirSync(root, { recursive: true });
  const runtime = new NestifyRuntime({ appDataRoot: join(base, "appdata") });
  return {
    runtime,
    root,
    cleanup: () => {
      runtime.close();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

function createScanSettingsTree(root: string): void {
  writeFileSync(join(root, "keep.txt"), "keep");
  writeFileSync(join(root, ".hidden.txt"), "hidden");
  writeFileSync(join(root, "excluded.skip"), "skip");
  mkdirSync(join(root, "nested", "deeper"), { recursive: true });
  writeFileSync(join(root, "nested", "deeper", "too-deep.txt"), "deep");
}

async function createPreviewRuntime(): Promise<{
  runtime: NestifyRuntime;
  root: string;
  scopedDirectory: string;
  cleanup: () => void;
}> {
  const root = mkdtempSync(join(tmpdir(), "nestify-preview-runtime-root-"));
  const scopedDirectory = join(root, "alpha");
  mkdirSync(scopedDirectory, { recursive: true });
  writeFileSync(join(root, "[4K]Outside.txt"), "outside");
  writeFileSync(join(scopedDirectory, "[4K]Inside.txt"), "inside");
  writeFileSync(join(scopedDirectory, "Keep.txt"), "keep");
  const runtime = new NestifyRuntime({ appDataRoot: join(root, "appdata") });
  const library = runtime.addLibrary({ name: "Preview", roots: [root] });
  await runtime.scanLibrary(library.id);
  return {
    runtime,
    root,
    scopedDirectory,
    cleanup: () => {
      runtime.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function entryPath(runtime: NestifyRuntime, libraryId: string, suffix: string): Entry["id"] {
  const entry = runtime
    .listLibraryEntries(libraryId)
    .find((item) => normalizeTestPath(item.path).endsWith(normalizeTestPath(suffix)));
  assert.ok(entry, `entry not found: ${suffix}`);
  return entry.id;
}

test("runtime runs a media merge job in the background", async () => {
  const context = createRuntime();
  try {
    const outputDirectory = join(context.root, "merge-output");
    mkdirSync(outputDirectory);
    const inputs: Array<string> = [];
    for (const name of ["01.png", "02.png"]) {
      const path = join(context.root, name);
      inputs.push(path);
      await sharp({
        create: { width: 32, height: 32, channels: 4, background: name === "01.png" ? "#ff0000" : "#0000ff" },
      }).png().toFile(path);
    }
    const infos = inputs.map((path) => statSync(path));
    const plan = await context.runtime.buildMediaMergePlan({
      kind: "image",
      items: inputs.map((path, index) => ({
        id: `image-${index}`,
        path,
        kind: "image" as const,
        size: infos[index]!.size,
        mtime: infos[index]!.mtimeMs,
        trimStart: 0,
        trimEndOffset: null,
        trimSource: "batch" as const,
        orderIndex: index,
        manualOrder: false,
      })),
      orderRule: "name-natural",
      outputDirectory,
      outputName: "merged",
      image: { format: "png", width: 16, gap: 0, background: "transparent" },
    });
    assert.equal(plan.summary.image?.height, 32);

    const started = context.runtime.startMediaMerge(plan);
    const deadline = Date.now() + 5000;
    let progress = context.runtime.getMediaMergeProgress(started.jobId);
    while (progress && ["running", "cancelling"].includes(progress.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      progress = context.runtime.getMediaMergeProgress(started.jobId);
    }
    assert.equal(progress?.status, "completed");
    assert.equal(progress?.outputPath, join(outputDirectory, "merged.png"));
    const job = context.runtime.listJobs().find((item) => item.id === started.jobId);
    assert.equal(job?.kind, "media-merge");
    assert.equal(job?.status, "completed");
    const stats = job?.stats as { progress?: { outputPath?: string }; plan?: { outputPath?: string } } | null;
    assert.equal(stats?.progress?.outputPath, join(outputDirectory, "merged.png"));
    assert.equal(stats?.plan?.outputPath, plan.outputPath);
  } finally {
    context.cleanup();
  }
});

test("startup reconciles interrupted media merge jobs as resumable failures", () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-media-recovery-"));
  const appDataRoot = join(root, "appdata");
  const runtime = new NestifyRuntime({ appDataRoot });
  try {
    createJob(runtime.db, {
      id: asJobId("media-interrupted"),
      kind: "media-merge",
      status: "running",
      startedAt: Date.now(),
      dryRun: false,
      stats: {
        kind: "image",
        itemCount: 2,
        outputPath: null,
        progress: {
          jobId: "media-interrupted",
          status: "running",
          phase: "processing",
          percent: 40,
          current: 1,
          total: 2,
          outputPath: null,
          error: null,
          checkpoint: null,
          resumeSupported: true,
        },
        plan: { version: 1 },
      },
    });
    runtime.close();

    const restarted = new NestifyRuntime({ appDataRoot });
    try {
      const job = restarted.listJobs().find((item) => item.id === "media-interrupted");
      assert.equal(job?.status, "failed");
      assert.match(job?.error ?? "", /重启时合并任务被中断/);
      const stats = job?.stats as { progress?: { resumeSupported?: boolean; error?: string } } | null;
      assert.equal(stats?.progress?.resumeSupported, true);
      assert.match(stats?.progress?.error ?? "", /重启时合并任务被中断/);
    } finally {
      restarted.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime explicitly resumes a failed media merge job", async () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-media-explicit-resume-"));
  const runtime = new NestifyRuntime({
    appDataRoot: join(root, "appdata"),
    fileSync: false,
  });
  try {
    const outputDirectory = join(root, "out");
    mkdirSync(outputDirectory);
    const paths = [join(root, "01.png"), join(root, "02.png")];
    for (const [index, path] of paths.entries()) {
      await sharp({
        create: {
          width: 24,
          height: 16,
          channels: 4,
          background: index === 0 ? "#ff0000" : "#0000ff",
        },
      }).png().toFile(path);
    }
    const infos = paths.map((path) => statSync(path));
    const plan = await runtime.buildMediaMergePlan({
      kind: "image",
      items: paths.map((path, index) => ({
        id: `image-${index}`,
        path,
        kind: "image" as const,
        size: infos[index]!.size,
        mtime: infos[index]!.mtimeMs,
        trimStart: 0,
        trimEndOffset: null,
        trimSource: "batch" as const,
        orderIndex: index,
        manualOrder: false,
      })),
      orderRule: "manual",
      outputDirectory,
      outputName: "resumed",
      image: { format: "png", width: 16, gap: 0, background: "transparent" },
    });
    const jobId = "media-explicit-resume";
    const workspacePath = join(runtime.paths.tmpDir, "media-merge", jobId);
    const workspace = await MediaMergeWorkspace.open({
      workspacePath,
      jobId,
      plan,
      totalStages: mediaMergeStageCount(plan),
    });
    const progress = {
      jobId,
      status: "failed" as const,
      phase: "processing" as const,
      percent: 20,
      current: 0,
      total: plan.items.length,
      outputPath: null,
      error: "模拟中断",
      checkpoint: workspace.checkpoint,
      resumeSupported: true,
    };
    createJob(runtime.db, {
      id: asJobId(jobId),
      kind: "media-merge",
      status: "failed",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      dryRun: false,
      error: "模拟中断",
      stats: {
        kind: "image",
        itemCount: plan.items.length,
        outputPath: null,
        progress,
        plan,
        checkpoint: workspace.checkpoint,
      },
    });

    const resumed = await runtime.resumeMediaMerge(jobId);
    assert.equal(resumed.status, "running");
    let current = runtime.getMediaMergeProgress(jobId);
    const deadline = Date.now() + 5000;
    while (current && ["running", "cancelling"].includes(current.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = runtime.getMediaMergeProgress(jobId);
    }
    assert.equal(current?.status, "completed");
    assert.equal(current?.outputPath, plan.outputPath);
    assert.equal(existsSync(plan.outputPath), true);
    assert.equal(existsSync(workspacePath), false);
    assert.equal(runtime.listJobs().find((job) => job.id === jobId)?.status, "completed");
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime clears failed media merge sessions before resume", async () => {
  const context = createRuntime();
  const outputDirectory = join(context.root, "resume-after-failure");
  mkdirSync(outputDirectory);
  const path = join(context.root, "01.png");
  await sharp({
    create: { width: 24, height: 16, channels: 4, background: "#00ff00" },
  }).png().toFile(path);
  const info = statSync(path);
  const plan = await context.runtime.buildMediaMergePlan({
    kind: "image",
    items: [{
      id: "image-0",
      path,
      kind: "image",
      size: info.size,
      mtime: info.mtimeMs,
      trimStart: 0,
      trimEndOffset: null,
      trimSource: "batch",
      orderIndex: 0,
      manualOrder: false,
    }],
    orderRule: "manual",
    outputDirectory,
    outputName: "recovered",
    image: { format: "png", width: 16, gap: 0, background: "transparent" },
  });
  let attempts = 0;
  const encoder = "h264_nvenc";
  const argv = ["-c:v", encoder, "-i", "generated-input.mp4", "generated-output.mp4"];
  const coordinator = new RuntimeMediaMergeCoordinator({
    db: context.runtime.db,
    tmpDir: context.runtime.paths.tmpDir,
    workerPath: "injected-worker",
    workerFactory: () => ({
      plan: async (input) => context.runtime.buildMediaMergePlan(input),
      execute: async (input) => {
        attempts += 1;
        input.onProgress?.({
          jobId: input.jobId,
          status: "running",
          phase: "processing",
          percent: 30,
          current: 0,
          total: input.plan.items.length,
          outputPath: null,
          error: null,
          checkpoint: null,
          resumeSupported: true,
          execution: {
            encoder,
            processor: "gpu",
            ffmpegPath: "generated-ffmpeg",
            commands: [{ stage: "merge", command: `generated-ffmpeg ${argv.join(" ")}`, args: argv }],
          },
        });
        if (attempts === 1) {
          const workspace = await MediaMergeWorkspace.open({
            workspacePath: input.workspacePath,
            jobId: input.jobId,
            plan: input.plan,
            totalStages: mediaMergeStageCount(input.plan),
          });
          input.onProgress?.({
            jobId: input.jobId,
            status: "failed",
            phase: "processing",
            percent: 25,
            current: 0,
            total: input.plan.items.length,
            outputPath: null,
            error: "simulated worker failure",
            checkpoint: workspace.checkpoint,
            resumeSupported: true,
          });
          throw new Error("simulated worker failure");
        }
        rmSync(input.workspacePath, { recursive: true, force: true });
        return { outputPath: input.plan.outputPath };
      },
      duration: async () => ({ durationSeconds: 0, error: null }),
      timeline: async () => ({ frames: [], error: null }),
      waveform: async () => ({ peaks: [], sampleRate: 0, durationSeconds: 0, error: null }),
      cancel: () => {},
      close: async () => {},
    }),
    refreshLibrariesContainingPaths: async () => {},
  });
  try {
    const started = coordinator.start(plan);
    const deadline = Date.now() + 5000;
    let progress = coordinator.getProgress(started.jobId);
    while (progress && ["running", "cancelling"].includes(progress.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      progress = coordinator.getProgress(started.jobId);
    }
    assert.equal(progress?.status, "failed");
    assert.equal(progress?.error, "simulated worker failure");
    assert.equal(progress?.execution?.encoder, encoder);
    assert.deepEqual(progress?.execution?.commands[0]?.args, argv);

    const resumed = await coordinator.resume(started.jobId);
    assert.equal(resumed.status, "running");
    let recovered = coordinator.getProgress(started.jobId);
    while (recovered && ["running", "cancelling"].includes(recovered.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      recovered = coordinator.getProgress(started.jobId);
    }
    assert.equal(recovered?.status, "completed");
    assert.equal(recovered?.outputPath, plan.outputPath);
    assert.equal(recovered?.execution?.encoder, encoder);
    assert.deepEqual(recovered?.execution?.commands[0]?.args, argv);
    assert.equal(attempts, 2);
  } finally {
    await coordinator.shutdown();
    context.cleanup();
  }
});

test("runtime resumes only failed media merge jobs", async () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-media-resume-status-"));
  const runtime = new NestifyRuntime({
    appDataRoot: join(root, "appdata"),
    fileSync: false,
  });
  try {
    for (const status of ["running", "completed", "cancelled"] as const) {
      const jobId = `media-${status}`;
      createJob(runtime.db, {
        id: asJobId(jobId),
        kind: "media-merge",
        status,
        startedAt: Date.now(),
        dryRun: false,
      });
      await assert.rejects(
        runtime.resumeMediaMerge(jobId),
        /只有失败的媒体合并任务可以恢复/,
      );
    }
    updateJobStatus(runtime.db, asJobId("media-completed"), "completed", {
      finishedAt: Date.now(),
    });
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("media merge timeline assets are restricted to selected video paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-media-assets-"));
  const videoPath = join(root, "selected.mp4");
  const outsidePath = join(root, "outside.mp4");
  writeFileSync(videoPath, "video");
  writeFileSync(outsidePath, "video");
  const runtime = new NestifyRuntime({ appDataRoot: join(root, "appdata"), fileSync: false });
  try {
    const timeline = await runtime.getMediaMergeTimeline({
      path: outsidePath,
      selectedPaths: [videoPath],
    });
    const waveform = await runtime.getMediaMergeWaveform({
      path: outsidePath,
      selectedPaths: [videoPath],
    });

    assert.deepEqual(timeline.frames, []);
    assert.match(timeline.error ?? "", /当前合并列表/);
    assert.deepEqual(waveform.peaks, []);
    assert.match(waveform.error ?? "", /当前合并列表/);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function normalizeTestPath(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

function indexedFile(id: string, libraryId: string, path: string): Entry {
  const name = path.split(/[\\/]/).at(-1) ?? id;
  const stem = name.replace(/\.[^.]+$/, "");
  const ext = name === stem ? "" : `.${name.split(".").at(-1)}`;
  return {
    id: asEntryId(id),
    libraryId: asLibraryId(libraryId),
    parentId: null,
    name,
    stem,
    ext,
    isDir: false,
    size: 10,
    mtime: 1,
    ctime: 1,
    atime: 1,
    ino: null,
    dev: null,
    depth: path.split(/[\\/]/).length - 2,
    kind: "file",
    protocol: "local",
    mime: null,
    path,
    parentPath: path.slice(0, path.lastIndexOf("/")),
    relPath: name,
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: 1,
    indexedAt: 1,
  };
}

function isWithin(path: string, directory: string): boolean {
  const normalized = normalizeTestPath(path);
  const prefix = normalizeTestPath(directory).replace(/\/+$/, "");
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

async function waitForScan(runtime: NestifyRuntime): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const active = runtime.getActiveScanJob();
    if (!active || !["running", "paused", "cancelling"].includes(active.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("scan did not finish");
}

test("scan can pause, resume, and preserves the original start time", async () => {
  const context = createRuntime();
  try {
    const library = context.runtime.addLibrary({ name: "Test", roots: [context.root] });
    const started = context.runtime.startScan(library.id);
    context.runtime.pauseScan(started.job.id);

    assert.equal(context.runtime.getScanProgress().paused, true);
    assert.equal(context.runtime.getScanProgress().jobId, started.job.id);
    assert.equal(context.runtime.getScanProgress().libraryId, library.id);
    assert.equal(context.runtime.getScanProgress().jobStatus, "paused");
    assert.equal(context.runtime.getActiveScanJob()?.status, "paused");
    assert.throws(() => context.runtime.removeLibrary(library.id), /scan is active/);

    const pausedJob = context.runtime.listJobs().find((job) => job.id === started.job.id);
    const resumed = context.runtime.resumeScan(started.job.id);
    assert.equal(resumed.job.status, "running");
    await waitForScan(context.runtime);

    const completedJob = context.runtime.listJobs().find((job) => job.id === started.job.id);
    assert.equal(completedJob?.status, "completed");
    assert.equal(completedJob?.startedAt, pausedJob?.startedAt);
    assert.equal(context.runtime.getScanProgress().jobId, null);
    assert.equal(context.runtime.getScanProgress().libraryId, null);
    assert.equal(context.runtime.getScanProgress().jobStatus, null);
  } finally {
    context.cleanup();
  }
});

test("scan can be cancelled", async () => {
  const context = createRuntime();
  try {
    const library = context.runtime.addLibrary({ name: "Test", roots: [context.root] });
    const started = context.runtime.startScan(library.id);
    context.runtime.cancelScan(started.job.id);
    await waitForScan(context.runtime);

    const job = context.runtime.listJobs().find((item) => item.id === started.job.id);
    assert.equal(job?.status, "cancelled");
  } finally {
    context.cleanup();
  }
});

test("scan job stores concrete filesystem errors instead of only an error count", async () => {
  const context = createIsolatedScanRuntime();
  try {
    const missingRoot = join(context.root, "missing");
    const library = context.runtime.addLibrary({ name: "Error details", roots: [context.root, missingRoot] });
    const scan = await context.runtime.scanLibrary(library.id);
    const job = context.runtime.listJobs({ libraryId: library.id }).find((item) => item.id === scan.jobId);

    assert.ok(job);
    assert.equal(job?.status, "completed");
    assert.match(job?.error ?? "", /读取错误/);
    const stats = job?.stats as { errors?: number; errorDetails?: Array<{ path?: string; operation?: string }> } | null;
    assert.ok((stats?.errors ?? 0) > 0);
    assert.ok(stats?.errorDetails?.some((error) => error.path === missingRoot));
    assert.ok(stats?.errorDetails?.some((error) => error.operation === "stat"));
  } finally {
    context.cleanup();
  }
});

test("runtime updates library settings through the repository", () => {
  const context = createRuntime();
  try {
    const library = context.runtime.addLibrary({ name: "Test", roots: [context.root] });
    const updated = context.runtime.updateLibrary({
      id: library.id,
      patch: {
        name: "Configured",
        roots: [join(context.root, "media")],
        excludeGlobs: ["*.tmp"],
        maxDepth: 3,
        followSymlinks: true,
        scanHidden: true,
        hashStrategy: "all",
        mediaStrategy: "deep",
        previewStrategy: "eager",
      },
    });

    assert.equal(updated.name, "Configured");
    assert.deepEqual(updated.roots, [join(context.root, "media")]);
    assert.deepEqual(updated.excludeGlobs, ["*.tmp"]);
    assert.equal(updated.maxDepth, 3);
    assert.equal(updated.followSymlinks, true);
    assert.equal(updated.scanHidden, true);
    assert.equal(updated.hashStrategy, "all");
    assert.equal(updated.mediaStrategy, "deep");
    assert.equal(updated.previewStrategy, "eager");
    assert.ok(updated.updatedAt >= library.updatedAt);
    assert.deepEqual(context.runtime.listLibraries(), [updated]);
  } finally {
    context.cleanup();
  }
});

test("database maintenance runs planner maintenance and returns timings", () => {
  const context = createRuntime();
  try {
    const result = context.runtime.maintainDatabase();

    assert.equal(typeof result.analyzeMs, "number");
    assert.equal(typeof result.optimizeMs, "number");
    assert.ok(result.analyzeMs >= 0);
    assert.ok(result.optimizeMs >= 0);
  } finally {
    context.cleanup();
  }
});

test("startScan applies library exclusion, hidden, and depth settings", async () => {
  const context = createIsolatedScanRuntime();
  try {
    createScanSettingsTree(context.root);
    const library = context.runtime.addLibrary({ name: "Configured", roots: [context.root] });
    context.runtime.updateLibrary({
      id: library.id,
      patch: {
        excludeGlobs: ["*.skip"],
        maxDepth: 1,
        scanHidden: true,
      },
    });

    await context.runtime.scanLibrary(library.id);
    const entries = context.runtime.listLibraryEntries(library.id);
    const names = new Set(entries.map((entry) => entry.name));

    assert.equal(names.has(".hidden.txt"), true);
    assert.equal(names.has("keep.txt"), true);
    assert.equal(names.has("nested"), true);
    assert.equal(names.has("excluded.skip"), false);
    assert.equal(names.has("deeper"), false);
    assert.equal(names.has("too-deep.txt"), false);
  } finally {
    context.cleanup();
  }
});

test("refreshAfterPlan applies updated library scan settings", async () => {
  const context = createIsolatedScanRuntime();
  try {
    createScanSettingsTree(context.root);
    const library = context.runtime.addLibrary({ name: "Refresh", roots: [context.root] });
    await context.runtime.scanLibrary(library.id);

    assert.equal(getEntryByPath(context.runtime.db, library.id, join(context.root, ".hidden.txt")), undefined);
    assert.ok(getEntryByPath(context.runtime.db, library.id, join(context.root, "excluded.skip")));
    assert.ok(getEntryByPath(context.runtime.db, library.id, join(context.root, "nested", "deeper", "too-deep.txt")));

    context.runtime.updateLibrary({
      id: library.id,
      patch: {
        excludeGlobs: ["*.skip"],
        maxDepth: 1,
        scanHidden: true,
      },
    });
    await context.runtime.refreshLibrary(library.id);

    assert.ok(getEntryByPath(context.runtime.db, library.id, join(context.root, ".hidden.txt")));
    assert.equal(
      getEntryByPath(context.runtime.db, library.id, join(context.root, "excluded.skip"))?.tombstone,
      true,
    );
    assert.equal(
      getEntryByPath(context.runtime.db, library.id, join(context.root, "nested", "deeper", "too-deep.txt"))?.tombstone,
      true,
    );
  } finally {
    context.cleanup();
  }
});

test("runtime duplicate analysis persists the latest result", async () => {
  const context = createRuntime();
  try {
    writeFileSync(join(context.root, "same-a.txt"), "same-bytes");
    writeFileSync(join(context.root, "same-b.txt"), "same-bytes");
    const library = context.runtime.addLibrary({ name: "Duplicates", roots: [context.root] });
    await context.runtime.scanLibrary(library.id);

    const first = await context.runtime.analyzeDuplicates({
      libraryId: library.id,
      keepStrategy: "newest",
    });
    assert.equal(first.groups.length, 1);
    assert.equal(first.persistence.groupsInserted, 1);
    assert.equal(first.persistence.membersInserted, 2);
    assert.equal(first.persistence.groupsSuperseded, 0);

    const second = await context.runtime.analyzeDuplicates({
      libraryId: library.id,
      keepStrategy: "newest",
    });
    assert.equal(second.persistence.groupsInserted, 1);
    assert.equal(second.persistence.membersInserted, 2);
    assert.equal(second.persistence.groupsSuperseded, 1);

    const statuses = context.runtime.db
      .prepare(`SELECT status, COUNT(*) AS count FROM dup_groups WHERE library_id = ? GROUP BY status`)
      .all(library.id) as Array<{ status: string; count: number }>;
    const plainStatuses = statuses.map((status) => ({ ...status }));
    assert.deepEqual(
      plainStatuses.sort((a, b) => a.status.localeCompare(b.status)),
      [
        { status: "open", count: 1 },
        { status: "superseded", count: 1 },
      ],
    );

    const members = context.runtime.db
      .prepare(`SELECT group_id, SUM(keep) AS keepCount FROM dup_members GROUP BY group_id`)
      .all() as Array<{ group_id: string; keepCount: number }>;
    assert.equal(members.length, 2);
    assert.ok(members.every((group) => group.keepCount === 1));
  } finally {
    context.cleanup();
  }
});

test("empty duplicate analysis still produces an executable runtime plan", async () => {
  const context = createRuntime();
  try {
    const library = context.runtime.addLibrary({ name: "Empty", roots: [context.root] });
    const analysis = await context.runtime.analyzeDuplicates({ libraryId: library.id });

    assert.equal(analysis.groups.length, 0);
    assert.equal(analysis.plan.libraryId, library.id);

    const executed = await context.runtime.executePlan({
      libraryId: library.id,
      plan: analysis.plan,
      selectedOps: [],
    });
    assert.equal(executed.status, "completed");
    assert.equal(executed.total, 0);

    const job = context.runtime.listJobs({ libraryId: library.id }).find(
      (item) => item.id === executed.jobId,
    );
    assert.equal(job?.kind, "plan-execute");
    assert.equal(job?.status, "completed");
  } finally {
    context.cleanup();
  }
});

test("preview rules restrict directory and selection scopes", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const outsideId = entryPath(context.runtime, library.id, "[4K]Outside.txt");

    const directoryPlan = context.runtime.previewRules({
      libraryId: library.id,
      ruleSetId: "download-inbox",
      scope: "directory",
      directory: context.scopedDirectory,
    });
    assert.equal(directoryPlan.ops.length, 1);
    assert.equal(directoryPlan.ops[0]?.entryId, insideId);
    assert.equal(directoryPlan.ops.some((op) => op.entryId === outsideId), false);

    const selectionPlan = context.runtime.previewRules({
      libraryId: library.id,
      ruleSetId: "download-inbox",
      scope: "selection",
      entryIds: [insideId],
    });
    assert.equal(selectionPlan.ops.length, 1);
    assert.equal(selectionPlan.ops[0]?.entryId, insideId);

    assert.throws(
      () =>
        context.runtime.previewRules({
          libraryId: library.id,
          ruleSetId: "download-inbox",
          scope: "selection",
          entryIds: [],
        }),
      /selection scope requires at least one entryId/,
    );
    assert.throws(
      () =>
        context.runtime.previewRules({
          libraryId: library.id,
          ruleSetId: "download-inbox",
          scope: "directory",
          directory: " ",
        }),
      /directory scope requires a directory/,
    );
  } finally {
    context.cleanup();
  }
});

test("preview rename restricts directory and selection scopes", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const directoryId = entryPath(context.runtime, library.id, "alpha");
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");
    const outsideId = entryPath(context.runtime, library.id, "[4K]Outside.txt");

    const directoryPlan = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.scopedDirectory,
    });
    assert.deepEqual(
      directoryPlan.ops.map((op) => op.entryId).sort(),
      [insideId, keepId].sort(),
    );
    assert.equal(
      directoryPlan.ops.every((op) => op.from && isWithin(op.from, context.scopedDirectory)),
      true,
    );

    const selectionPlan = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-selected{ext}",
      scope: "selection",
      entryIds: [insideId],
    });
    assert.deepEqual(selectionPlan.ops.map((op) => op.entryId), [insideId]);
    assert.equal(selectionPlan.ops.some((op) => op.entryId === outsideId), false);

    const directorySelectionPlan = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-selected{ext}",
      scope: "selection",
      entryIds: [directoryId],
    });
    assert.deepEqual(
      directorySelectionPlan.ops.map((op) => op.entryId).sort(),
      [insideId, keepId].sort(),
    );

    assert.throws(
      () =>
        context.runtime.previewRename({
          libraryId: library.id,
          template: "{name}",
          scope: "selection",
        }),
      /selection scope requires at least one entryId/,
    );
    assert.throws(
      () =>
        context.runtime.previewRename({
          libraryId: library.id,
          template: "{name}",
          scope: "directory",
        }),
      /directory scope requires a directory/,
    );
  } finally {
    context.cleanup();
  }
});

test("preview rename applies search filter before template matching", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");

    const filtered = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.scopedDirectory,
      filter: "Inside",
    });
    assert.deepEqual(filtered.ops.map((op) => op.entryId), [insideId]);
    assert.equal(filtered.ops.some((op) => op.entryId === keepId), false);

    const unfiltered = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.scopedDirectory,
    });
    assert.deepEqual(
      unfiltered.ops.map((op) => op.entryId).sort(),
      [insideId, keepId].sort(),
    );
  } finally {
    context.cleanup();
  }
});

test("preview rename pages the second-step candidate set with a cursor", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    for (const suffix of ["a", "b", "c", "d", "e"]) {
      writeFileSync(join(context.root, `page-${suffix}.txt`), suffix);
    }
    await context.runtime.scanLibrary(library.id);
    const ids = ["a", "b", "c", "d", "e"].map((suffix) =>
      entryPath(context.runtime, library.id, join(context.root, `page-${suffix}.txt`))
    );

    const first = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.root,
      filter: "file_name:page-",
      offset: 0,
      limit: 2,
    });
    const second = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.root,
      filter: "file_name:page-",
      offset: 2,
      limit: 2,
      seqCursor: first.seqCursor,
    });
    const third = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.root,
      filter: "file_name:page-",
      offset: 4,
      limit: 2,
      seqCursor: second.seqCursor,
    });

    const firstIds = first.ops.map((op) => op.entryId);
    const secondIds = second.ops.map((op) => op.entryId);
    const thirdIds = third.ops.map((op) => op.entryId);
    assert.equal(firstIds.length, 2);
    assert.equal(secondIds.length, 2);
    assert.equal(thirdIds.length, 1);
    assert.deepEqual([...firstIds, ...secondIds, ...thirdIds].sort(), [...ids].sort());
  } finally {
    context.cleanup();
  }
});

test("paged rename with an empty rule keeps the second-step source page", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");
    const plan = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      groups: [{ filter: "", template: "{stem}-renamed{ext}" }],
      scope: "directory",
      directory: context.scopedDirectory,
      filter: "kind:file",
      offset: 0,
      limit: 200,
    });

    assert.deepEqual(plan.ops.map((op) => op.entryId).sort(), [insideId, keepId].sort());
    assert.equal(plan.sourceCount, 2);
    assert.equal(plan.matchedCount, 2);
  } finally {
    context.cleanup();
  }
});

test("paged rename filters only the current second-step source page", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    for (const suffix of ["a", "b", "c", "d", "e"]) {
      writeFileSync(join(context.root, `source-${suffix}.txt`), suffix);
    }
    await context.runtime.scanLibrary(library.id);
    const input = {
      libraryId: library.id,
      template: "matched-{seq}{ext}",
      scope: "directory" as const,
      directory: context.root,
      filter: "file_name:source-",
      groups: [{ filter: "file_name:source-e", template: "matched-{seq}{ext}" }],
    };

    const first = context.runtime.previewRename({ ...input, offset: 0, limit: 2 });
    const third = context.runtime.previewRename({ ...input, offset: 4, limit: 2, seqCursor: first.seqCursor });

    assert.equal(first.sourceOffset, 0);
    assert.equal(first.sourceCount, 2);
    assert.equal(first.matchedCount, 0);
    assert.deepEqual(first.ops, []);
    assert.equal(first.sourceHasMore, true);

    assert.equal(third.sourceOffset, 4);
    assert.equal(third.sourceCount, 1);
    assert.equal(third.matchedCount, 1);
    assert.equal(third.ops.length, 1);
    assert.equal(third.sourceHasMore, false);
  } finally {
    context.cleanup();
  }
});

test("paged rename preview detects unselected target siblings", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    writeFileSync(join(context.root, "source-a.txt"), "a");
    writeFileSync(join(context.root, "target.txt"), "existing");
    await context.runtime.scanLibrary(library.id);
    const input = {
      libraryId: library.id,
      template: "target.txt",
      scope: "directory" as const,
      directory: context.root,
      filter: "file_name:source-a.txt",
      collision: "suffix" as const,
    };

    const full = context.runtime.previewRename(input);
    const paged = context.runtime.previewRename({ ...input, offset: 0, limit: 2 });
    assert.equal(paged.ops.length, full.ops.length);
    assert.equal(paged.ops[0]?.to, full.ops[0]?.to);
    assert.match(String(paged.ops[0]?.to), /target \(1\)\.txt$/i);
    assert.equal(paged.summary.conflicts, full.summary.conflicts);
  } finally {
    context.cleanup();
  }
});

test("preview rename applies first matching group and catch-all remainder", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");

    const grouped = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-fallback{ext}",
      scope: "directory",
      directory: context.scopedDirectory,
      groups: [
        { filter: "Inside", template: "{stem}-inside{ext}" },
        { filter: "", template: "{stem}-rest{ext}" },
      ],
    });
    const byId = new Map(grouped.ops.map((op) => [op.entryId, op.to]));
    assert.equal(grouped.ops.length, 2);
    assert.match(String(byId.get(insideId)), /Inside-inside\.txt$/i);
    assert.match(String(byId.get(keepId)), /Keep-rest\.txt$/i);
  } finally {
    context.cleanup();
  }
});

test("preview rename applies every matching rule group as an OR within the outer scope", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");

    const grouped = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-fallback{ext}",
      scope: "directory",
      directory: context.scopedDirectory,
      filter: "kind:file",
      groups: [
        { filter: "file_name:Inside", template: "{stem}-inside{ext}" },
        { filter: "file_name:Keep", template: "{stem}-keep{ext}" },
      ],
    });

    const byId = new Map(grouped.ops.map((op) => [op.entryId, op.to]));
    assert.equal(grouped.ops.length, 2);
    assert.match(String(byId.get(insideId)), /Inside-inside\.txt$/i);
    assert.match(String(byId.get(keepId)), /Keep-keep\.txt$/i);
  } finally {
    context.cleanup();
  }
});

test("preview rename combines outer AND with grouped OR expressions and keeps group priority", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");
    const outsideId = entryPath(context.runtime, library.id, "[4K]Outside.txt");

    const grouped = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-fallback{ext}",
      scope: "directory",
      directory: context.root,
      filter: "kind:file AND (file_name:Inside OR file_name:Keep)",
      groups: [
        {
          filter: "file_name:Inside OR file_name:Keep",
          template: "{stem}-first{ext}",
        },
        {
          filter: "file_name:Keep OR file_name:Outside",
          template: "{stem}-second{ext}",
        },
      ],
    });

    const byId = new Map(grouped.ops.map((op) => [op.entryId, op.to]));
    assert.equal(grouped.ops.length, 2);
    assert.match(String(byId.get(insideId)), /Inside-first\.txt$/i);
    assert.match(String(byId.get(keepId)), /Keep-first\.txt$/i);
    assert.equal(byId.has(outsideId), false);
  } finally {
    context.cleanup();
  }
});

test("preview rename with kind:dir plans directories and empty filter keeps the current page", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const directoryId = entryPath(context.runtime, library.id, "alpha");
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");

    const unfiltered = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.scopedDirectory,
    });
    assert.deepEqual(unfiltered.ops.map((op) => op.entryId).sort(), [insideId, keepId].sort());
    assert.equal(unfiltered.ops.some((op) => op.entryId === directoryId), false);

    const dirs = context.runtime.previewRename({
      libraryId: library.id,
      template: "{name}-folder",
      scope: "directory",
      directory: context.scopedDirectory,
      filter: "kind:dir",
    });
    assert.deepEqual(dirs.ops.map((op) => op.entryId), [directoryId]);
    assert.match(String(dirs.ops[0]?.to), /alpha-folder$/i);

    const mixed = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.scopedDirectory,
      filter: "kind:dir|file",
    });
    assert.deepEqual(
      mixed.ops.map((op) => op.entryId).sort(),
      [directoryId, insideId, keepId].sort(),
    );
  } finally {
    context.cleanup();
  }
});

test("preview rename applies a single group's folder_name filter", async () => {
  const context = createRuntime();
  try {
    mkdirSync(join(context.root, "folder-match-unique"));
    mkdirSync(join(context.root, "folder-b"));
    writeFileSync(join(context.root, "file-a.txt"), "file");
    const library = context.runtime.addLibrary({ name: "Single Group", roots: [context.root] });
    await context.runtime.scanLibrary(library.id);

    const matchedId = entryPath(context.runtime, library.id, "folder-match-unique");
    const otherDirectoryId = entryPath(context.runtime, library.id, "folder-b");
    const fileId = entryPath(context.runtime, library.id, "file-a.txt");
    const plan = context.runtime.previewRename({
      libraryId: library.id,
      template: "{name}-renamed",
      groups: [{ filter: "kind:dir AND folder_name:match-unique", template: "{name}-renamed" }],
      scope: "directory",
      directory: context.root,
    });

    assert.deepEqual(plan.ops.map((op) => op.entryId), [matchedId]);
    assert.equal(plan.ops.some((op) => op.entryId === otherDirectoryId), false);
    assert.equal(plan.ops.some((op) => op.entryId === fileId), false);
  } finally {
    context.cleanup();
  }
});

test("paged rename with a directory source page does not include child files", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const directoryId = entryPath(context.runtime, library.id, "alpha");
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");
    const plan = context.runtime.previewRename({
      libraryId: library.id,
      template: "{name}-folder",
      groups: [{ filter: "", template: "{name}-folder" }],
      scope: "directory",
      directory: context.scopedDirectory,
      filter: "kind:dir",
      offset: 0,
      limit: 200,
    });

    assert.deepEqual(plan.ops.map((op) => op.entryId), [directoryId]);
    assert.equal(plan.ops.some((op) => op.entryId === insideId || op.entryId === keepId), false);
    assert.equal(plan.sourceCount, 1);
    assert.equal(plan.matchedCount, 1);
  } finally {
    context.cleanup();
  }
});

test("paged rename finds a function-filtered directory only on its source page", async () => {
  const context = createRuntime();
  try {
    const directory = join(context.root, "scope");
    mkdirSync(directory);
    for (const suffix of ["a", "b", "c", "d", "e"]) {
      writeFileSync(join(directory, `source-${suffix}.txt`), suffix);
    }
    mkdirSync(join(directory, "target-dir"));
    const library = context.runtime.addLibrary({ name: "Function Filter Page", roots: [context.root] });
    await context.runtime.scanLibrary(library.id);

    const matchedId = entryPath(context.runtime, library.id, join(directory, "target-dir"));
    const input = {
      libraryId: library.id,
      template: "{name.after('-').trim()}",
      groups: [{
        filter: "kind:dir AND folder_name.contains('-')",
        template: "{name.after('-').trim()}",
      }],
      scope: "directory" as const,
      directory,
    };
    const pages: Array<ReturnType<typeof context.runtime.previewRename>> = [];
    let cursor: import("@nestify/shared").PlanSeqCursor | undefined;
    for (let offset = 0; offset < 8; offset += 2) {
      const page = context.runtime.previewRename({ ...input, offset, limit: 2, seqCursor: cursor });
      pages.push(page);
      cursor = page.seqCursor;
      if (!page.sourceHasMore) break;
    }

    assert.deepEqual(pages.flatMap((page) => page.ops.map((op) => op.entryId)), [matchedId]);
    assert.equal(pages[0]?.ops.length, 0);
    const matchedPage = pages.find((page) => page.ops.length > 0);
    assert.match(String(matchedPage?.ops[0]?.to), /dir$/i);
    assert.equal(matchedPage?.matchedCount, 1);
  } finally {
    context.cleanup();
  }
});

test("rename target inference stays conservative for negated filters", () => {
  assert.equal(inferRenameTarget("NOT kind:dir"), "file");
  assert.equal(inferRenameTarget("NOT folder_name:temporary"), "all");
  assert.equal(inferRenameTarget("NOT kind:video"), "all");
  assert.equal(inferRenameTarget("kind:dir AND (folder_name:one OR folder_name:two)"), "dir");
});

test("preview rename directory plus entryIds only plans selected files", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    const insideId = entryPath(context.runtime, library.id, "[4K]Inside.txt");
    const keepId = entryPath(context.runtime, library.id, "Keep.txt");

    const selected = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-selected{ext}",
      scope: "directory",
      directory: context.scopedDirectory,
      entryIds: [insideId],
    });
    assert.deepEqual(selected.ops.map((op) => op.entryId), [insideId]);
    assert.equal(selected.ops.some((op) => op.entryId === keepId), false);
  } finally {
    context.cleanup();
  }
});
test("directory scope matches files directly under a Windows drive root", () => {
  const context = createRuntime();
  try {
    const library = context.runtime.addLibrary({ name: "Drive", roots: ["C:\\"] });
    upsertEntry(context.runtime.db, indexedFile("root-file", library.id, "C:/root.txt"));
    upsertEntry(context.runtime.db, indexedFile("nested-file", library.id, "C:/media/nested.txt"));

    const plan = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: "C:\\",
    });

    const mediaId = plan.ops.find((op) => op.from && normalizeTestPath(op.from).endsWith("/media"))?.entryId;
    assert.ok(mediaId);
    assert.deepEqual(plan.ops.map((op) => op.entryId).sort(), [mediaId, "root-file"].sort());
    assert.equal(plan.ops.some((op) => op.entryId === "nested-file"), false);
  } finally {
    context.cleanup();
  }
});

test("default rename preview pages direct children and keeps unchanged names", async () => {
  const context = await createPreviewRuntime();
  try {
    const library = context.runtime.listLibraries()[0]!;
    mkdirSync(join(context.root, "nested"));
    writeFileSync(join(context.root, "nested", "child.txt"), "child");
    writeFileSync(join(context.root, "page-a.txt"), "a");
    writeFileSync(join(context.root, "page-b.txt"), "b");
    writeFileSync(join(context.root, "page-c.txt"), "c");
    await context.runtime.scanLibrary(library.id);

    const outsideId = entryPath(context.runtime, library.id, "[4K]Outside.txt");
    const nestedId = entryPath(context.runtime, library.id, "nested");
    const rootId = entryPath(context.runtime, library.id, context.root);
    const alphaId = entryPath(context.runtime, library.id, "alpha");
    const appDataId = entryPath(context.runtime, library.id, "appdata");
    const childId = entryPath(context.runtime, library.id, join("nested", "child.txt"));
    const pageIds = ["a", "b", "c"].map((suffix) =>
      entryPath(context.runtime, library.id, `page-${suffix}.txt`),
    );

    const unfiltered = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.root,
    });
    const unfilteredIds = unfiltered.ops.map((op) => op.entryId);
    assert.equal(unfilteredIds.includes(outsideId), true);
    assert.equal(unfilteredIds.includes(nestedId), true);
    assert.equal(unfilteredIds.includes(childId), false);
    assert.ok(unfiltered.ops.length > 0);

    const unchanged = context.runtime.previewRename({
      libraryId: library.id,
      template: "{name}{ext}",
      scope: "directory",
      directory: context.root,
      filter: "file_name:page-a.txt",
    });
    assert.equal(unchanged.ops.length, 1);
    assert.equal(unchanged.ops[0]?.entryId, pageIds[0]);
    assert.equal(unchanged.ops[0]?.from, unchanged.ops[0]?.to);
    assert.equal(unchanged.ops[0]?.risk, "none");
    assert.equal(unchanged.ops[0]?.selected, false);
    assert.equal(unchanged.ops[0]?.reason, "名称未变化");

    const dirs = context.runtime.previewRename({
      libraryId: library.id,
      template: "{name}-folder",
      scope: "directory",
      directory: context.root,
      filter: "kind:dir",
    });
    assert.deepEqual(dirs.ops.map((op) => op.entryId).sort(), [alphaId, appDataId, nestedId].sort());
    assert.equal(dirs.ops.some((op) => op.entryId === childId), false);

    const first = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.root,
      filter: "file_name:page-",
      offset: 0,
      limit: 2,
    });
    const second = context.runtime.previewRename({
      libraryId: library.id,
      template: "{stem}-renamed{ext}",
      scope: "directory",
      directory: context.root,
      filter: "file_name:page-",
      offset: 2,
      limit: 2,
    });
    assert.equal(first.ops.length, 2);
    assert.equal(first.sourceCount, 2);
    assert.equal(first.sourceHasMore, true);
    assert.equal(second.ops.length, 1);
    assert.equal(second.sourceCount, 1);
    assert.equal(second.sourceHasMore, false);
    assert.deepEqual(
      [...first.ops, ...second.ops].map((op) => op.entryId).sort(),
      [...pageIds].sort(),
    );

    const currentPage = context.runtime.listDirectoryChildren(library.id, context.root, {
      offset: 0,
      limit: 200,
    });
    const defaultTemplate = context.runtime.previewRename({
      libraryId: library.id,
      template: "{name}{ext}",
      groups: [{ filter: "", template: "{name}{ext}" }],
      scope: "directory",
      directory: context.root,
      offset: 0,
      limit: 200,
    });
    assert.ok(currentPage.hits.length > 0);
    assert.equal(defaultTemplate.ops.length, currentPage.hits.length);
    assert.ok(defaultTemplate.ops.length > 0);
    assert.deepEqual(
      defaultTemplate.ops.map((op) => op.entryId),
      currentPage.hits.map((hit) => hit.entryId),
    );
    assert.equal(defaultTemplate.ops.every((op) => op.from === op.to && op.selected === false), true);

    const filteredChildren = context.runtime.listDirectoryChildren(library.id, context.root, {
      offset: 0,
      limit: 200,
    }).hits.filter((hit) => hit.name.toLowerCase().includes("page"));
    const bracketTemplate = context.runtime.previewRename({
      libraryId: library.id,
      template: "{parent}_{name.regex_replace('\\\\[.*?\\\\]', '').trim()}{ext}",
      groups: [{ filter: "", template: "{parent}_{name.regex_replace('\\\\[.*?\\\\]', '').trim()}{ext}" }],
      scope: "directory",
      directory: context.root,
      filter: "page",
      offset: 0,
      limit: 200,
    });
    assert.ok(filteredChildren.length > 0);
    assert.deepEqual(
      bracketTemplate.ops.map((op) => op.entryId),
      filteredChildren.map((hit) => hit.entryId),
    );
    const bracketOp = bracketTemplate.ops.find((op) => normalizeTestPath(op.from).endsWith("/page-a.txt"));
    assert.ok(bracketOp);
    assert.notEqual(normalizeTestPath(bracketOp.from), normalizeTestPath(bracketOp.to ?? ""));
    assert.match(normalizeTestPath(bracketOp.to ?? ""), /page-a\.txt$/);
  } finally {
    context.cleanup();
  }
});

test("custom rulesets persist lifecycle and YAML round-trips while builtins stay readonly", () => {
  const context = createRuntime();
  try {
    const builtins = context.runtime.listRuleSets().filter((item) => item.id === "download-inbox");
    assert.equal(builtins.length, 1);
    assert.equal(builtins[0]?.enabled, true);
    assert.equal(builtins[0]?.builtin, true);

    const clone = context.runtime.cloneRuleSet("download-inbox", {
      name: "Download copy",
      priority: 10,
    });
    assert.notEqual(clone.id, "download-inbox");
    assert.equal(clone.builtin, false);
    assert.equal(clone.priority, 10);
    assert.equal(context.runtime.getRuleSet(clone.id)?.name, "Download copy");

    const updated = context.runtime.updateRuleSet(clone.id, {
      dryRunDefault: false,
      rules: [
        {
          id: "quarantine-archive",
          enabled: true,
          priority: 1,
          action: "delete_to_quarantine",
          match: { field: "kind", eq: "archive" },
        },
      ],
    });
    assert.equal(updated.dryRunDefault, true);

    const disabled = context.runtime.setRuleSetEnabled(clone.id, false);
    assert.equal(disabled.enabled, false);

    const exported = context.runtime.exportRuleSet(clone.id);
    const imported = context.runtime.importRuleSet(exported);
    assert.notEqual(imported.id, clone.id);
    assert.equal(imported.name, clone.name);
    assert.equal(imported.dryRunDefault, true);

    assert.throws(() => context.runtime.updateRuleSet("download-inbox", { name: "No" }), /readonly/);
    assert.throws(() => context.runtime.deleteRuleSet("download-inbox"), /readonly/);
    assert.throws(() => context.runtime.setRuleSetEnabled("media-rename", false), /readonly/);

    context.runtime.deleteRuleSet(imported.id);
    assert.equal(context.runtime.getRuleSet(imported.id), undefined);
    assert.ok(context.runtime.getRuleSet("download-inbox"));
  } finally {
    context.cleanup();
  }
});
