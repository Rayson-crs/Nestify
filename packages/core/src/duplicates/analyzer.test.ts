import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { asEntryId, asLibraryId, type Entry } from "@nestify/shared";
import { createLibrary, upsertEntry } from "../db/repos/index.ts";
import { openDatabase } from "../db/open.ts";
import { analyzeDuplicates } from "./analyzer.ts";
import { persistDuplicateAnalysis } from "./persistence.ts";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nestify-duplicates-"));
  tempDirs.push(dir);
  return dir;
}

function fileEntry(id: string, path: string, bytes: string | Buffer, mtime: number): Entry {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, bytes);
  return {
    id: asEntryId(id),
    libraryId: asLibraryId("lib1"),
    parentId: null,
    name: basename(path),
    stem: basename(path),
    ext: ".txt",
    isDir: false,
    size: typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.length,
    mtime,
    ctime: mtime,
    atime: mtime,
    ino: id,
    dev: "dev1",
    depth: 1,
    kind: "file",
    protocol: "local",
    mime: null,
    path,
    parentPath: null,
    relPath: `${id}.txt`,
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

function directoryEntry(id: string, path: string, mtime: number): Entry {
  mkdirSync(path, { recursive: true });
  return {
    id: asEntryId(id),
    libraryId: asLibraryId("lib1"),
    parentId: null,
    name: basename(path),
    stem: basename(path),
    ext: "",
    isDir: true,
    size: 0,
    mtime,
    ctime: mtime,
    atime: mtime,
    ino: id,
    dev: "dev1",
    depth: 0,
    kind: "dir",
    protocol: "local",
    mime: null,
    path,
    parentPath: null,
    relPath: basename(path),
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

test("duplicates use hashes, apply keep strategy, and plan quarantine only", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const old = fileEntry("old", join(root, "old.txt"), "same-bytes", 10);
  const latest = fileEntry("latest", join(root, "latest.txt"), "same-bytes", 20);
  const unique = fileEntry("unique", join(root, "unique.txt"), "other-bytes", 30);

  const { groups, plan } = await analyzeDuplicates({
    entries: [old, latest, unique],
    quarantineDir: quarantine,
    keepStrategy: "newest",
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.wastedBytes, old.size);
  assert.deepEqual(
    groups[0]?.files.map((file) => [file.path, file.keep]),
    [
      [latest.path, true],
      [old.path, false],
    ],
  );
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0]?.op, "quarantine");
  assert.equal(plan.ops[0]?.from, old.path);
  assert.equal(plan.ops[0]?.selected, true);
  assert.equal(plan.summary.quarantine, 1);
});

test("quarantine plan resolves duplicate destination names without overwrite", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const first = fileEntry("first", join(root, "a", "same.txt"), "same", 10);
  const second = fileEntry("second", join(root, "b", "same.txt"), "same", 20);
  const third = fileEntry("third", join(root, "c", "same.txt"), "same", 30);

  const { plan } = await analyzeDuplicates({
    entries: [first, second, third],
    quarantineDir: quarantine,
    keepStrategy: "oldest",
  });

  assert.equal(plan.ops.length, 2);
  const targets = plan.ops.map((item) => item.to?.toLowerCase());
  assert.equal(targets[0], join(quarantine, "same.txt").toLowerCase());
  assert.notEqual(targets[1], targets[0]);
});

test("duplicate analysis applies selection and directory scopes", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const first = fileEntry("scope-1", join(root, "a", "same.txt"), "same", 10);
  const second = fileEntry("scope-2", join(root, "b", "same.txt"), "same", 20);
  const excluded = fileEntry("scope-3", join(root, "c", "same.txt"), "same", 30);

  const selected = await analyzeDuplicates({
    entries: [first, second, excluded],
    quarantineDir: quarantine,
    scope: "selection",
    entryIds: [first.id, second.id],
    keepStrategy: "newest",
  });
  assert.deepEqual(
    selected.groups[0]?.files.map((file) => file.path),
    [second.path, first.path],
  );

  const directory = await analyzeDuplicates({
    entries: [first, second, excluded],
    quarantineDir: quarantine,
    scope: "directory",
    directory: join(root, "a"),
    keepStrategy: "oldest",
  });
  assert.equal(directory.groups.length, 0);
});

