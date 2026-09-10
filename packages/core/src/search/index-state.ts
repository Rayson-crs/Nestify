import type { DatabaseSync } from "node:sqlite";
import { gramsForName } from "./trigram.ts";

export const SQLITE_SEARCH_INDEX_VERSION = 2;

export type SearchIndexStatus = "ready" | "building" | "dirty" | "failed";
export type SearchIndexState = {
  name: string;
  generation: number;
  status: SearchIndexStatus;
  version: number;
  updatedAt: number;
};

export function getSearchIndexState(db: DatabaseSync, name = "sqlite"): SearchIndexState {
  const row = db.prepare(`SELECT * FROM search_index_state WHERE name = ?`).get(name) as Record<string, unknown> | undefined;
  if (!row) {
    const now = Date.now();
    db.prepare(`INSERT INTO search_index_state(name, generation, status, version, updated_at) VALUES (?, 0, 'ready', ?, ?)`).run(
      name,
      SQLITE_SEARCH_INDEX_VERSION,
      now,
    );
    return { name, generation: 0, status: "ready", version: SQLITE_SEARCH_INDEX_VERSION, updatedAt: now };
  }
  return mapState(row);
}

export function sqliteSearchIndexVersion(db: DatabaseSync, name = "sqlite"): number {
  const row = db.prepare(`SELECT version FROM search_index_state WHERE name = ?`).get(name) as { version: number } | undefined;
  return row?.version ?? SQLITE_SEARCH_INDEX_VERSION;
}

export function markSearchIndexBuilding(db: DatabaseSync, generation: number, name = "sqlite"): SearchIndexState {
  return writeState(db, { ...getSearchIndexState(db, name), generation, status: "building" });
}

export function markSearchIndexReady(db: DatabaseSync, generation: number, name = "sqlite"): SearchIndexState {
  return writeState(db, { ...getSearchIndexState(db, name), generation, status: "ready" });
}

export function markSearchIndexDirty(db: DatabaseSync, name = "sqlite"): SearchIndexState {
  return writeState(db, { ...getSearchIndexState(db, name), status: "dirty" });
}

export function markSearchIndexFailed(db: DatabaseSync, name = "sqlite"): SearchIndexState {
  return writeState(db, { ...getSearchIndexState(db, name), status: "failed" });
}

export function shouldFallbackToSqlite(db: DatabaseSync, name = "sqlite"): boolean {
  return getSearchIndexState(db, name).status !== "ready";
}

export function rebuildSqliteDerivedIndexes(db: DatabaseSync): SearchIndexState {
  const state = markSearchIndexBuilding(db, getFactGeneration(db));
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(`INSERT INTO entry_fts(entry_fts) VALUES ('rebuild')`);
    db.exec(`DELETE FROM name_trigrams`);
    const insert = db.prepare(`INSERT OR IGNORE INTO name_trigrams(entry_id, gram) VALUES (?, ?)`);
    const rows = db.prepare(`SELECT id, name FROM entries`).iterate() as Iterable<{ id: string; name: string }>;
    for (const row of rows) {
      for (const gram of gramsForName(row.name)) insert.run(row.id, gram);
    }
    db.exec("COMMIT");
    const generation = getFactGeneration(db);
    return writeState(db, {
      ...state,
      generation,
      status: "ready",
      version: SQLITE_SEARCH_INDEX_VERSION,
    });
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original rebuild error */ }
    markSearchIndexFailed(db);
    throw error;
  }
}

/**
 * Upgrade legacy n-grams in short transactions so queries and watcher writes
 * can continue between batches. New and renamed entries are maintained by the
 * indexer while this catch-up scan runs.
 */
export async function upgradeSqliteDerivedIndexes(
  db: DatabaseSync,
  batchSize = 1_000,
): Promise<SearchIndexState> {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError("batchSize must be a positive integer");
  }
  const current = getSearchIndexState(db);
  if (current.version >= SQLITE_SEARCH_INDEX_VERSION) return current;

  markSearchIndexBuilding(db, current.generation);
  const rowIds = (db.prepare(`SELECT rowid AS rowid FROM entries ORDER BY rowid`).all() as Array<{ rowid: number }>)
    .map((row) => row.rowid);
  const insert = db.prepare(`INSERT OR IGNORE INTO name_trigrams(entry_id, gram) VALUES (?, ?)`);

  try {
    for (let offset = 0; offset < rowIds.length; offset += batchSize) {
      const batch = rowIds.slice(offset, offset + batchSize);
      const placeholders = batch.map(() => "?").join(", ");
      const rows = db.prepare(`SELECT id, name FROM entries WHERE rowid IN (${placeholders})`)
        .all(...batch) as Array<{ id: string; name: string }>;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of rows) {
          for (const gram of gramsForName(row.name)) insert.run(row.id, gram);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return writeState(db, {
      ...current,
      generation: getFactGeneration(db),
      status: "ready",
      version: SQLITE_SEARCH_INDEX_VERSION,
    });
  } catch (error) {
    markSearchIndexFailed(db);
    throw error;
  }
}

function getFactGeneration(db: DatabaseSync): number {
  return Number((db.prepare(`SELECT coalesce(max(generation), 0) AS generation FROM sync_state`).get() as { generation: number }).generation);
}

function writeState(db: DatabaseSync, state: SearchIndexState): SearchIndexState {
  const updatedAt = Date.now();
  db.prepare(`INSERT INTO search_index_state(name, generation, status, version, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET generation = excluded.generation, status = excluded.status, version = excluded.version, updated_at = excluded.updated_at`).run(state.name, state.generation, state.status, state.version, updatedAt);
  return { ...state, updatedAt };
}

function mapState(row: Record<string, unknown>): SearchIndexState {
  return {
    name: String(row.name),
    generation: Number(row.generation),
    status: String(row.status) as SearchIndexStatus,
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
  };
}
