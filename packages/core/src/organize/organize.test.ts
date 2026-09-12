import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Entry } from "@nestify/shared";
import { asEntryId, asLibraryId } from "@nestify/shared";
import { createOrganizeSnapshot } from "./snapshot.ts";
import { planRuleset } from "../plan/planner.ts";
import { NestifyRuntime } from "../app/runtime.ts";

type EntryInput = Omit<Partial<Entry>, "id" | "name" | "path" | "isDir"> & {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
};

function entry(input: EntryInput): Entry {
  const { id, name, path, isDir, ...overrides } = input;
  const lastDot = name.lastIndexOf(".");
  const stem = overrides.stem ?? (isDir || lastDot <= 0 ? name : name.slice(0, lastDot));
  const ext = overrides.ext ?? (isDir || lastDot <= 0 ? "" : name.slice(lastDot));
  const base: Entry = {
    id: asEntryId(id),
    libraryId: asLibraryId("lib-organize"),
    parentId: null,
    name,
    stem,
    ext,
    isDir,
    size: 10,
    mtime: 1,
    ctime: 1,
    atime: 1,
    ino: null,
    dev: null,
    depth: overrides.depth ?? 0,
    kind: isDir ? "dir" : "document",
    protocol: "local",
    mime: null,
    path,
    parentPath: overrides.parentPath ?? null,
    relPath: overrides.relPath ?? name,
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: 1,
    indexedAt: 1,
    ...overrides,
  };
  base.id = asEntryId(id);
  base.libraryId = asLibraryId(overrides.libraryId ?? "lib-organize");
  return base;
}

test("organize snapshots preserve scope, descendants, stats, and fingerprint", () => {
  const root = entry({ id: "root", name: "library", path: "D:/library", isDir: true, depth: 0 });
  const folder = entry({
    id: "folder",
    name: "inbox",
    path: "D:/library/inbox",
    parentPath: "D:/library",
    parentId: root.id,
    isDir: true,
    depth: 1,
  });
  const inside = entry({
    id: "inside",
    name: "note.txt",
    path: "D:/library/inbox/note.txt",
    parentPath: "D:/library/inbox",
    parentId: folder.id,
    isDir: false,
    depth: 2,
  });
  const outside = entry({
    id: "outside",
    name: "outside.txt",
    path: "D:/library/outside.txt",
    parentPath: "D:/library",
    parentId: root.id,
    isDir: false,
    depth: 1,
  });
  const entries = [root, folder, inside, outside];

  const directorySnapshot = createOrganizeSnapshot({
    libraryId: "lib-organize",
    entries,
    scope: "directory",
    directory: "D:/library/inbox",
    now: 100,
  });
  assert.deepEqual(directorySnapshot.entryIds, [folder.id, inside.id]);
  assert.equal(directorySnapshot.stats.selected, 2);
  assert.equal(directorySnapshot.stats.selectedFiles, 1);
  assert.equal(directorySnapshot.stats.selectedDirectories, 1);
  assert.equal(directorySnapshot.stats.total, 4);
  assert.equal(directorySnapshot.stats.maxDepth, 2);

  const selectionSnapshot = createOrganizeSnapshot({
    libraryId: "lib-organize",
    entries,
    scope: "selection",
    entryIds: [folder.id],
    now: 100,
  });
  assert.deepEqual(selectionSnapshot.entryIds, [folder.id, inside.id]);
  assert.equal(selectionSnapshot.fingerprint, directorySnapshot.fingerprint);
  assert.notEqual(selectionSnapshot.id, directorySnapshot.id);

  const changed = createOrganizeSnapshot({
    libraryId: "lib-organize",
    entries: [{ ...inside, size: 11 }, root, folder, outside],
    now: 100,
  });
  assert.notEqual(changed.fingerprint, directorySnapshot.fingerprint);
});

