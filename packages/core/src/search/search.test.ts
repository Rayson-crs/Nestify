import assert from "node:assert/strict";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.ts";
import { ALL_LIBRARIES_ID } from "./query-filters.ts";
import {
  explainDirectoryChildrenPlan,
  explainSearchPlan,
  explainSearchTrigramProbes,
  gramsForName,
  listDirectoryChildren,
  parseSearchQuery,
  searchEntries,
} from "./index.ts";
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
  const libraryId = row.libraryId ?? "lib1";
  db.prepare(
    `INSERT INTO library_entries(entry_id, library_id, rel_path, seen_at, tombstone)
     VALUES (?, ?, ?, ?, 0)`,
  ).run(row.id, libraryId, row.relPath, row.mtime ?? 0);
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
  db.prepare(
    `INSERT INTO library_entries(entry_id, library_id, rel_path, seen_at, tombstone)
     VALUES ('avatar-video', 'lib2', 'Avatar/Avatar.2009.mkv', ?, 0)`,
  ).run(Date.UTC(2025, 5, 1));
}

test("gramsForName lowercases, slices 3-grams, and keeps short names whole", () => {
  assert.deepEqual(gramsForName("Av").sort(), ["av"]);
  const grams = new Set(gramsForName("Avatar.mkv"));
  assert.ok(grams.has("ava"));
  assert.ok(grams.has("tar"));
  assert.ok(grams.has("mkv"));
  assert.equal(grams.size, gramsForName("Avatar.mkv").length);
  assert.ok(gramsForName("资料报告.pdf").includes("资料"));
  assert.ok(gramsForName("资料报告.pdf").includes("资"));
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

test("parseSearchQuery treats explicit AND as a connector instead of a text term", () => {
  assert.deepEqual(parseSearchQuery("Avatar AND ext:mkv"), {
    textTerms: ["Avatar"],
    ext: ["mkv"],
  });

  assert.deepEqual(parseSearchQuery("Avatar and ext:mkv"), {
    textTerms: ["Avatar"],
    ext: ["mkv"],
  });
});

test("parseSearchQuery extracts unknown-date name and path patterns", () => {
  assert.deepEqual(parseSearchQuery("name_date:yyyy-MM-dd path_date:yyyyMMdd"), {
    textTerms: [],
    nameDate: "yyyy-MM-dd",
    pathDate: "yyyyMMdd",
  });
});

test("parseSearchQuery extracts a date pattern for either name or path", () => {
  assert.deepEqual(parseSearchQuery("date_pattern:yyyy-MM-dd"), {
    textTerms: [],
    datePattern: "yyyy-MM-dd",
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

test("pipe-separated extension assistant values match any extension", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const result = searchEntries(db, {
    libraryId: "lib1",
    text: "ext:mp4|mkv|avi|mov",
  });
  assert.deepEqual(result.hits.map((hit) => hit.name), ["Avatar.2009.mkv", "Backup.2009.mkv"]);
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

test("two-character Chinese queries use the persisted n-gram index", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "chinese-report",
    name: "资料报告.pdf",
    stem: "资料报告",
    ext: ".pdf",
    isDir: 0,
    kind: "document",
    path: "D:/Movies/资料报告.pdf",
    parentPath: "D:/Movies",
    relPath: "资料报告.pdf",
  });
  insertEntry(db, {
    id: "weather-report",
    name: "气象雷达.pdf",
    stem: "气象雷达",
    ext: ".pdf",
    isDir: 0,
    kind: "document",
    path: "D:/Movies/气象雷达.pdf",
    parentPath: "D:/Movies",
    relPath: "气象雷达.pdf",
  });
  const result = searchEntries(db, {
    libraryId: "lib1",
    text: "资料",
    resultMode: "hits-only",
  });
  assert.deepEqual(result.hits.map((hit) => hit.name), ["资料报告.pdf"]);
  const allLibraries = searchEntries(db, {
    libraryId: ALL_LIBRARIES_ID,
    text: "气象",
    resultMode: "hits-only",
    sort: { field: "relevance", direction: "desc" },
  });
  assert.deepEqual(allLibraries.hits.map((hit) => hit.name), ["气象雷达.pdf"]);
  db.close();
});

test("single-character Chinese queries use the persisted unigram index", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "weather-report",
    name: "气象雷达.pdf",
    stem: "气象雷达",
    ext: ".pdf",
    isDir: 0,
    kind: "document",
    path: "D:/Movies/气象雷达.pdf",
    parentPath: "D:/Movies",
    relPath: "气象雷达.pdf",
  });

  const result = searchEntries(db, {
    libraryId: ALL_LIBRARIES_ID,
    text: "气",
    resultMode: "hits-only",
    sort: { field: "relevance", direction: "desc" },
  });
  assert.deepEqual(result.hits.map((hit) => hit.name), ["气象雷达.pdf"]);

  const plan = explainSearchPlan(db, {
    libraryId: ALL_LIBRARIES_ID,
    text: "气",
    resultMode: "hits-only",
  }).map((row) => row.detail).join("\n");
  assert.match(plan, /name_trigrams/);
  assert.doesNotMatch(plan, /bm25\(entry_fts\)/);
  assert.ok(Array.isArray(explainSearchPlan(db, {
    libraryId: ALL_LIBRARIES_ID,
    text: "气",
    resultMode: "hits-only",
    sort: { field: "relevance", direction: "desc" },
  })));

  db.prepare(`DELETE FROM name_trigrams WHERE entry_id = ?`).run("weather-report");
  db.prepare(`UPDATE search_index_state SET version = 1`).run();
  const legacyResult = searchEntries(db, {
    libraryId: ALL_LIBRARIES_ID,
    text: "气",
    resultMode: "hits-only",
  });
  assert.deepEqual(legacyResult.hits.map((hit) => hit.name), ["气象雷达.pdf"]);
  const legacyPlan = explainSearchPlan(db, {
    libraryId: ALL_LIBRARIES_ID,
    text: "气",
    resultMode: "hits-only",
  }).map((row) => row.detail).join("\n");
  assert.doesNotMatch(legacyPlan, /name_trigrams/);
  db.close();
});

test("explicit substring mode bypasses FTS and uses the n-gram plan", () => {
  const db = openDatabase(":memory:");
  seedAvatarLibrary(db);

  const result = searchEntries(db, {
    libraryId: "lib1",
    text: "vata",
    textMode: "substring",
    resultMode: "hits-only",
  });
  assert.deepEqual(result.hits.map((hit) => hit.name), ["Avatar", "Avatar.2009.mkv"]);

  const plan = explainSearchPlan(db, {
    libraryId: "lib1",
    text: "vata",
    textMode: "substring",
    resultMode: "hits-only",
  }).map((row) => row.detail).join("\n");
  assert.match(plan, /name_trigrams/);
  assert.doesNotMatch(plan, /entry_fts/);
  assert.equal(plan.split("\n").filter((line) => line.includes("name_trigrams")).length, 2);
  db.close();
});

test("substring probe ranking distinguishes frequencies beyond the initial cap", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  const groups = [
    { gram: "abc", prefix: "abc", count: 1_100 },
    { gram: "def", prefix: "def", count: 1_200 },
    { gram: "bcd", prefix: "bcde", count: 3_000 },
  ];
  const target = {
    id: "probe-target",
    name: "abcdef.txt",
    stem: "abcdef",
    ext: ".txt",
    isDir: 0,
    kind: "text",
    path: "D:/Movies/abcdef.txt",
    parentPath: "D:/Movies",
    relPath: "abcdef.txt",
  };
  insertEntry(db, target);
  insertTrigrams(db, target.id, target.name);
  for (const group of groups) {
    for (let index = 0; index < group.count; index += 1) {
      const id = `probe-${group.gram}-${index}`;
      const name = `${group.prefix}-${index}.txt`;
      insertEntry(db, {
        id,
        name,
        stem: `${group.prefix}-${index}`,
        ext: ".txt",
        isDir: 0,
        kind: "text",
        path: `D:/Movies/${name}`,
        parentPath: "D:/Movies",
        relPath: name,
      });
      insertTrigrams(db, id, name);
    }
  }

  assert.deepEqual(
    explainSearchTrigramProbes(db, { text: "abcdef", textMode: "substring" }),
    ["abc", "def"],
  );
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

  const depthRange = searchEntries(db, { libraryId: "lib1", text: "depth:1..1" });
  assert.deepEqual(
    depthRange.hits.map((hit) => hit.name),
    ["Avatar", "Backup", "Poster.jpg"],
  );

  const allFiles = searchEntries(db, { libraryId: "lib1", text: "kind:file" });
  assert.deepEqual(
    allFiles.hits.map((hit) => hit.name),
    ["Avatar.2009.mkv", "Avatar.2009.srt", "Backup.2009.mkv", "Poster.jpg"],
  );

  const directories = searchEntries(db, { libraryId: "lib1", text: "kind:dir" });
  assert.deepEqual(directories.hits.map((hit) => hit.name), ["Avatar", "Backup"]);
  db.close();
});