test("name quality and preferred directory determine the keeper", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const messy = fileEntry("messy", join(root, "messy", "movie [1080p] - copy (2).mkv"), "same", 10);
  const clean = fileEntry("clean", join(root, "preferred", "Movie (2024).mkv"), "same", 20);

  const byQuality = await analyzeDuplicates({
    entries: [messy, clean],
    quarantineDir: quarantine,
    keepStrategy: "name_quality",
  });
  assert.equal(byQuality.groups[0]?.files[0]?.path, clean.path);

  const byDirectory = await analyzeDuplicates({
    entries: [messy, clean],
    quarantineDir: quarantine,
    keepStrategy: "preferred_dir",
    directory: join(root, "messy"),
  });
  assert.equal(byDirectory.groups[0]?.files[0]?.path, messy.path);
});

test("hash strategies control candidate and confirmation depth", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const first = fileEntry("hash-1", join(root, "same-size-a.txt"), "aaaa", 10);
  const second = fileEntry("hash-2", join(root, "same-size-b.txt"), "bbbb", 20);
  const entries = [first, second];

  const off = await analyzeDuplicates({
    entries,
    quarantineDir: quarantine,
    keepStrategy: "newest",
    hashStrategy: "off",
  });
  assert.equal(off.hashStrategy, "off");
  assert.equal(off.groups.length, 1);
  assert.equal(off.groups[0]?.status, "candidate");
  assert.equal(off.groups[0]?.hash, "");
  assert.equal(off.groups[0]?.wastedBytes, 0);
  assert.ok(off.groups[0]?.files.every((file) => !file.keep));
  assert.equal(off.plan.ops.length, 0);

  for (const hashStrategy of ["on-demand", "duplicate-candidate-only"] as const) {
    const result = await analyzeDuplicates({
      entries,
      quarantineDir: quarantine,
      keepStrategy: "newest",
      hashStrategy,
    });
    assert.equal(result.hashStrategy, hashStrategy);
    assert.deepEqual(result.groups, []);
  }

  const duplicate = fileEntry("hash-3", join(root, "same-bytes.txt"), "aaaa", 30);
  const all = await analyzeDuplicates({
    entries: [first, duplicate],
    quarantineDir: quarantine,
    keepStrategy: "newest",
    hashStrategy: "all",
  });
  assert.equal(all.hashStrategy, "all");
  assert.equal(all.groups.length, 1);
  assert.equal(all.groups[0]?.status, "confirmed");
});

test("duplicate analysis reports collecting hash and finalize progress", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const first = fileEntry("progress-1", join(root, "dup-a.txt"), "same-bytes", 10);
  const second = fileEntry("progress-2", join(root, "dup-b.txt"), "same-bytes", 20);
  const events: Array<{ phase: string; status: string; percent: number }> = [];

  const result = await analyzeDuplicates({
    entries: [first, second],
    quarantineDir: quarantine,
    keepStrategy: "newest",
    hashStrategy: "duplicate-candidate-only",
    onProgress: (progress) => {
      events.push({ phase: progress.phase, status: progress.status, percent: progress.percent });
    },
  });

  assert.equal(result.groups.length, 1);
  assert.ok(events.some((event) => event.phase === "collecting"));
  assert.ok(events.some((event) => event.phase === "quick-hash"));
  assert.ok(events.some((event) => event.phase === "full-hash"));
  assert.equal(events.at(-1)?.phase, "finalizing");
  assert.equal(events.at(-1)?.status, "completed");
  assert.equal(events.at(-1)?.percent, 100);
  assert.ok(events.every((event, index) => index === 0 || event.percent + 0.0001 >= events[index - 1]!.percent));
});

