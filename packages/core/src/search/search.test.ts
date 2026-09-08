import assert from "node:assert/strict";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.ts";
import { gramsForName, parseSearchQuery, searchEntries } from "./index.ts";
import { insertTrigrams } from "./trigram.ts";

function now(): number {
  return Date.now();
}

function insertLibrary(db: DatabaseSync, id = "lib1"): void {
  const ts = now();
  db.prepare(
    `INSERT INTO libraries(
      id, name, roots_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, "Movies", JSON.stringify(["D:/Movies"]), ts, ts);
}

function insertEntry(
  db: DatabaseSync,
  row: {
    id: string;
    libraryId?: string;
    parentId?: string | null;
    name: string;
    stem: string;
    ext: string;
    isDir: number;
    size?: number;
    kind: string;
    path: string;
    parentPath?: string | null;
    relPath: string;
    mtime?: number | null;
    depth?: number;
    hashFull?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO entries(
      id, library_id, parent_id, name, stem, ext, is_dir, size, kind, path, parent_path, rel_path,
      mtime, depth, hash_full
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.libraryId ?? "lib1",
    row.parentId ?? null,
    row.name,
    row.stem,
    row.ext,
    row.isDir,
    row.size ?? 0,
    row.kind,
    row.path,
    row.parentPath ?? null,
    row.relPath,
    row.mtime ?? null,
    row.depth ?? 0,
    row.hashFull ?? null,
  );
  insertTrigrams(db, row.id, row.name);
}

function seedAvatarLibrary(db: DatabaseSync): void {
  insertLibrary(db);
  insertEntry(db, {
    id: "dir1",
    name: "Avatar",
    stem: "Avatar",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Movies/Avatar",
    parentPath: "D:/Movies",
    relPath: "Avatar",
  });
  insertEntry(db, {
    id: "file1",
    parentId: "dir1",
    name: "Avatar.2009.mkv",
    stem: "Avatar.2009",
    ext: "mkv",
    isDir: 0,
    size: 1024,
    kind: "video",
    path: "D:/Movies/Avatar/Avatar.2009.mkv",
    parentPath: "D:/Movies/Avatar",
    relPath: "Avatar/Avatar.2009.mkv",
  });
}

function seedSearchMatrix(db: DatabaseSync): void {
  insertLibrary(db);
  insertLibrary(db, "lib2");
  insertEntry(db, {
    id: "avatar-dir",
    name: "Avatar",
    stem: "Avatar",
    ext: "",
    isDir: 1,
    size: 1,
    kind: "dir",
    path: "D:/Movies/Avatar",
    parentPath: "D:/Movies",
    relPath: "Avatar",
    mtime: Date.UTC(2025, 0, 1),
    depth: 1,
  });
  insertEntry(db, {
    id: "backup-dir",
    name: "Backup",
    stem: "Backup",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Movies/Backup",
    parentPath: "D:/Movies",
    relPath: "Backup",
    mtime: Date.UTC(2024, 11, 31),
    depth: 1,
  });
  insertEntry(db, {
    id: "avatar-video",
    parentId: "avatar-dir",
    name: "Avatar.2009.mkv",
    stem: "Avatar.2009",
    ext: ".mkv",
    isDir: 0,
    size: 2_000_000_000,
    kind: "video",
    path: "D:/Movies/Avatar/Avatar.2009.mkv",
    parentPath: "D:/Movies/Avatar",
    relPath: "Avatar/Avatar.2009.mkv",
    mtime: Date.UTC(2025, 5, 1),
    depth: 2,
    hashFull: "hash-duplicate",
  });
  insertEntry(db, {
    id: "backup-video",
    parentId: "backup-dir",
    name: "Backup.2009.mkv",
    stem: "Backup.2009",
    ext: ".mkv",
    isDir: 0,
    size: 2_000_000_000,
    kind: "video",
    path: "D:/Movies/Backup/Backup.2009.mkv",
    parentPath: "D:/Movies/Backup",
    relPath: "Backup/Backup.2009.mkv",
    mtime: Date.UTC(2024, 11, 30),
    depth: 2,
    hashFull: "hash-duplicate",
  });
  insertEntry(db, {
    id: "avatar-subtitle",
    parentId: "avatar-dir",
    name: "Avatar.2009.srt",
    stem: "Avatar.2009",
    ext: ".srt",
    isDir: 0,
    size: 2_000,
    kind: "subtitle",
    path: "D:/Movies/Avatar/Avatar.2009.srt",
    parentPath: "D:/Movies/Avatar",
    relPath: "Avatar/Avatar.2009.srt",
    mtime: Date.UTC(2025, 5, 2),
    depth: 2,
  });
  insertEntry(db, {
    id: "poster",
    name: "Poster.jpg",
    stem: "Poster",
    ext: ".jpg",
    isDir: 0,
    size: 3_000,
    kind: "image",
    path: "D:/Movies/Poster.jpg",
    parentPath: "D:/Movies",
    relPath: "Poster.jpg",
    mtime: Date.UTC(2023, 11, 31),
    depth: 1,
  });
  insertEntry(db, {
    id: "other-video",
    libraryId: "lib2",
    name: "Avatar.2009.mkv",
    stem: "Avatar.2009",
    ext: ".mkv",
    isDir: 0,
    size: 2_000_000_000,
    kind: "video",
    path: "D:/Movies/Avatar/Avatar.2009.mkv",
    parentPath: "D:/Movies/Avatar",
    relPath: "Avatar/Avatar.2009.mkv",
    mtime: Date.UTC(2025, 5, 1),
    depth: 2,
  });
}

test("gramsForName lowercases, slices 3-grams, and keeps short names whole", () => {
  assert.deepEqual(gramsForName("Av").sort(), ["av"]);
  const grams = new Set(gramsForName("Avatar.mkv"));
  assert.ok(grams.has("ava"));
  assert.ok(grams.has("tar"));
  assert.ok(grams.has("mkv"));
  assert.equal(grams.size, gramsForName("Avatar.mkv").length);
});

test("parseSearchQuery extracts filters, AND terms, and quoted phrases", () => {
  assert.deepEqual(parseSearchQuery("Avatar ext:mkv"), {
    textTerms: ["Avatar"],
    ext: ["mkv"],
  });
  assert.deepEqual(parseSearchQuery(`ext:.mp4 parent:lib type:video path:b/c "Avatar 2009"`), {
    textTerms: [],
    phrase: "Avatar 2009",
    ext: ["mp4"],
    parent: "lib",
    kind: "video",
    path: "b/c",
  });
  assert.deepEqual(parseSearchQuery("kind:dir Avatar"), {
    textTerms: ["Avatar"],
    kind: "dir",
  });
});

test("parseSearchQuery extracts comparison, feature, duplicate, and OR filters", () => {
  assert.deepEqual(
    parseSearchQuery("size:>1gb mtime:2024..2026 depth:<=3 has:subtitle dup:true"),
    {
      textTerms: [],
      size: { operator: "gt", value: 1_000_000_000 },
      mtime: {
        operator: "between",
        min: Date.UTC(2024, 0, 1),
        max: Date.UTC(2027, 0, 1) - 1,
      },
      depth: { operator: "lte", value: 3 },
      has: "subtitle",
      dup: true,
    },
  );

  const parsed = parseSearchQuery("Poster OR Avatar ext:mkv");
  assert.equal(parsed.expression?.type, "or");
  assert.deepEqual(parsed.expression?.children.map((child) => child.type), ["text", "and"]);
});

test(`search "Avatar" finds dir and mkv`, () => {
  const db = openDatabase(":memory:");
  seedAvatarLibrary(db);

  const result = searchEntries(db, { libraryId: "lib1", text: "Avatar" });
  assert.deepEqual(
    result.hits.map((hit) => hit.name),
    ["Avatar", "Avatar.2009.mkv"],
  );
  assert.equal(result.total, 2);
  assert.ok(result.elapsedMs >= 0);
  db.close();
});

test("ext:mkv filters", () => {
  const db = openDatabase(":memory:");
  seedAvatarLibrary(db);

  const result = searchEntries(db, { libraryId: "lib1", text: "Avatar ext:mkv" });
  assert.equal(result.total, 1);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.name, "Avatar.2009.mkv");
  assert.equal(result.hits[0]?.ext, "mkv");
  db.close();
});

test(`short query "Av" uses trigram or LIKE and still finds Avatar`, () => {
  const db = openDatabase(":memory:");
  seedAvatarLibrary(db);

  const result = searchEntries(db, { libraryId: "lib1", text: "Av" });
  assert.ok(result.hits.some((hit) => hit.name === "Avatar"));
  assert.ok(result.hits.some((hit) => hit.name.includes("Avatar")));
  assert.ok(result.total >= 1);
  db.close();
});

test("comparison filters support size, mtime, and depth", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const oversized = searchEntries(db, { libraryId: "lib1", text: "size:>1gb" });
  assert.deepEqual(
    oversized.hits.map((hit) => hit.name),
    ["Avatar.2009.mkv", "Backup.2009.mkv"],
  );

  const medium = searchEntries(db, { libraryId: "lib1", text: "size:1kb..3kb" });
  assert.deepEqual(
    medium.hits.map((hit) => hit.name),
    ["Avatar.2009.srt", "Poster.jpg"],
  );

  const changedIn2025 = searchEntries(db, { libraryId: "lib1", text: "mtime:2025" });
  assert.deepEqual(
    changedIn2025.hits.map((hit) => hit.name),
    ["Avatar", "Avatar.2009.mkv", "Avatar.2009.srt"],
  );

  const shallow = searchEntries(db, { libraryId: "lib1", text: "depth:<=1" });
  assert.deepEqual(
    shallow.hits.map((hit) => hit.name),
    ["Avatar", "Backup", "Poster.jpg"],
  );
  db.close();
});

test("has:subtitle and dup:true stay within the requested library", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const withSubtitle = searchEntries(db, { libraryId: "lib1", text: "has:subtitle" });
  assert.deepEqual(withSubtitle.hits.map((hit) => hit.name), ["Avatar.2009.mkv"]);

  const otherLibrary = searchEntries(db, { libraryId: "lib2", text: "has:subtitle" });
  assert.equal(otherLibrary.total, 0);

  const duplicates = searchEntries(db, { libraryId: "lib1", text: "dup:true" });
  assert.deepEqual(
    duplicates.hits.map((hit) => hit.name),
    ["Avatar.2009.mkv", "Backup.2009.mkv"],
  );
  db.close();
});

test("explicit OR groups adjacent terms as AND before combining groups", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const result = searchEntries(db, {
    libraryId: "lib1",
    text: "Poster OR Avatar ext:mkv",
  });
  assert.deepEqual(
    result.hits.map((hit) => hit.name),
    ["Avatar.2009.mkv", "Poster.jpg"],
  );
  db.close();
});

test("search scope restricts library, directory, and selection", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const directory = searchEntries(db, {
    libraryId: "lib1",
    text: "",
    scope: "directory",
    directory: "D:\\Movies\\Avatar",
  });
  assert.deepEqual(
    directory.hits.map((hit) => hit.name),
    ["Avatar", "Avatar.2009.mkv", "Avatar.2009.srt"],
  );

  const selection = searchEntries(db, {
    libraryId: "lib1",
    text: "",
    scope: "selection",
    entryIds: ["avatar-dir", "poster"],
  });
  assert.deepEqual(
    selection.hits.map((hit) => hit.name),
    ["Avatar", "Avatar.2009.mkv", "Avatar.2009.srt", "Poster.jpg"],
  );

  const root = searchEntries(db, {
    libraryId: "lib1",
    text: "",
    scope: "directory",
    directory: "D:/",
  });
  assert.equal(root.total, 6);
  assert.throws(() => searchEntries(db, { libraryId: "lib1", text: "", scope: "selection" }));
  assert.throws(() =>
    searchEntries(db, { libraryId: "lib1", text: "", scope: "directory", directory: "" }),
  );
  db.close();
});

test("sort and pagination apply before limiting visible hits", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const page = searchEntries(db, {
    libraryId: "lib1",
    text: "",
    sort: { field: "size", direction: "asc" },
    limit: 2,
    offset: 1,
  });
  assert.equal(page.total, 6);
  assert.deepEqual(
    page.hits.map((hit) => hit.name),
    ["Avatar", "Avatar.2009.srt"],
  );

  const recent = searchEntries(db, {
    libraryId: "lib1",
    text: "depth:<=1",
    sort: { field: "mtime", direction: "desc" },
    limit: 2,
    offset: 1,
  });
  assert.deepEqual(
    recent.hits.map((hit) => hit.name),
    ["Backup", "Poster.jpg"],
  );

  assert.throws(() => searchEntries(db, { libraryId: "lib1", text: "", limit: 0 }));
  assert.throws(() => searchEntries(db, { libraryId: "lib1", text: "", offset: -1 }));
  assert.throws(() =>
    searchEntries(db, { libraryId: "lib1", text: "", sort: { field: "invalid" as never } }),
  );
  db.close();
});