test("date pattern filters find names and paths without knowing the date", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "dated-name",
    name: "report_2026-09-09.txt",
    stem: "report_2026-09-09",
    ext: ".txt",
    isDir: 0,
    kind: "code",
    path: "D:/Movies/report_2026-09-09.txt",
    parentPath: "D:/Movies",
    relPath: "report_2026-09-09.txt",
  });
  insertEntry(db, {
    id: "dated-path",
    name: "backup.zip",
    stem: "backup",
    ext: ".zip",
    isDir: 0,
    kind: "archive",
    path: "D:/Movies/20260909/backup.zip",
    parentPath: "D:/Movies/20260909",
    relPath: "20260909/backup.zip",
  });

  const nameMatches = searchEntries(db, { libraryId: "lib1", text: "name_date:yyyy-MM-dd" });
  assert.deepEqual(nameMatches.hits.map((hit) => hit.name), ["report_2026-09-09.txt"]);
  const pathMatches = searchEntries(db, { libraryId: "lib1", text: "path_date:yyyyMMdd" });
  assert.deepEqual(pathMatches.hits.map((hit) => hit.name), ["backup.zip"]);
  const eitherMatches = searchEntries(db, { libraryId: "lib1", text: "date_pattern:yyyy-MM-dd" });
  assert.deepEqual(eitherMatches.hits.map((hit) => hit.name), ["report_2026-09-09.txt"]);
  db.close();
});

