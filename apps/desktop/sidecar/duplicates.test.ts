import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { asEntryId, asJobId, asLibraryId, asPlanId, type ChangePlan, type Entry } from "@nestify/shared";
import {
  createJob,
  createLibrary,
  getJobById,
  updateJobStatus,
  upsertEntry,
} from "../../../packages/core/src/db/repos/index.ts";
import { openDatabase } from "../../../packages/core/src/db/open.ts";
import { persistDuplicateAnalysis } from "../../../packages/core/src/duplicates/persistence.ts";
import { handleRpc, type HostContext } from "./handlers.ts";

const tempDirs: string[] = [];
const tempDbs: Array<ReturnType<typeof openDatabase>> = [];

after(() => {
  for (const db of tempDbs) db.close();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test("duplicate sidecar queries are paged and keep updates persist", async () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-sidecar-duplicates-"));
  tempDirs.push(root);
  const jobId = "sidecar-duplicate-job";
  const db = openDatabase(join(root, "data.db"));
  tempDbs.push(db);
  createLibrary(db, { id: "lib-sidecar", name: "Sidecar", roots: [root] });
  upsertEntry(db, entry("dup-a", join(root, "a.txt"), 20));
  upsertEntry(db, entry("dup-b", join(root, "b.txt"), 10));
  createJob(db, {
    id: asJobId(jobId),
    libraryId: asLibraryId("lib-sidecar"),
    kind: "duplicates",
    status: "running",
    startedAt: 1,
  });
  persistDuplicateAnalysis(db, {
    libraryId: "lib-sidecar",
    analysisId: jobId,
    analyzedAt: 2,
    result: {
      hashStrategy: "duplicate-candidate-only",
      groups: [{
        id: "sidecar-group",
        status: "confirmed",
        hash: "0".repeat(64),
        size: 10,
        wastedBytes: 10,
        files: [
          { entryId: "dup-a", name: "a.txt", path: join(root, "a.txt"), kind: "file", size: 10, mtime: 10, keep: false },
          { entryId: "dup-b", name: "b.txt", path: join(root, "b.txt"), kind: "file", size: 10, mtime: 20, keep: true },
        ],
      }],
      plan: {
        id: "sidecar-source-plan",
        libraryId: "lib-sidecar",
        createdAt: 2,
        status: "draft",
        dryRun: true,
        collision: "suffix",
        summary: { selected: 0, rename: 0, move: 0, mkdir: 0, quarantine: 0, delete: 0, flatten: 0, conflicts: 0 },
        ops: [],
      },
    },
  });
  updateJobStatus(db, asJobId(jobId), "completed", { finishedAt: 3 });

  const state = {
    runtime: { db, paths: { quarantineDir: join(root, ".quarantine") } },
    duplicateAnalysisJobs: new Map(),
    duplicateAnalysisProgress: null,
    duplicateAnalysisProgressByJob: new Map(),
    emit: () => undefined,
  } as never as HostContext;

  const result = await handleRpc(state, "duplicates.result", { jobId, offset: 0, limit: 1 }) as {
    result: { total: number; groups: Array<{ id: string; files: [] }>; selectedCount: number };
  };
  const resultPage = result.result;
  assert.equal(resultPage.total, 1);
  assert.equal(resultPage.groups.length, 1);
  assert.equal(resultPage.groups[0]?.files.length, 0);
  assert.equal(resultPage.selectedCount, 1);

  const files = await handleRpc(state, "duplicates.files", { jobId, offset: 0, limit: 1 }) as {
    result: { files: Array<{ entryId: string }>; total: number; hasMore: boolean; plan: { ops: unknown[] } };
  };
  const filesPage = files.result;
  assert.equal(filesPage.total, 2);
  assert.equal(filesPage.files.length, 1);
  assert.equal(filesPage.hasMore, true);
  assert.equal(filesPage.plan.ops.length, 1);

  const plan = await handleRpc(state, "duplicates.plan", { jobId }) as { plan: { ops: unknown[] } };
  assert.equal(plan.plan.ops.length, 1);

  const keep = await handleRpc(state, "duplicates.keep", {
    jobId,
    groupId: "sidecar-group",
    entryId: "dup-a",
    keep: true,
  }) as { result: { selectedCount: number } };
  assert.equal(keep.result.selectedCount, 1);

  const groupStrategy = await handleRpc(state, "duplicates.groupStrategy", {
    jobId,
    groupId: "sidecar-group",
    keepStrategy: "oldest",
  }) as { result: { selectedCount: number } };
  assert.equal(groupStrategy.result.selectedCount, 1);

  const strategy = await handleRpc(state, "duplicates.strategy", {
    jobId,
    keepStrategy: "newest",
  }) as { result: { selectedCount: number } };
  assert.equal(strategy.result.selectedCount, 1);
});

function entry(id: string, path: string, mtime: number, libraryId = "lib-sidecar"): Entry {
  return {
    id: asEntryId(id),
    libraryId: asLibraryId(libraryId),
    parentId: null,
    name: id,
    stem: id,
    ext: ".txt",
    isDir: false,
    size: 10,
    mtime,
    ctime: mtime,
    atime: mtime,
    ino: id,
    dev: "dev-sidecar",
    depth: 1,
    kind: "file",
    protocol: "local",
    mime: null,
    path,
    parentPath: null,
    relPath: path,
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: mtime,
    indexedAt: mtime,
  };
}

test("duplicate analysis exposes completion only after its job is queryable", async () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-sidecar-duplicate-worker-"));
  tempDirs.push(root);
  const completedJobStatuses: string[] = [];
  const db = openDatabase(join(root, "data.db"));
  tempDbs.push(db);
  createLibrary(db, { id: "lib-worker", name: "Worker", roots: [root] });

  const contents = ["alpha", "bravo", "charlie"];
  let sequence = 0;
  for (const [groupIndex, content] of contents.entries()) {
    for (let index = 0; index < 2; index += 1) {
      sequence += 1;
      const path = join(root, `group-${groupIndex}`, `file-${index}.txt`);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content.repeat(100));
      upsertEntry(db, entry(`worker-${sequence}`, path, 1000 + sequence, "lib-worker"));
    }
  }

  const state = {
    runtime: { db, paths: { dbPath: join(root, "data.db"), quarantineDir: join(root, ".quarantine") } },
    duplicateAnalysisJobs: new Map(),
    duplicateAnalysisProgress: null,
    duplicateAnalysisProgressByJob: new Map(),
    workerPath: (name: string) =>
      join(fileURLToPath(new URL(".", import.meta.url)), "..", "runtime", name.replace(/\.mjs$/, ".ts")),
    emit: (_event: string, payload: { jobId?: string; status?: string }) => {
      if (payload.status !== "completed" || !payload.jobId) return
      completedJobStatuses.push(getJobById(db, asJobId(payload.jobId))?.status ?? "missing")
    },
  } as never as HostContext;

  const started = await handleRpc(state, "duplicates.analyze", {
    libraryId: "lib-worker",
    scope: "library",
    keepStrategy: "newest",
  }) as { jobId: string };
  assert.equal(state.duplicateAnalysisJobs.size, 1);

  await state.duplicateAnalysisJobs.get(started.jobId)?.completion;
  assert.equal(getJobById(db, asJobId(started.jobId))?.status, "completed");
  assert.deepEqual(completedJobStatuses, ["completed"]);

  const page = await handleRpc(state, "duplicates.result", {
    jobId: started.jobId,
    offset: 0,
    limit: 2,
  }) as { result: { total: number; groups: unknown[]; hasMore: boolean } };
  assert.equal(page.result.total, 3);
  assert.equal(page.result.groups.length, 2);
  assert.equal(page.result.hasMore, true);
});