test("organize preview returns the frozen snapshot, plan, stage, and explanation", async () => {
  const base = mkdtempSync(join(tmpdir(), "nestify-organize-preview-"));
  const root = join(base, "library");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "[4K]sample.webp"), Buffer.from("RIFF0000WEBP"));
  const runtime = new NestifyRuntime({ appDataRoot: join(base, "appdata") });
  try {
    const library = runtime.addLibrary({ name: "Organize", roots: [root] });
    await runtime.scanLibrary(library.id);
    const snapshot = runtime.createOrganizeSnapshot({ libraryId: library.id, now: 100 });
    const preview = runtime.previewOrganize({
      libraryId: library.id,
      ruleSetId: "download-inbox",
      snapshotId: snapshot.id,
      now: 100,
    });

    assert.equal(preview.snapshot.id, snapshot.id);
    assert.equal(preview.plan.libraryId, library.id);
    assert.equal(preview.summary.rename, 1);
    assert.equal(preview.rows.length, 1);
    assert.equal(preview.rows[0]?.stage, "name");
    assert.equal(preview.rows[0]?.objectType, "file");
    assert.equal(preview.rows[0]?.ruleId, "strip-release-tags");
    assert.match(preview.rows[0]?.explanation ?? "", /规则/);
    assert.equal(preview.rows[0]?.selected, true);
  } finally {
    runtime.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("organize snapshot validates required scope inputs and keeps delete out of ordinary planning", () => {
  const file = entry({ id: "file", name: "a.txt", path: "D:/library/a.txt", isDir: false });
  assert.throws(
    () => createOrganizeSnapshot({ libraryId: "lib-organize", entries: [file], scope: "selection", entryIds: [] }),
    /selection scope requires at least one entryId/,
  );
  assert.throws(
    () => createOrganizeSnapshot({ libraryId: "lib-organize", entries: [file], scope: "directory", directory: " " }),
    /directory scope requires a directory/,
  );
});

test("organize rules keep object, directory scope, rule order, and parent paths independent", () => {
  const root = entry({ id: "root", name: "library", path: "D:/library", isDir: true, depth: 0 });
  const parent = entry({
    id: "parent",
    name: "project",
    path: "D:/library/project",
    parentPath: "D:/library",
    parentId: root.id,
    isDir: true,
    depth: 1,
  });
  const childDir = entry({
    id: "child-dir",
    name: "raw",
    path: "D:/library/project/raw",
    parentPath: "D:/library/project",
    parentId: parent.id,
    isDir: true,
    depth: 2,
  });
  const topFile = entry({
    id: "top-file",
    name: "top.txt",
    path: "D:/library/top.txt",
    parentPath: "D:/library",
    parentId: root.id,
    isDir: false,
    depth: 1,
  });
  const nestedFile = entry({
    id: "nested-file",
    name: "nested.txt",
    path: "D:/library/project/raw/nested.txt",
    parentPath: "D:/library/project/raw",
    parentId: childDir.id,
    isDir: false,
    depth: 3,
  });
  const entries = [root, parent, childDir, topFile, nestedFile];
  const ruleSet = {
    id: "organize-test",
    name: "organize-test",
    dryRunDefault: true,
    collision: "suffix" as const,
    rules: [
      {
        id: "rename-parent",
        enabled: true,
        priority: 1,
        action: "rename_dir" as const,
        template: "project-renamed",
        continueMatching: false,
      },
      {
        id: "move-top-file",
        enabled: true,
        priority: 2,
        action: "move" as const,
        template: "top-files/{name}{ext}",
        continueMatching: false,
      },
      {
        id: "move-nested-file",
        enabled: true,
        priority: 3,
        action: "move" as const,
        template: "nested-files/{name}{ext}",
        continueMatching: false,
      },
    ],
  };
  const plan = planRuleset({
    libraryId: "lib-organize",
    entries,
    candidateEntryIds: entries.map((item) => item.id),
    candidateEntryIdsByRule: new Map([
      ["rename-parent", new Set([parent.id])],
      ["move-top-file", new Set([topFile.id])],
      ["move-nested-file", new Set([nestedFile.id])],
    ]),
    ruleSet,
    libraryRoot: root.path,
    now: 100,
  });

  const parentOp = plan.ops.find((op) => op.entryId === parent.id);
  const topFileOp = plan.ops.find((op) => op.entryId === topFile.id);
  const nestedFileOp = plan.ops.find((op) => op.entryId === nestedFile.id);
  assert.equal(parentOp?.to, "D:/library/project-renamed");
  assert.equal(topFileOp?.to, "D:/library/top-files/top.txt");
  assert.equal(nestedFileOp?.from, "D:/library/project-renamed/raw/nested.txt");
  assert.equal(nestedFileOp?.to, "D:/library/nested-files/nested.txt");
  assert.equal(plan.ops.some((op) => op.entryId === childDir.id), false);
});

test("organize step rules stop later rules after a matched action", () => {
  const file = entry({ id: "file", name: "a.txt", path: "D:/library/a.txt", isDir: false, depth: 1 });
  const first = {
    id: "first",
    enabled: true,
    priority: 1,
    action: "rename_file" as const,
    template: "first{ext}",
    continueMatching: false,
    steps: [{ id: "first-action", kind: "action" as const, action: "rename_file" as const, template: "first{ext}" }],
  };
  const second = {
    id: "second",
    enabled: true,
    priority: 2,
    action: "rename_file" as const,
    template: "second{ext}",
    continueMatching: false,
  };
  const plan = planRuleset({
    libraryId: "lib-organize",
    entries: [file],
    ruleSet: { id: "steps", name: "steps", dryRunDefault: true, collision: "suffix", rules: [first, second] },
    libraryRoot: "D:/library",
    now: 100,
  });
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0]?.ruleId, "first");
  assert.equal(plan.ops[0]?.to, "D:/library/first.txt");
});

test("organize action chains read the virtual path produced by the previous action", () => {
  const file = entry({ id: "file", name: "lesson.txt", path: "D:/library/lesson.txt", isDir: false, depth: 1 });
  const rule = {
    id: "rename-then-move",
    enabled: true,
    priority: 1,
    action: "rename_file" as const,
    template: "课程{ext}",
    continueMatching: false,
    steps: [
      { id: "rename", kind: "action" as const, action: "rename_file" as const, template: "课程{ext}" },
      { id: "move", kind: "action" as const, action: "move" as const, template: "归档/{name}{ext}" },
    ],
  };
  const plan = planRuleset({
    libraryId: "lib-organize",
    entries: [file],
    ruleSet: { id: "chain", name: "chain", dryRunDefault: true, collision: "suffix", rules: [rule] },
    libraryRoot: "D:/library",
    now: 100,
  });

  assert.deepEqual(
    plan.ops.filter((op) => op.entryId === file.id).map((op) => ({ op: op.op, from: op.from, to: op.to })),
    [
      { op: "rename", from: "D:/library/lesson.txt", to: "D:/library/课程.txt" },
      { op: "move", from: "D:/library/课程.txt", to: "D:/library/归档/课程.txt" },
    ],
  );
});