test("dynamic mtime values resolve to valid local date ranges", () => {
  const today = parseSearchQuery("mtime:today").mtime;
  const yesterday = parseSearchQuery("mtime:yesterday").mtime;
  const week = parseSearchQuery("mtime:this_week").mtime;
  const recent = parseSearchQuery("mtime:last_7_days").mtime;
  assert.equal(today?.operator, "between");
  assert.equal(yesterday?.operator, "between");
  assert.equal(week?.operator, "between");
  assert.equal(recent?.operator, "between");
  assert.ok((today?.min ?? 0) < (today?.max ?? 0));
  assert.ok((yesterday?.max ?? 0) < (today?.min ?? 0));
  assert.ok((recent?.min ?? 0) <= Date.now());
});

test("has:subtitle and dup:true follow shared canonical paths", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const withSubtitle = searchEntries(db, { libraryId: "lib1", text: "has:subtitle" });
  assert.deepEqual(withSubtitle.hits.map((hit) => hit.name), ["Avatar.2009.mkv"]);

  const otherLibrary = searchEntries(db, { libraryId: "lib2", text: "has:subtitle" });
  assert.equal(otherLibrary.total, 1);

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
  const directChildren = searchEntries(db, {
    libraryId: "lib1",
    text: "",
    scope: "directory",
    directory: "D:\\Movies",
    directChildren: true,
    sort: { field: "path_mtime" },
  });
  assert.deepEqual(
    directChildren.hits.map((hit) => hit.name),
    ["Avatar", "Backup", "Poster.jpg"],
  );
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

  const byDirectoryAndTime = searchEntries(db, {
    libraryId: "lib1",
    text: "",
    sort: { field: "path_mtime" },
  });
  assert.deepEqual(
    byDirectoryAndTime.hits.map((hit) => hit.path),
    [
      "D:/Movies/Avatar",
      "D:/Movies/Backup",
      "D:/Movies/Poster.jpg",
      "D:/Movies/Avatar/Avatar.2009.srt",
      "D:/Movies/Avatar/Avatar.2009.mkv",
      "D:/Movies/Backup/Backup.2009.mkv",
    ],
  );

  assert.throws(() => searchEntries(db, { libraryId: "lib1", text: "", limit: 0 }));
  assert.throws(() => searchEntries(db, { libraryId: "lib1", text: "", offset: -1 }));
  assert.throws(() =>
    searchEntries(db, { libraryId: "lib1", text: "", sort: { field: "invalid" as never } }),
  );
  db.close();
});