test("plan execution starts without waiting for the worker to finish", async () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-sidecar-plan-start-"));
  tempDirs.push(root);
  const db = openDatabase(join(root, "data.db"));
  tempDbs.push(db);
  createLibrary(db, { id: "lib-plan", name: "Plan", roots: [root] });
  const from = join(root, "from.txt");
  const to = join(root, "to.txt");
  writeFileSync(from, "payload");
  upsertEntry(db, entry("plan-file", from, 10, "lib-plan"));

  let releaseTail: () => void = () => undefined;
  const events: Array<{ event: string; payload: unknown }> = [];
  const state = {
    runtime: {
      db,
      paths: { dbPath: join(root, "data.db"), quarantineDir: join(root, ".quarantine") },
      getActiveScanJob: () => null,
    },
    planExecutions: new Map(),
    planExecutionProgress: null,
    fileOperationTail: new Promise<void>((resolve) => {
      releaseTail = resolve;
    }),
    workerPath: (name: string) =>
      join(fileURLToPath(new URL(".", import.meta.url)), "..", "runtime", name.replace(/\.mjs$/, ".ts")),
    emit: (event: string, payload: unknown) => events.push({ event, payload }),
  } as never as HostContext;

  const startedAt = Date.now();
  const started = await handleRpc(state, "plan.execute.start", {
    libraryId: "lib-plan",
    module: "rename",
    plan: renamePlan(from, to, "plan-file", "lib-plan"),
    selectedOps: [0],
  }) as { requestId: string; jobId: string };
  assert.ok(Date.now() - startedAt < 1_000);

  const queued = await handleRpc(state, "plan.execution", { requestId: started.requestId }) as {
    status: string;
    jobId: string;
  };
  assert.equal(queued.status, "queued");
  assert.equal(queued.jobId, started.jobId);
  assert.equal(getJobById(db, asJobId(started.jobId)), null);

  releaseTail();
  await state.planExecutions.get(started.requestId)?.completion;

  assert.equal(getJobById(db, asJobId(started.jobId))?.status, "completed");
  assert.equal(existsSync(to), true);
  assert.equal(existsSync(from), false);
  assert.ok(events.some(({ event, payload }) =>
    event === "plan.execution-finished"
    && (payload as { requestId?: string }).requestId === started.requestId,
  ));
});

