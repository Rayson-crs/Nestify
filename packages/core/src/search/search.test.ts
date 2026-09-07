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
  },
): void {
  db.prepare(
    `INSERT INTO entries(
      id, library_id, parent_id, name, stem, ext, is_dir, size, kind, path, parent_path, rel_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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