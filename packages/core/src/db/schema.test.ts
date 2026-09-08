import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, getSchemaVersion } from "./migrations.ts";
import { openDatabase } from "./open.ts";
import { SCHEMA_SQL } from "./sql.ts";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "nestify-db-"));
  tempDirs.push(dir);
  return join(dir, "nested", "nestify.db");
}

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
}

test("migrate empty db to version 1", () => {
  const db = openDatabase(":memory:");
  assert.equal(getSchemaVersion(db), CURRENT_SCHEMA_VERSION);
  assert.equal(CURRENT_SCHEMA_VERSION, 2);

  const tables = new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
  );
  for (const name of [
    "schema_migrations",
    "libraries",
    "entries",
    "signals",
    "entry_fts",
    "name_trigrams",
    "scan_cursors",
    "dup_groups",
    "dup_members",
    "rulesets",
    "rules",
    "jobs",
    "job_ops",
    "thumbnails",
  ]) {
    assert.ok(tables.has(name), `missing table ${name}`);
  }

  const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  assert.equal(fk.foreign_keys, 1);
  db.close();
});

test("insert library + file + dir and search FTS", () => {
  const db = openDatabase(":memory:");
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

  const counts = db.prepare(`SELECT is_dir, COUNT(*) AS n FROM entries GROUP BY is_dir`).all() as Array<{
    is_dir: number;
    n: number;
  }>;
  assert.equal(counts.length, 2);

  const hits = db
    .prepare(
      `SELECT e.name
       FROM entry_fts
       JOIN entries e ON e.rowid = entry_fts.rowid
       WHERE entry_fts MATCH 'Avatar'
       ORDER BY e.name`,
    )
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    hits.map((row) => row.name),
    ["Avatar", "Avatar.2009.mkv"],
  );
  db.close();
});

test("unique path constraint", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "file1",
    name: "a.txt",
    stem: "a",
    ext: "txt",
    isDir: 0,
    kind: "file",
    path: "D:/Movies/a.txt",
    parentPath: "D:/Movies",
    relPath: "a.txt",
  });

  assert.throws(
    () =>
      insertEntry(db, {
        id: "file2",
        name: "a-copy.txt",
        stem: "a-copy",
        ext: "txt",
        isDir: 0,
        kind: "file",
        path: "D:/Movies/a.txt",
        parentPath: "D:/Movies",
        relPath: "a-copy.txt",
      }),
    /UNIQUE constraint failed: entries\.library_id, entries\.path/,
  );
  db.close();
});

test("cascade delete library removes entries", () => {
  const db = openDatabase(":memory:");
  insertLibrary(db);
  insertEntry(db, {
    id: "file1",
    name: "a.txt",
    stem: "a",
    ext: "txt",
    isDir: 0,
    kind: "file",
    path: "D:/Movies/a.txt",
    parentPath: "D:/Movies",
    relPath: "a.txt",
  });
  db.prepare(`INSERT INTO signals(entry_id, json, updated_at) VALUES (?, ?, ?)`).run(
    "file1",
    "{}",
    now(),
  );

  db.prepare(`DELETE FROM libraries WHERE id = ?`).run("lib1");
  const entries = db.prepare(`SELECT COUNT(*) AS n FROM entries`).get() as { n: number };
  const signals = db.prepare(`SELECT COUNT(*) AS n FROM signals`).get() as { n: number };
  assert.equal(entries.n, 0);
  assert.equal(signals.n, 0);
  db.close();
});

test("size index exists", () => {
  const db = openDatabase(":memory:");
  const row = db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND name = 'idx_entries_library_size'`,
    )
    .get() as { name: string; sql: string } | undefined;
  assert.ok(row);
  assert.match(row.sql, /entries\s*\(\s*library_id\s*,\s*size\s*\)/i);
  db.close();
});

test("reopen db does not fail (idempotent migration)", () => {
  const path = tempDbPath();
  const first = openDatabase(path);
  insertLibrary(first);
  assert.equal(getSchemaVersion(first), CURRENT_SCHEMA_VERSION);
  const journal = first.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  assert.equal(journal.journal_mode, "wal");
  first.close();

  const second = openDatabase(path);
  assert.equal(getSchemaVersion(second), CURRENT_SCHEMA_VERSION);
  const libraries = second.prepare(`SELECT COUNT(*) AS n FROM libraries`).get() as { n: number };
  assert.equal(libraries.n, 1);
  const versions = second.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get() as {
    n: number;
  };
  assert.equal(versions.n, MIGRATIONS.length);
  second.close();
});

test("v1 rulesets gain lifecycle columns", () => {
  const path = tempDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const legacy = new DatabaseSync(path);
  legacy.exec(SCHEMA_SQL);
  legacy
    .prepare(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)`)
    .run(1, now());
  legacy.close();

  const db = openDatabase(path);
  assert.equal(getSchemaVersion(db), 2);
  const columns = db
    .prepare(`PRAGMA table_info(rulesets)`)
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  assert.ok(names.has("enabled"));
  assert.ok(names.has("priority"));
  db.close();
});