test("selection expands selected directories to descendant files", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const selectedRoot = directoryEntry("selected-root", join(root, "selected"), 10);
  const first = fileEntry("dir-scope-1", join(root, "selected", "a", "same.txt"), "same", 10);
  const second = fileEntry("dir-scope-2", join(root, "selected", "b", "same.txt"), "same", 20);
  const excluded = fileEntry("dir-scope-3", join(root, "outside", "same.txt"), "same", 30);

  const result = await analyzeDuplicates({
    entries: [selectedRoot, first, second, excluded],
    quarantineDir: quarantine,
    scope: "selection",
    entryIds: [selectedRoot.id],
    keepStrategy: "newest",
  });

  assert.deepEqual(
    result.groups[0]?.files.map((file) => file.path),
    [second.path, first.path],
  );
});

test("stale index size does not treat different files as duplicates", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const head = Buffer.alloc(1024 * 1024, 7);
  const tail = Buffer.alloc(64 * 1024, 9);
  const firstBytes = Buffer.concat([head, Buffer.from("ALPHA-UNIQUE"), tail]);
  const secondBytes = Buffer.concat([head, Buffer.from("BRAVO-UNIQUE"), tail]);
  const first = fileEntry("stale-a", join(root, "movie-a.mkv"), firstBytes, 10);
  const second = fileEntry("stale-b", join(root, "movie-b.mkv"), secondBytes, 20);
  first.size = 1024 * 1024;
  second.size = 1024 * 1024;

  const result = await analyzeDuplicates({
    entries: [first, second],
    quarantineDir: quarantine,
    keepStrategy: "newest",
  });

  assert.deepEqual(result.groups, []);
});

test("duplicate analysis result can be persisted and superseded", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const first = fileEntry("persist-1", join(root, "a.txt"), "same", 10);
  const second = fileEntry("persist-2", join(root, "b.txt"), "same", 20);
  const db = openDatabase(":memory:");
  createLibrary(db, { id: "lib1", name: "Test", roots: [root] });
  upsertEntry(db, first);
  upsertEntry(db, second);
  const result = await analyzeDuplicates({
    entries: [first, second],
    quarantineDir: quarantine,
    keepStrategy: "newest",
  });

  const summary = persistDuplicateAnalysis(db, {
    libraryId: "lib1",
    result,
    analyzedAt: 100,
  });

  assert.equal(summary.groupsInserted, 1);
  assert.equal(summary.membersInserted, 2);
  const group = db
    .prepare(`SELECT * FROM dup_groups WHERE library_id = ? AND status = 'open'`)
    .get("lib1") as {
      id: string;
      hash_full: string;
      file_count: number;
      wasted_bytes: number;
    };
  assert.equal(group.file_count, 2);
  assert.equal(group.wasted_bytes, first.size);
  assert.match(group.hash_full, /^[0-9a-f]{64}$/);
  const members = db
    .prepare(`SELECT entry_id, keep, reason FROM dup_members WHERE group_id = ? ORDER BY entry_id`)
    .all(group.id) as Array<{ entry_id: string; keep: number; reason: string }>;
  assert.deepEqual(
    members.map((member) => [member.entry_id, member.keep, member.reason]),
    [
      ["persist-1", 0, "confirmed duplicate redundant copy"],
      ["persist-2", 1, "confirmed duplicate keeper"],
    ],
  );

  const next = await analyzeDuplicates({
    entries: [first],
    quarantineDir: quarantine,
    keepStrategy: "newest",
    hashStrategy: "off",
  });
  const nextSummary = persistDuplicateAnalysis(db, {
    libraryId: "lib1",
    result: next,
    analyzedAt: 200,
  });
  assert.equal(nextSummary.groupsSuperseded, 1);
  assert.equal(nextSummary.groupsInserted, 0);
  const superseded = db
    .prepare(`SELECT COUNT(*) AS count FROM dup_groups WHERE status = 'superseded'`)
    .get() as { count: number };
  assert.equal(superseded.count, 1);
  db.close();
});