test("keyset cursors preserve ordering for name and path_mtime", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const first = searchEntries(db, { libraryId: "lib1", text: "", limit: 2, sort: { field: "name", direction: "asc" } });
  assert.equal(first.hasMore, true);
  const second = searchEntries(db, {
    libraryId: "lib1",
    text: "",
    limit: 2,
    cursor: first.nextCursor,
    sort: { field: "name", direction: "asc" },
  });
  assert.deepEqual(second.hits.map((hit) => hit.name), ["Avatar.2009.srt", "Backup"]);

  const pathFirst = searchEntries(db, { libraryId: "lib1", text: "", limit: 3, sort: { field: "path_mtime" } });
  const pathSecond = searchEntries(db, {
    libraryId: "lib1",
    text: "",
    limit: 3,
    cursor: pathFirst.nextCursor,
    sort: { field: "path_mtime" },
  });
  assert.deepEqual(pathSecond.hits.map((hit) => hit.path), [
    "D:/Movies/Avatar/Avatar.2009.srt",
    "D:/Movies/Avatar/Avatar.2009.mkv",
    "D:/Movies/Backup/Backup.2009.mkv",
  ]);
  db.close();
});

test("broad name keyset pages avoid repeated gram probes", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);
  for (let index = 0; index < 1_100; index += 1) {
    insertEntry(db, {
      id: `avatar-keyset-${index}`,
      name: `Avatar-${String(index).padStart(4, "0")}.txt`,
      stem: `Avatar-${String(index).padStart(4, "0")}`,
      ext: ".txt",
      isDir: 0,
      kind: "text",
      path: `D:/Movies/Avatar-${String(index).padStart(4, "0")}.txt`,
      parentPath: "D:/Movies",
      relPath: `Avatar-${String(index).padStart(4, "0")}.txt`,
    });
  }
  const first = searchEntries(db, {
    libraryId: "lib1",
    text: "Avatar",
    resultMode: "hits-only",
    limit: 2,
    sort: { field: "name", direction: "asc" },
  });
  assert.equal(first.hasMore, true);

  const second = searchEntries(db, {
    libraryId: "lib1",
    text: "Avatar",
    resultMode: "hits-only",
    limit: 2,
    cursor: first.nextCursor,
    sort: { field: "name", direction: "asc" },
  });
  assert.equal(second.hits.length, 2);
  assert.ok(second.hits.every((hit) => !first.hits.some((firstHit) => firstHit.entryId === hit.entryId)));

  const details = explainSearchPlan(db, {
    libraryId: "lib1",
    text: "Avatar",
    resultMode: "hits-only",
    limit: 2,
    cursor: first.nextCursor,
    sort: { field: "name", direction: "asc" },
  }).map((row) => row.detail);
  assert.ok(
    details.some((detail) => detail.includes("idx_entries_active_name")),
    details.join("\n"),
  );
  assert.equal(details.filter((detail) => detail.includes("name_trigrams")).length, 1, details.join("\n"));
  db.close();
});