test("duplicate execution builds its plan in the task worker", async () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-sidecar-duplicate-execute-"));
  tempDirs.push(root);
  const db = openDatabase(join(root, "data.db"));
  tempDbs.push(db);
  createLibrary(db, { id: "lib-duplicate-execute", name: "Duplicate Execute", roots: [root] });
  const kept = join(root, "kept.txt");
  const deselected = join(root, "deselected.txt");
  writeFileSync(kept, "same");
  writeFileSync(deselected, "same");
  upsertEntry(db, entry("dup-execute-kept", kept, 10, "lib-duplicate-execute"));
  upsertEntry(db, entry("dup-execute-deselected", deselected, 20, "lib-duplicate-execute"));
  const duplicateJobId = "duplicate-execute-source";
  createJob(db, {
    id: asJobId(duplicateJobId),
    libraryId: asLibraryId("lib-duplicate-execute"),
    kind: "duplicates",
    status: "running",
    startedAt: 1,
  });
  persistDuplicateAnalysis(db, {
    libraryId: "lib-duplicate-execute",
    analysisId: duplicateJobId,
    analyzedAt: 2,
    result: {
      hashStrategy: "duplicate-candidate-only",
      groups: [{
        id: "duplicate-execute-group",
        status: "open",
        hash: "1".repeat(64),
        size: 4,
        wastedBytes: 4,
        files: [
          { entryId: "dup-execute-deselected", name: "deselected.txt", path: deselected, kind: "file", size: 4, mtime: 10, keep: false },
          { entryId: "dup-execute-kept", name: "kept.txt", path: kept, kind: "file", size: 4, mtime: 20, keep: true },
        ],
      }],
      plan: emptyPlan("lib-duplicate-execute"),
    },
  });
  updateJobStatus(db, asJobId(duplicateJobId), "completed", { finishedAt: 3 });

  const state = {
    runtime: {
      db,
      paths: { dbPath: join(root, "data.db"), quarantineDir: join(root, ".quarantine") },
      getActiveScanJob: () => null,
    },
    planExecutions: new Map(),
    planExecutionProgress: null,
    fileOperationTail: Promise.resolve(),
    workerPath: (name: string) =>
      join(fileURLToPath(new URL(".", import.meta.url)), "..", "runtime", name.replace(/\.mjs$/, ".ts")),
    emit: () => undefined,
  } as never as HostContext;

  const started = await handleRpc(state, "plan.execute.start", {
    libraryId: "lib-duplicate-execute",
    module: "duplicates",
    duplicateJobId,
    duplicateKind: "file",
    deselectedEntryIds: ["dup-execute-deselected"],
  }) as { requestId: string; jobId: string };
  await state.planExecutions.get(started.requestId)?.completion;

  assert.equal(getJobById(db, asJobId(started.jobId))?.status, "completed");
  assert.equal(existsSync(kept), true);
  assert.equal(existsSync(deselected), true);
});

function renamePlan(from: string, to: string, entryId: string, libraryId: string): ChangePlan {
  return {
    id: asPlanId("sidecar-plan"),
    libraryId: asLibraryId(libraryId),
    createdAt: 1,
    status: "draft",
    collision: "suffix",
    dryRun: true,
    ops: [{
      op: "rename",
      from,
      to,
      entryId: asEntryId(entryId),
      ruleId: null,
      reason: "test",
      risk: "none",
      confidence: 1,
      selected: true,
    }],
    summary: { selected: 1, rename: 1, move: 0, mkdir: 0, quarantine: 0, delete: 0, flatten: 0, conflicts: 0 },
  };
}

function emptyPlan(libraryId: string): ChangePlan {
  return {
    id: asPlanId(`${libraryId}-empty`),
    libraryId: asLibraryId(libraryId),
    createdAt: 1,
    status: "draft",
    collision: "suffix",
    dryRun: true,
    ops: [],
    summary: { selected: 0, rename: 0, move: 0, mkdir: 0, quarantine: 0, delete: 0, flatten: 0, conflicts: 0 },
  };
}
