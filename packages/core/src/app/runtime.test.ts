import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { asEntryId, asLibraryId, type Entry } from "@nestify/shared";
import { upsertEntry } from "../db/repos/index.ts";
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

async function createPreviewRuntime(): Promise<{
  runtime: NestifyRuntime;
  root: string;
  scopedDirectory: string;
  cleanup: () => void;
}> {
  const root = mkdtempSync(join(tmpdir(), "nestify-preview-runtime-"));
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

function entryPath(runtime: NestifyRuntime, libraryId: string, suffix: string): string {
  const entry = runtime
    .listLibraryEntries(libraryId)
    .find((item) => normalizeTestPath(item.path).endsWith(normalizeTestPath(suffix)));
  assert.ok(entry, `entry not found: ${suffix}`);
  return entry.id;
}

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
    assert.equal(context.runtime.getActiveScanJob()?.status, "paused");
    assert.throws(() => context.runtime.removeLibrary(library.id), /scan is active/);

    const pausedJob = context.runtime.listJobs().find((job) => job.id === started.job.id);
    const resumed = context.runtime.resumeScan(started.job.id);
    assert.equal(resumed.job.status, "running");
    await waitForScan(context.runtime);

    const completedJob = context.runtime.listJobs().find((job) => job.id === started.job.id);
    assert.equal(completedJob?.status, "completed");
    assert.equal(completedJob?.startedAt, pausedJob?.startedAt);
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

    assert.deepEqual(plan.ops.map((op) => op.entryId).sort(), ["nested-file", "root-file"]);
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
