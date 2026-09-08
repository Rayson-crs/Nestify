import assert from "node:assert/strict";
import { test } from "node:test";
import { asEntryId, asLibraryId, type Entry } from "@nestify/shared";
import { openDatabase } from "../open.ts";
import {
  countEntries,
  createLibrary,
  deleteLibrary,
  getEntryById,
  getEntryByPath,
  getLibrary,
  listLibraries,
  markSeen,
  tombstoneMissing,
  updateLibrary,
  upsertEntry,
  createRuleSetRecord,
  deleteRuleSetRecord,
  getRuleSetRecord,
  listRuleSetRecords,
  parseRuleSetYaml,
  serializeRuleSet,
  setRuleSetEnabled,
  setRuleSetPriority,
  updateRuleSetRecord,
  type RuleSetCreateInput,
} from "./index.ts";

function entry(partial: Partial<Entry> & Pick<Entry, "id" | "libraryId" | "name" | "path">): Entry {
  return {
    parentId: null,
    stem: partial.name,
    ext: "",
    isDir: false,
    size: 0,
    mtime: 0,
    ctime: 0,
    atime: 0,
    ino: null,
    dev: null,
    depth: 0,
    kind: "file",
    protocol: "local",
    mime: null,
    parentPath: null,
    relPath: partial.name,
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: 1,
    indexedAt: null,
    ...partial,
  };
}

function rulesetFixture(): RuleSetCreateInput {
  return {
    name: "Custom cleanup",
    description: "Imported profile",
    dryRunDefault: false,
    collision: "suffix",
    rules: [
      {
        id: "rename-temp",
        enabled: true,
        priority: 2,
        action: "rename_file",
        template: "{stem}-clean{ext}",
        match: { field: "name", suffix: ".tmp" },
      },
    ],
  };
}

test("create library + upsert file/dir + getByPath", () => {
  const db = openDatabase(":memory:");
  const library = createLibrary(db, {
    id: "lib1",
    name: "Movies",
    roots: ["D:/Movies"],
  });
  assert.equal(library.id, asLibraryId("lib1"));
  assert.equal(library.hashStrategy, "duplicate-candidate-only");
  assert.equal(library.mediaStrategy, "off");
  assert.equal(library.previewStrategy, "standard");
  assert.equal(library.followSymlinks, false);
  assert.deepEqual(library.roots, ["D:/Movies"]);
  assert.deepEqual(library.excludeGlobs, []);

  const dirId = asEntryId("dir1");
  const fileId = asEntryId("file1");
  upsertEntry(
    db,
    entry({
      id: dirId,
      libraryId: library.id,
      name: "Avatar",
      stem: "Avatar",
      ext: "",
      isDir: true,
      kind: "dir",
      path: "D:/Movies/Avatar",
      parentPath: "D:/Movies",
      relPath: "Avatar",
    }),
  );
  upsertEntry(
    db,
    entry({
      id: fileId,
      libraryId: library.id,
      parentId: dirId,
      name: "Avatar.2009.mkv",
      stem: "Avatar.2009",
      ext: "mkv",
      isDir: false,
      size: 1024,
      kind: "video",
      path: "D:/Movies/Avatar/Avatar.2009.mkv",
      parentPath: "D:/Movies/Avatar",
      relPath: "Avatar/Avatar.2009.mkv",
    }),
  );

  const dir = getEntryByPath(db, library.id, "D:/Movies/Avatar");
  const file = getEntryByPath(db, library.id, "D:/Movies/Avatar/Avatar.2009.mkv");
  assert.ok(dir);
  assert.ok(file);
  assert.equal(dir.isDir, true);
  assert.equal(dir.ext, "");
  assert.equal(file.size, 1024);
  assert.equal(file.ext, ".mkv");
  assert.equal(file.parentId, dirId);
  assert.deepEqual(countEntries(db, library.id), { files: 1, dirs: 1 });
  db.close();
});

test("unique path upsert updates size", () => {
  const db = openDatabase(":memory:");
  const library = createLibrary(db, {
    id: "lib1",
    name: "Movies",
    roots: ["D:/Movies"],
  });
  const path = "D:/Movies/a.txt";
  upsertEntry(
    db,
    entry({
      id: asEntryId("file1"),
      libraryId: library.id,
      name: "a.txt",
      stem: "a",
      ext: ".txt",
      size: 10,
      path,
      parentPath: "D:/Movies",
      relPath: "a.txt",
    }),
  );
  upsertEntry(
    db,
    entry({
      id: asEntryId("file2"),
      libraryId: library.id,
      name: "a.txt",
      stem: "a",
      ext: ".txt",
      size: 20,
      mtime: 30,
      hashQuick: "quick-v2",
      hashFull: "full-v2",
      path,
      parentPath: "D:/Movies",
      relPath: "a.txt",
    }),
  );

  const found = getEntryByPath(db, library.id, path);
  assert.ok(found);
  assert.equal(found.size, 20);
  assert.equal(found.mtime, 30);
  assert.equal(found.hashQuick, "quick-v2");
  assert.equal(found.hashFull, "full-v2");
  assert.equal(found.id, asEntryId("file1"));
  assert.equal(getEntryById(db, "file2"), undefined);
  db.close();
});