test("search direction adapts to library membership density and directory scans stay scoped", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);
  const searchDetails = explainSearchPlan(db, { libraryId: "lib1", text: "", resultMode: "hits-only" }).map((row) => row.detail);
  assert.ok(searchDetails.some((detail) => detail.includes("idx_entries_active_name")), searchDetails.join("\n"));

  for (let index = 0; index < 60; index += 1) {
    insertEntry(db, {
      id: `library-two-${index}`,
      libraryId: "lib2",
      name: `Library Two ${index}.txt`,
      stem: `Library Two ${index}`,
      ext: ".txt",
      isDir: 0,
      kind: "text",
      path: `D:/Other/Library Two ${index}.txt`,
      parentPath: "D:/Other",
      relPath: `Library Two ${index}.txt`,
    });
  }
  const sparseLibraryDetails = explainSearchPlan(db, {
    libraryId: "lib1",
    text: "",
    resultMode: "hits-only",
  }).map((row) => row.detail);
  assert.ok(
    sparseLibraryDetails.some((detail) => detail.includes("idx_library_entries_active")),
    sparseLibraryDetails.join("\n"),
  );
  const directoryDetails = explainDirectoryChildrenPlan(db, "lib1", "D:/Movies/Avatar").map((row) => row.detail);
  assert.ok(directoryDetails.some((detail) => detail.includes("idx_entries_parent_active_name")), directoryDetails.join("\n"));
  db.close();
});

test("drive-root directory fallback uses the normalized parent path index", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "drive-root-child",
    name: "Users",
    stem: "Users",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "C:\\Users",
    parentPath: "C:\\",
    relPath: "Users",
  });

  const result = listDirectoryChildren(db, "lib1", "C:\\", { limit: 50 });
  assert.deepEqual(result.hits.map((hit) => hit.name), ["Users"]);

  const details = explainDirectoryChildrenPlan(db, "lib1", "C:\\").map((row) => row.detail);
  assert.ok(
    details.some((detail) => detail.includes("idx_entries_parent_path_active_name")),
    details.join("\n"),
  );
  db.close();
});

test("extension filters avoid runtime normalization and retain historical extension compatibility", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);
  insertEntry(db, {
    id: "legacy-mkv",
    name: "Legacy.mkv",
    stem: "Legacy",
    ext: "mkv",
    isDir: 0,
    kind: "video",
    path: "D:/Movies/Legacy.mkv",
    parentPath: "D:/Movies",
    relPath: "Legacy.mkv",
  });

  const result = searchEntries(db, {
    libraryId: "lib1",
    text: "ext:MKV",
    resultMode: "hits-only",
  });
  assert.deepEqual(result.hits.map((hit) => hit.name), ["Avatar.2009.mkv", "Backup.2009.mkv", "Legacy.mkv"]);

  const dottedOnlyPlan = explainSearchPlan(db, {
    libraryId: "lib1",
    text: "ext:srt",
    resultMode: "hits-only",
  }).map((row) => row.detail).join("\n");
  assert.match(dottedOnlyPlan, /idx_entries_active_ext_name/);

  const plan = explainSearchPlan(db, {
    libraryId: "lib1",
    text: "ext:mkv",
    resultMode: "hits-only",
  });
  assert.ok(plan.every((row) => !row.detail.includes("lower(")), plan.map((row) => row.detail).join("\n"));
  db.close();
});
