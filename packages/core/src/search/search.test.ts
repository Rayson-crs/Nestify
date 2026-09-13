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
    ctime?: number | null;
    depth?: number;
    hashFull?: string | null;
    childCount?: number;
    fileCount?: number;
    dirCount?: number;
  },
): void {
  db.prepare(
    `INSERT INTO entries(
      id, library_id, parent_id, name, stem, ext, is_dir, size, kind, path, parent_path, rel_path,
      mtime, ctime, depth, hash_full, child_count, file_count, dir_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    row.ctime ?? row.mtime ?? null,
    row.depth ?? 0,
    row.hashFull ?? null,
    row.childCount ?? 0,
    row.fileCount ?? 0,
    row.dirCount ?? 0,
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
  assert.deepEqual(parseSearchQuery("kind:dir AND dir_count:>=1"), {
    textTerms: [],
    kind: "dir",
    dirCount: { operator: "gte", value: 1 },
  });
  assert.deepEqual(parseSearchQuery("child_count:>=1 file_count:=0"), {
    textTerms: [],
    childCount: { operator: "gte", value: 1 },
    fileCount: { operator: "eq", value: 0 },
  });
  assert.deepEqual(parseSearchQuery("folder_name:项目 file_name:报告"), {
    textTerms: [],
    folderName: "项目",
    fileName: "报告",
  });
  assert.deepEqual(parseSearchQuery("kind:dir AND folder_name:项目"), {
    textTerms: [],
    kind: "dir",
    folderName: "项目",
  });
  const boolean = parseSearchQuery("folder_name:项目 OR file_name:报告");
  assert.deepEqual(boolean.expression, {
    type: "or",
    children: [
      { type: "filter", field: "folder_name", values: ["项目"] },
      { type: "filter", field: "file_name", values: ["报告"] },
    ],
  });
});

test("parseSearchQuery extracts comparison, feature, duplicate, and OR filters", () => {
  assert.deepEqual(
    parseSearchQuery("size:>1gb mtime:2024..2026 ctime:2025 depth:<=3 has:subtitle dup:true unique_video:true"),
    {
      textTerms: [],
      size: { operator: "gt", value: 1_000_000_000 },
      mtime: {
        operator: "between",
        min: Date.UTC(2024, 0, 1),
        max: Date.UTC(2027, 0, 1) - 1,
      },
      ctime: {
        operator: "between",
        min: Date.UTC(2025, 0, 1),
        max: Date.UTC(2026, 0, 1) - 1,
      },
      depth: { operator: "lte", value: 3 },
      has: "subtitle",
      dup: true,
      uniqueVideo: true,
    },
  );

  const parsed = parseSearchQuery("Poster OR Avatar ext:mkv");
  assert.equal(parsed.expression?.type, "or");
  assert.deepEqual(parsed.expression?.children.map((child) => child.type), ["text", "and"]);
});

test("parseSearchQuery treats adjacent keywords as OR and keeps filters ANDed", () => {
  const keywords = parseSearchQuery("Avatar Poster");
  assert.deepEqual(keywords.textTerms, ["Avatar", "Poster"]);
  assert.equal(keywords.expression?.type, "or");
  assert.deepEqual(keywords.expression?.children, [
    { type: "text", value: "Avatar", phrase: false },
    { type: "text", value: "Poster", phrase: false },
  ]);

  const filtered = parseSearchQuery("Avatar Poster ext:mkv");
  assert.deepEqual(filtered.textTerms, ["Avatar", "Poster"]);
  assert.deepEqual(filtered.ext, ["mkv"]);
  assert.equal(filtered.expression?.type, "and");
  assert.deepEqual(filtered.expression?.children.map((child) => child.type), ["or", "filter"]);

  const explicitAnd = parseSearchQuery("Avatar AND Poster");
  assert.deepEqual(explicitAnd.textTerms, ["Avatar", "Poster"]);
  assert.equal(explicitAnd.expression, undefined);
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

test("folder_name and file_name only match the entry's own name", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "project-dir",
    name: "项目资料",
    stem: "项目资料",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Movies/项目资料",
    parentPath: "D:/Movies",
    relPath: "项目资料",
  });
  insertEntry(db, {
    id: "report-file",
    parentId: "project-dir",
    name: "年度报告.pdf",
    stem: "年度报告",
    ext: ".pdf",
    isDir: 0,
    kind: "document",
    path: "D:/Movies/项目资料/年度报告.pdf",
    parentPath: "D:/Movies/项目资料",
    relPath: "项目资料/年度报告.pdf",
  });
  insertEntry(db, {
    id: "other-file",
    parentId: "project-dir",
    name: "说明.txt",
    stem: "说明",
    ext: ".txt",
    isDir: 0,
    kind: "text",
    path: "D:/Movies/项目资料/说明.txt",
    parentPath: "D:/Movies/项目资料",
    relPath: "项目资料/说明.txt",
  });
  insertEntry(db, {
    id: "other-dir",
    name: "归档",
    stem: "归档",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Movies/归档",
    parentPath: "D:/Movies",
    relPath: "归档",
  });

  assert.deepEqual(
    searchEntries(db, { libraryId: "lib1", text: "folder_name:项目", resultMode: "hits-only" }).hits.map((hit) => hit.name),
    ["项目资料"],
  );
  assert.deepEqual(
    searchEntries(db, { libraryId: "lib1", text: "file_name:报告", resultMode: "hits-only" }).hits.map((hit) => hit.name),
    ["年度报告.pdf"],
  );
  assert.deepEqual(
    searchEntries(db, { libraryId: "lib1", text: "file_name:项目", resultMode: "hits-only" }).hits.map((hit) => hit.name),
    [],
  );
  assert.deepEqual(
    searchEntries(db, { libraryId: "lib1", text: "folder_name:项目 AND file_name:报告", resultMode: "hits-only" }).hits.map((hit) => hit.name),
    [],
  );
  assert.deepEqual(
    searchEntries(db, { libraryId: "lib1", text: "kind:dir AND folder_name:项目", resultMode: "hits-only" }).hits.map((hit) => hit.name),
    ["项目资料"],
  );
  assert.deepEqual(
    searchEntries(db, { libraryId: "lib1", text: "folder_name:项目 OR file_name:报告", resultMode: "hits-only" }).hits.map((hit) => hit.name).sort(),
    ["项目资料", "年度报告.pdf"].sort(),
  );
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

test("directory count filters match folders by child/file/dir counts", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "parent-dir",
    name: "Shows",
    stem: "Shows",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Movies/Shows",
    parentPath: "D:/Movies",
    relPath: "Shows",
    childCount: 2,
    fileCount: 1,
    dirCount: 1,
  });
  insertEntry(db, {
    id: "empty-dir",
    name: "Empty",
    stem: "Empty",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Movies/Empty",
    parentPath: "D:/Movies",
    relPath: "Empty",
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
  });
  insertEntry(db, {
    id: "nested-dir",
    parentId: "parent-dir",
    name: "Season",
    stem: "Season",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Movies/Shows/Season",
    parentPath: "D:/Movies/Shows",
    relPath: "Shows/Season",
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
  });
  insertEntry(db, {
    id: "video",
    parentId: "parent-dir",
    name: "Show.mkv",
    stem: "Show",
    ext: ".mkv",
    isDir: 0,
    kind: "video",
    path: "D:/Movies/Shows/Show.mkv",
    parentPath: "D:/Movies/Shows",
    relPath: "Shows/Show.mkv",
  });

  const withDirs = searchEntries(db, { libraryId: "lib1", text: "kind:dir AND dir_count:>=1" });
  assert.deepEqual(withDirs.hits.map((hit) => hit.name), ["Shows"]);

  const empty = searchEntries(db, { libraryId: "lib1", text: "kind:dir AND child_count:=0" });
  assert.deepEqual(empty.hits.map((hit) => hit.name).sort(), ["Empty", "Season"]);

  const files = searchEntries(db, { libraryId: "lib1", text: "file_count:>=1" });
  assert.deepEqual(files.hits.map((hit) => hit.name), ["Shows"]);
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

test("parseSearchQuery compiles NOT and dashed exclusions", () => {
  const notTerm = parseSearchQuery("kind:video NOT has:subtitle");
  assert.equal(notTerm.kind, "video");
  assert.equal(notTerm.expression?.type, "and");
  assert.equal(notTerm.expression?.children[1]?.type, "not");

  const dashed = parseSearchQuery("-trailer");
  assert.equal(dashed.expression?.type, "not");
  assert.deepEqual(dashed.expression?.child, { type: "text", value: "trailer", phrase: false });

  const quotedDash = parseSearchQuery('"-tmp"');
  assert.equal(quotedDash.phrase, "-tmp");
  assert.equal(quotedDash.expression, undefined);
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

test("ctime, sidecar, unique video, NOT, and illegal names are searchable", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);
  insertEntry(db, {
    id: "avatar-nfo",
    parentId: "avatar-dir",
    name: "Avatar.2009.nfo",
    stem: "Avatar.2009",
    ext: ".nfo",
    isDir: 0,
    size: 120,
    kind: "document",
    path: "D:/Movies/Avatar/Avatar.2009.nfo",
    parentPath: "D:/Movies/Avatar",
    relPath: "Avatar/Avatar.2009.nfo",
    mtime: Date.UTC(2025, 5, 3),
    ctime: Date.UTC(2025, 5, 3),
    depth: 2,
  });
  insertEntry(db, {
    id: "avatar-cover",
    parentId: "avatar-dir",
    name: "cover.jpg",
    stem: "cover",
    ext: ".jpg",
    isDir: 0,
    size: 4000,
    kind: "image",
    path: "D:/Movies/Avatar/cover.jpg",
    parentPath: "D:/Movies/Avatar",
    relPath: "Avatar/cover.jpg",
    mtime: Date.UTC(2025, 5, 4),
    ctime: Date.UTC(2025, 5, 4),
    depth: 2,
  });
  insertEntry(db, {
    id: "mixed-dir",
    name: "Mixed",
    stem: "Mixed",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Movies/Mixed",
    parentPath: "D:/Movies",
    relPath: "Mixed",
    depth: 1,
  });
  insertEntry(db, {
    id: "mixed-one",
    parentId: "mixed-dir",
    name: "One.mkv",
    stem: "One",
    ext: ".mkv",
    isDir: 0,
    kind: "video",
    path: "D:/Movies/Mixed/One.mkv",
    parentPath: "D:/Movies/Mixed",
    relPath: "Mixed/One.mkv",
    depth: 2,
  });
  insertEntry(db, {
    id: "mixed-two",
    parentId: "mixed-dir",
    name: "Two.mkv",
    stem: "Two",
    ext: ".mkv",
    isDir: 0,
    kind: "video",
    path: "D:/Movies/Mixed/Two.mkv",
    parentPath: "D:/Movies/Mixed",
    relPath: "Mixed/Two.mkv",
    depth: 2,
  });
  insertEntry(db, {
    id: "illegal-name",
    name: "Avatar?.mkv",
    stem: "Avatar?",
    ext: ".mkv",
    isDir: 0,
    kind: "video",
    path: "D:/Movies/Illegal/Avatar?.mkv",
    parentPath: "D:/Movies/Illegal",
    relPath: "Illegal/Avatar?.mkv",
    ctime: Date.UTC(2020, 0, 1),
    mtime: Date.UTC(2020, 0, 1),
    depth: 2,
  });
  insertEntry(db, {
    id: "orphan-nfo",
    name: "Orphan.nfo",
    stem: "Orphan",
    ext: ".nfo",
    isDir: 0,
    kind: "document",
    path: "D:/Movies/Orphan.nfo",
    parentPath: "D:/Movies",
    relPath: "Orphan.nfo",
    depth: 1,
  });

  const created2025 = searchEntries(db, { libraryId: "lib1", text: "ctime:2025" });
  assert.ok(created2025.hits.some((hit) => hit.name === "Avatar.2009.mkv"));
  assert.equal(created2025.hits.some((hit) => hit.name === "Avatar?.mkv"), false);

  const withNfo = searchEntries(db, { libraryId: "lib1", text: "has:nfo" });
  assert.deepEqual(withNfo.hits.map((hit) => hit.name), ["Avatar.2009.mkv", "Avatar.2009.srt"]);

  const withCover = searchEntries(db, { libraryId: "lib1", text: "has:cover" });
  assert.ok(withCover.hits.some((hit) => hit.name === "Avatar.2009.mkv"));

  const missingSubtitle = searchEntries(db, { libraryId: "lib1", text: "kind:video AND missing:subtitle" });
  assert.deepEqual(
    missingSubtitle.hits.map((hit) => hit.name),
    ["Avatar?.mkv", "Backup.2009.mkv", "One.mkv", "Two.mkv"],
  );

  const uniqueDirs = searchEntries(db, { libraryId: "lib1", text: "kind:dir AND unique_video:true" });
  assert.deepEqual(uniqueDirs.hits.map((hit) => hit.name), ["Avatar", "Backup"]);

  const sidecars = searchEntries(db, { libraryId: "lib1", text: "is_sidecar:true" });
  assert.deepEqual(
    sidecars.hits.map((hit) => hit.name),
    ["Avatar.2009.nfo", "Avatar.2009.srt", "cover.jpg", "Orphan.nfo"],
  );

  const illegal = searchEntries(db, { libraryId: "lib1", text: "windows_illegal:true" });
  assert.deepEqual(illegal.hits.map((hit) => hit.name), ["Avatar?.mkv"]);

  const excluded = searchEntries(db, { libraryId: "lib1", text: "kind:video NOT has:subtitle" });
  assert.deepEqual(
    excluded.hits.map((hit) => hit.name),
    ["Avatar?.mkv", "Backup.2009.mkv", "One.mkv", "Two.mkv"],
  );

  const dashed = searchEntries(db, { libraryId: "lib1", text: "Avatar -srt" });
  assert.deepEqual(
    dashed.hits.map((hit) => hit.name),
    ["Avatar", "Avatar.2009.mkv", "Avatar.2009.nfo", "Avatar?.mkv"],
  );

  const usefulOne = searchEntries(db, { libraryId: "lib1", text: "kind:dir AND useful_file_count:=1" });
  assert.deepEqual(usefulOne.hits.map((hit) => hit.name), ["Avatar", "Backup"]);

  const sameStem = searchEntries(db, { libraryId: "lib1", text: "same_stem:true" });
  assert.deepEqual(
    sameStem.hits.map((hit) => hit.name),
    ["Avatar.2009.mkv", "Avatar.2009.nfo", "Avatar.2009.srt"],
  );

  const orphans = searchEntries(db, { libraryId: "lib1", text: "orphan_sidecar:true" });
  assert.deepEqual(orphans.hits.map((hit) => hit.name), ["Orphan.nfo", "Poster.jpg"]);
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

test("space-separated keywords default to OR while filters stay ANDed", () => {
  const db = openDatabase(":memory:");
  seedSearchMatrix(db);

  const keywords = searchEntries(db, { libraryId: "lib1", text: "Avatar Poster" });
  assert.deepEqual(
    keywords.hits.map((hit) => hit.name),
    ["Avatar", "Avatar.2009.mkv", "Avatar.2009.srt", "Poster.jpg"],
  );

  const filtered = searchEntries(db, { libraryId: "lib1", text: "Avatar Poster ext:mkv" });
  assert.deepEqual(
    filtered.hits.map((hit) => hit.name),
    ["Avatar.2009.mkv"],
  );

  const bothRequired = searchEntries(db, { libraryId: "lib1", text: "Avatar AND Poster" });
  assert.deepEqual(bothRequired.hits.map((hit) => hit.name), []);
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

test("drive-root children still list when the root exists but parent_id was dropped", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "drive-root",
    name: "C:\\",
    stem: "C:\\",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "C:\\",
    parentPath: null,
    relPath: "",
  });
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

  const byBareDrive = listDirectoryChildren(db, "lib1", "C:", { limit: 50 });
  assert.deepEqual(byBareDrive.hits.map((hit) => hit.name), ["Users"]);
  db.close();
});

test("drive-root children still list when parent_path is a bare drive letter", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "bare-drive-root",
    name: "C:",
    stem: "C:",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "C:",
    parentPath: null,
    relPath: "",
  });
  insertEntry(db, {
    id: "bare-drive-child",
    name: "Users",
    stem: "Users",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "C:\\Users",
    parentPath: "C:",
    relPath: "Users",
  });

  const result = listDirectoryChildren(db, "lib1", "C:\\", { limit: 50 });
  assert.deepEqual(result.hits.map((hit) => hit.name), ["Users"]);

  const bySlash = listDirectoryChildren(db, "lib1", "C:/", { limit: 50 });
  assert.deepEqual(bySlash.hits.map((hit) => hit.name), ["Users"]);
  db.close();
});

test("directory children resolve slash-mismatched windows paths through parent_id", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "win-root",
    name: "Windows",
    stem: "Windows",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "C:\\Windows",
    parentPath: "C:\\",
    relPath: "Windows",
  });
  insertEntry(db, {
    id: "win-child",
    parentId: "win-root",
    name: "System32",
    stem: "System32",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "C:\\Windows\\System32",
    parentPath: "C:\\Windows",
    relPath: "Windows/System32",
  });

  const bySlash = listDirectoryChildren(db, "lib1", "C:/Windows", { limit: 50 });
  assert.deepEqual(bySlash.hits.map((hit) => hit.name), ["System32"]);

  const slashPlan = explainDirectoryChildrenPlan(db, "lib1", "C:/Windows").map((row) => row.detail);
  assert.ok(
    slashPlan.some((detail) => detail.includes("idx_entries_parent_active_name")),
    slashPlan.join("\n"),
  );

  const byParentId = listDirectoryChildren(db, "lib1", "not-a-real-path", {
    limit: 50,
    parentId: "win-root",
  });
  assert.deepEqual(byParentId.hits.map((hit) => hit.name), ["System32"]);

  const parentIdPlan = explainDirectoryChildrenPlan(db, "lib1", "not-a-real-path", "win-root").map((row) => row.detail);
  assert.ok(
    parentIdPlan.some((detail) => detail.includes("idx_entries_parent_active_name")),
    parentIdPlan.join("\n"),
  );
  db.close();
});

test("directory children resolve a parent only from the requested library", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertLibrary(db, "lib2");
  insertEntry(db, {
    id: "lib1-root",
    libraryId: "lib1",
    name: "Shared",
    stem: "Shared",
    ext: "",
    isDir: 1,
    kind: "dir",
    path: "D:/Shared",
    parentPath: "D:/",
    relPath: "Shared",
  });
  insertEntry(db, {
    id: "lib2-child",
    libraryId: "lib2",
    // The parent id points at lib1's canonical entry, while the lib2 path is
    // elsewhere. A path lookup that ignores library membership would return
    // this child for lib2's D:/Shared directory.
    parentId: "lib1-root",
    name: "Only-in-lib2.txt",
    stem: "Only-in-lib2",
    ext: ".txt",
    isDir: 0,
    kind: "document",
    path: "D:/Other/Only-in-lib2.txt",
    parentPath: "D:/Other",
    relPath: "Only-in-lib2.txt",
  });

  const result = listDirectoryChildren(db, "lib2", "D:/Shared", { limit: 50 });
  assert.deepEqual(result.hits.map((hit) => hit.name), []);
  db.close();
});

test("directory children synthesize missing ancestor folders from deeper descendants", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db, "lib-z");
  insertEntry(db, {
    id: "deep-photo",
    libraryId: "lib-z",
    name: "a.jpg",
    stem: "a",
    ext: ".jpg",
    isDir: 0,
    kind: "image",
    path: "Z:\\Media\\Album\\P\\a.jpg",
    parentPath: "Z:\\Media\\Album\\P",
    relPath: "Media/Album/P/a.jpg",
    depth: 4,
  });

  const root = listDirectoryChildren(db, "lib-z", "Z:\\", { limit: 50 });
  assert.deepEqual(root.hits.map((hit) => hit.name), ["Media"]);
  assert.equal(root.hits[0]?.kind, "dir");
  assert.equal(root.hits[0]?.path, "Z:\\Media");
  assert.ok(root.hits[0]?.entryId.startsWith("virtual:"));

  const nested = listDirectoryChildren(db, "lib-z", "Z:\\Media", { limit: 50 });
  assert.deepEqual(nested.hits.map((hit) => hit.name), ["Album"]);
  assert.equal(nested.hits[0]?.path, "Z:\\Media\\Album");
  db.close();
});

test("directory children report the real total and page past the first limit", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  for (let index = 1; index <= 120; index += 1) {
    const name = `Item-${String(index).padStart(3, "0")}`;
    insertEntry(db, {
      id: `child-${index}`,
      name,
      stem: name,
      ext: "",
      isDir: 1,
      kind: "dir",
      path: `C:\\Xunlei\\${name}`,
      parentPath: "C:\\Xunlei",
      relPath: `Xunlei/${name}`,
    });
  }

  const first = listDirectoryChildren(db, "lib1", "C:\\Xunlei", {
    limit: 50,
    sort: { field: "path_mtime" },
  });
  assert.equal(first.hits.length, 50);
  assert.equal(first.total, 120);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  assert.equal(first.hits[0]?.name, "Item-001");
  assert.equal(first.hits.at(-1)?.name, "Item-050");

  const second = listDirectoryChildren(db, "lib1", "C:\\Xunlei", {
    limit: 50,
    offset: 50,
    sort: { field: "path_mtime" },
  });
  assert.equal(second.hits.length, 50);
  assert.equal(second.total, 120);
  assert.equal(second.hasMore, true);
  assert.equal(second.hits[0]?.name, "Item-051");
  assert.equal(second.hits.at(-1)?.name, "Item-100");

  const last = listDirectoryChildren(db, "lib1", "C:\\Xunlei", {
    limit: 50,
    offset: 100,
    sort: { field: "path_mtime" },
  });
  assert.equal(last.hits.length, 20);
  assert.equal(last.total, 120);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextCursor, undefined);
  assert.equal(last.hits[0]?.name, "Item-101");
  assert.equal(last.hits.at(-1)?.name, "Item-120");
  db.close();
});

test("synthesized directory children also page past the first limit", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db, "lib-z");
  for (let index = 1; index <= 120; index += 1) {
    const folder = `Folder-${String(index).padStart(3, "0")}`;
    insertEntry(db, {
      id: `deep-${index}`,
      libraryId: "lib-z",
      name: "a.jpg",
      stem: "a",
      ext: ".jpg",
      isDir: 0,
      kind: "image",
      path: `Z:\\Xunlei\\${folder}\\a.jpg`,
      parentPath: `Z:\\Xunlei\\${folder}`,
      relPath: `Xunlei/${folder}/a.jpg`,
      depth: 3,
    });
  }

  const first = listDirectoryChildren(db, "lib-z", "Z:\\Xunlei", { limit: 50 });
  assert.equal(first.hits.length, 50);
  assert.equal(first.total, 120);
  assert.equal(first.hasMore, true);
  assert.equal(first.hits[0]?.name, "Folder-001");
  assert.ok(first.hits[0]?.entryId.startsWith("virtual:"));

  const second = listDirectoryChildren(db, "lib-z", "Z:\\Xunlei", { limit: 50, offset: 50 });
  assert.equal(second.hits.length, 50);
  assert.equal(second.total, 120);
  assert.equal(second.hits[0]?.name, "Folder-051");

  const last = listDirectoryChildren(db, "lib-z", "Z:\\Xunlei", { limit: 50, offset: 100 });
  assert.equal(last.hits.length, 20);
  assert.equal(last.hasMore, false);
  assert.equal(last.hits.at(-1)?.name, "Folder-120");
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
