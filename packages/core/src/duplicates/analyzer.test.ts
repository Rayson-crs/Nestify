import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { asEntryId, asLibraryId, type Entry } from "@nestify/shared";
import { analyzeDuplicates } from "./analyzer.ts";

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

function fileEntry(id: string, path: string, bytes: string, mtime: number): Entry {
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
    size: bytes.length,
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
