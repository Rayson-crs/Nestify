import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../db/sql.ts";
import { listEntriesByIds } from "../db/repos/index.ts";
import { createSearchCandidateEvaluation, searchEntries } from "../search/index.ts";
import { searchEntryIds } from "../app/runtime-plans.ts";
import { previewRuntimeRename } from "../app/runtime-rules.ts";
import { previewOrganize } from "./preview.ts";

const TOTAL_ENTRIES = 100_000;
const PAGE_SIZE = 200;
// Full-suite node:test runs files concurrently, so a strict 1s wall-clock budget
// is noisy. This still catches full-context or scan-ahead regressions, which
// take several seconds on this synthetic library.
const PAGE_BUDGET_MS = 2_000;

function seedLargeLibrary(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec(`
    CREATE TABLE library_entries (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      tombstone INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(entry_id, library_id)
    );
    CREATE INDEX idx_library_entries_library ON library_entries(library_id);
    CREATE INDEX idx_library_entries_entry ON library_entries(entry_id);
    CREATE INDEX idx_library_entries_active ON library_entries(library_id, tombstone, entry_id);
    DROP TRIGGER entries_ai;
    DROP TRIGGER entries_ad;
    DROP TRIGGER entries_au;
  `);
  const now = Date.now();
  db.prepare(
    `INSERT INTO libraries(id, name, roots_json, created_at, updated_at)
     VALUES ('bench-lib', 'Benchmark', ?, ?, ?)`,
  ).run(JSON.stringify(["D:/bench"]), now, now);

  const entry = db.prepare(`
    INSERT INTO entries(
      id, library_id, parent_id, name, stem, ext, is_dir, size, kind, path,
      parent_path, rel_path, mtime, ctime, depth, hash_full,
      child_count, file_count, dir_count
    ) VALUES (?, 'bench-lib', NULL, ?, ?, '.txt', 0, ?, 'file', ?, 'D:/bench', ?, ?, ?, 1, NULL, 0, 0, 0)
  `);
  const membership = db.prepare(`
    INSERT INTO library_entries(entry_id, library_id, rel_path, seen_at, tombstone)
    VALUES (?, 'bench-lib', ?, ?, 0)
  `);

  db.exec("BEGIN");
  for (let index = 0; index < TOTAL_ENTRIES; index++) {
    const name = `file-${String(index).padStart(5, "0")}.txt`;
    entry.run(`file-${index}`, name, name.slice(0, -5), index + 1, `D:/bench/${name}`, name, now, now);
    membership.run(`file-${index}`, name, now);
  }
  db.exec("COMMIT");
  return db;
}

function firstSourcePage(db: DatabaseSync): string[] {
  return searchEntries(db, {
    libraryId: "bench-lib",
    text: "file_name:file-",
    limit: PAGE_SIZE,
    resultMode: "hits-only",
  }).hits.map((hit) => hit.entryId);
}

test("shared rule context avoids rebuilding a large sibling index per rule", () => {
  const db = seedLargeLibrary();
  try {
    const ids = firstSourcePage(db);
    const entries = listEntriesByIds(db, ids);
    const filters = Array.from({ length: 2 }, (_value, index) =>
      `kind:file AND same_stem:${index === 0 ? "false" : "true"} AND filename.match('^file-')`);

    const repeatedStarted = performance.now();
    const repeated = filters.map((filter) => searchEntryIds(db, "bench-lib", filter, ids));
    const repeatedMs = performance.now() - repeatedStarted;

    const evaluation = createSearchCandidateEvaluation(db, {
      libraryId: "bench-lib",
      candidateIds: ids,
      entries,
    });
    const sharedStarted = performance.now();
    const shared = filters.map((filter) => searchEntryIds(db, "bench-lib", filter, ids, undefined, evaluation));
    const sharedMs = performance.now() - sharedStarted;

    assert.equal(evaluation.contextEntryCount, TOTAL_ENTRIES);
    assert.deepEqual(shared, repeated);
    assert.ok(sharedMs < repeatedMs, `shared context (${sharedMs.toFixed(1)}ms) was slower than repeated (${repeatedMs.toFixed(1)}ms)`);
    console.info(
      `rule context benchmark: repeated=${repeatedMs.toFixed(1)}ms shared=${sharedMs.toFixed(1)}ms ` +
      `build=${evaluation.contextBuildMs.toFixed(1)}ms entries=${evaluation.contextEntryCount}`,
    );
  } finally {
    db.close();
  }
});

test("organize and rename first pages stay lazy on a synthetic large library", () => {
  const db = seedLargeLibrary();
  try {
    const rules = Array.from({ length: 20 }, (_value, index) => ({
      id: `rule-${index}`,
      name: `Rule ${index}`,
      enabled: true,
      priority: index + 1,
      action: "rename_file" as const,
      template: "renamed-{seq}{ext}",
      target: "files" as const,
      filter: "kind:file AND filename.match('^file-')",
      continueMatching: false,
    }));
    const organizeStarted = performance.now();
    const organizeFirst = previewOrganize(db, "D:/quarantine", {
      libraryId: "bench-lib",
      filter: "file_name:file-",
      offset: 0,
      limit: PAGE_SIZE,
      rules,
    }, [], "D:/bench");
    const organizeFirstMs = performance.now() - organizeStarted;
    const organizeSecondStarted = performance.now();
    const organizeSecond = previewOrganize(db, "D:/quarantine", {
      libraryId: "bench-lib",
      filter: "file_name:file-",
      offset: PAGE_SIZE,
      limit: PAGE_SIZE,
      seqCursor: organizeFirst.plan.seqCursor,
      rules,
    }, [], "D:/bench");
    const organizeSecondMs = performance.now() - organizeSecondStarted;

    const renameStarted = performance.now();
    const renameFirst = previewRuntimeRename(db, {
      libraryId: "bench-lib",
      template: "renamed-{seq}{ext}",
      filter: "file_name:file-",
      offset: 0,
      limit: PAGE_SIZE,
    });
    const renameFirstMs = performance.now() - renameStarted;

    assert.equal(organizeFirst.sourceCount, PAGE_SIZE);
    assert.equal(organizeFirst.rows.length, PAGE_SIZE);
    assert.equal(organizeFirst.sourceHasMore, true);
    assert.equal(organizeSecond.sourceOffset, PAGE_SIZE);
    assert.equal(organizeSecond.sourceCount, PAGE_SIZE);
    assert.equal(organizeSecond.rows[0]?.from, "D:/bench/file-00200.txt");
    assert.equal(renameFirst.sourceCount, PAGE_SIZE);
    assert.equal(renameFirst.ops.length, PAGE_SIZE);
    assert.equal(renameFirst.sourceHasMore, true);
    assert.ok(organizeFirstMs < PAGE_BUDGET_MS, `organize first page took ${organizeFirstMs.toFixed(1)}ms`);
    assert.ok(organizeSecondMs < PAGE_BUDGET_MS, `organize second page took ${organizeSecondMs.toFixed(1)}ms`);
    assert.ok(renameFirstMs < PAGE_BUDGET_MS, `rename first page took ${renameFirstMs.toFixed(1)}ms`);
    console.info(
      `paged preview benchmark: organize-first=${organizeFirstMs.toFixed(1)}ms ` +
      `organize-second=${organizeSecondMs.toFixed(1)}ms rename-first=${renameFirstMs.toFixed(1)}ms`,
    );
  } finally {
    db.close();
  }
});