test("library CRUD update, get, and delete", () => {
  const db = openDatabase(":memory:");
  const created = createLibrary(db, {
    id: "lib-crud",
    name: "Original library",
    roots: ["D:/Original"],
    excludeGlobs: ["*.tmp"],
    maxDepth: 8,
    followSymlinks: true,
    scanHidden: true,
    hashStrategy: "on-demand",
    mediaStrategy: "standard",
    previewStrategy: "eager",
  });
  assert.equal(getLibrary(db, created.id)?.name, "Original library");

  const updated = updateLibrary(db, created.id, {
    name: "Updated library",
    roots: ["D:/Updated"],
    excludeGlobs: ["*.bak"],
    maxDepth: null,
    followSymlinks: false,
    scanHidden: false,
    hashStrategy: "all",
    mediaStrategy: "deep",
    previewStrategy: "off",
  });
  assert.deepEqual(updated, {
    ...created,
    name: "Updated library",
    roots: ["D:/Updated"],
    excludeGlobs: ["*.bak"],
    maxDepth: null,
    followSymlinks: false,
    scanHidden: false,
    hashStrategy: "all",
    mediaStrategy: "deep",
    previewStrategy: "off",
    updatedAt: updated.updatedAt,
  });
  assert.ok(updated.updatedAt >= created.updatedAt);
  assert.deepEqual(listLibraries(db), [updated]);

  deleteLibrary(db, updated.id);
  assert.equal(getLibrary(db, updated.id), undefined);
  assert.deepEqual(listLibraries(db), []);
  db.close();
});

test("delete library cascades", () => {
  const db = openDatabase(":memory:");
  const library = createLibrary(db, {
    id: "lib1",
    name: "Movies",
    roots: ["D:/Movies"],
  });
  upsertEntry(
    db,
    entry({
      id: asEntryId("file1"),
      libraryId: library.id,
      name: "a.txt",
      stem: "a",
      ext: ".txt",
      path: "D:/Movies/a.txt",
      parentPath: "D:/Movies",
      relPath: "a.txt",
    }),
  );
  const survivor = createLibrary(db, {
    id: "lib2",
    name: "Series",
    roots: ["D:/Series"],
  });
  upsertEntry(
    db,
    entry({
      id: asEntryId("survivor"),
      libraryId: survivor.id,
      name: "survivor.txt",
      stem: "survivor",
      ext: ".txt",
      path: "D:/Series/survivor.txt",
      parentPath: "D:/Series",
      relPath: "survivor.txt",
    }),
  );

  deleteLibrary(db, library.id);
  assert.deepEqual(listLibraries(db).map((item) => item.id), [survivor.id]);
  assert.equal(getEntryById(db, "file1"), undefined);
  assert.equal(getEntryById(db, "survivor")?.libraryId, survivor.id);
  assert.deepEqual(countEntries(db, library.id), { files: 0, dirs: 0 });
  assert.deepEqual(countEntries(db, survivor.id), { files: 1, dirs: 0 });
  db.close();
});

test("tombstoneMissing marks old seen_at", () => {
  const db = openDatabase(":memory:");
  const library = createLibrary(db, {
    id: "lib1",
    name: "Movies",
    roots: ["D:/Movies"],
  });
  upsertEntry(
    db,
    entry({
      id: asEntryId("old"),
      libraryId: library.id,
      name: "old.txt",
      stem: "old",
      ext: ".txt",
      path: "D:/Movies/old.txt",
      parentPath: "D:/Movies",
      relPath: "old.txt",
      seenAt: 10,
    }),
  );
  upsertEntry(
    db,
    entry({
      id: asEntryId("fresh"),
      libraryId: library.id,
      name: "fresh.txt",
      stem: "fresh",
      ext: ".txt",
      path: "D:/Movies/fresh.txt",
      parentPath: "D:/Movies",
      relPath: "fresh.txt",
      seenAt: 200,
    }),
  );

  const marked = tombstoneMissing(db, library.id, 100);
  assert.equal(marked, 1);
  assert.equal(getEntryByPath(db, library.id, "D:/Movies/old.txt")?.tombstone, true);
  assert.equal(getEntryByPath(db, library.id, "D:/Movies/fresh.txt")?.tombstone, false);
  assert.deepEqual(countEntries(db, library.id), { files: 1, dirs: 0 });

  markSeen(db, asEntryId("old"), 300);
  assert.equal(getEntryByPath(db, library.id, "D:/Movies/old.txt")?.tombstone, false);
  assert.deepEqual(countEntries(db, library.id), { files: 2, dirs: 0 });
  db.close();
});

test("ruleset records support lifecycle, priority, YAML round-trip, and destructive safety", () => {
  const db = openDatabase(":memory:");
  const created = createRuleSetRecord(db, { ...rulesetFixture(), priority: 20 });
  assert.equal(created.name, "Custom cleanup");
  assert.equal(created.enabled, true);
  assert.equal(created.priority, 20);
  assert.equal(created.dryRunDefault, false);

  const parsed = parseRuleSetYaml(serializeRuleSet(created));
  assert.deepEqual(parsed, {
    id: created.id,
    name: created.name,
    description: created.description,
    dryRunDefault: created.dryRunDefault,
    collision: created.collision,
    rules: created.rules,
  });

  const disabled = setRuleSetEnabled(db, created.id, false);
  assert.equal(disabled.enabled, false);
  const reprioritized = setRuleSetPriority(db, created.id, 3);
  assert.equal(reprioritized.priority, 3);

  const updated = updateRuleSetRecord(db, created.id, {
    name: "Destructive cleanup",
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
  assert.equal(updated.name, "Destructive cleanup");
  assert.equal(updated.dryRunDefault, true);
  assert.equal(updated.rules[0]?.action, "delete_to_quarantine");

  assert.equal(getRuleSetRecord(db, created.id)?.id, updated.id);
  assert.deepEqual(listRuleSetRecords(db).map((item) => item.id), [updated.id]);

  deleteRuleSetRecord(db, updated.id);
  assert.equal(getRuleSetRecord(db, updated.id), undefined);
  db.close();
});
