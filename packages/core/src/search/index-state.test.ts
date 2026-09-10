import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../db/open.ts";
import {
  SQLITE_SEARCH_INDEX_VERSION,
  getSearchIndexState,
  markSearchIndexDirty,
  rebuildSqliteDerivedIndexes,
  shouldFallbackToSqlite,
  upgradeSqliteDerivedIndexes,
} from "./index-state.ts";

test("derived index state falls back while dirty and rebuilds FTS plus n-grams", () => {
  const db = openDatabase(":memory:");
  const timestamp = Date.now();
  db.prepare(`INSERT INTO libraries(id, name, roots_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    "lib1", "Test", JSON.stringify(["D:/"]), timestamp, timestamp,
  );
  db.prepare(`INSERT INTO entries(id, library_id, name, stem, ext, is_dir, kind, path, rel_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "entry1", "lib1", "Alpha Movie.mkv", "Alpha Movie", "mkv", 0, "video", "D:/Alpha Movie.mkv", "Alpha Movie.mkv",
  );
  db.prepare(`INSERT INTO library_entries(entry_id, library_id, rel_path, seen_at) VALUES (?, ?, ?, ?)`).run(
    "entry1", "lib1", "Alpha Movie.mkv", timestamp,
  );

  assert.equal(shouldFallbackToSqlite(db), false);
  markSearchIndexDirty(db);
  assert.equal(getSearchIndexState(db).status, "dirty");
  assert.equal(shouldFallbackToSqlite(db), true);
  const ready = rebuildSqliteDerivedIndexes(db);
  assert.equal(ready.status, "ready");
  assert.equal(shouldFallbackToSqlite(db), false);
  const fts = db.prepare(`SELECT COUNT(*) AS count FROM entry_fts WHERE entry_fts MATCH 'Alpha'`).get() as { count: number };
  const grams = db.prepare(`SELECT COUNT(*) AS count FROM name_trigrams WHERE entry_id = ?`).get("entry1") as { count: number };
  assert.equal(fts.count, 1);
  assert.ok(grams.count > 0);
  db.close();
});

test("index upgrade backfills legacy Chinese unigrams in batches", async () => {
  const db = openDatabase(":memory:");
  const timestamp = Date.now();
  db.prepare(`INSERT INTO libraries(id, name, roots_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    "lib1", "Test", JSON.stringify(["D:/"]), timestamp, timestamp,
  );
  db.prepare(`INSERT INTO entries(id, library_id, name, stem, ext, is_dir, kind, path, rel_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "entry1", "lib1", "气象雷达.pdf", "气象雷达", ".pdf", 0, "document", "D:/气象雷达.pdf", "气象雷达.pdf",
  );
  db.prepare(`UPDATE search_index_state SET version = 1`).run();

  const upgraded = await upgradeSqliteDerivedIndexes(db, 1);
  assert.equal(upgraded.version, SQLITE_SEARCH_INDEX_VERSION);
  assert.equal(upgraded.status, "ready");
  const grams = db.prepare(`SELECT gram FROM name_trigrams WHERE entry_id = ? ORDER BY gram`).all("entry1") as Array<{ gram: string }>;
  assert.ok(grams.some((row) => row.gram === "气"));
  assert.ok(grams.some((row) => row.gram === "气象"));
  db.close();
});
