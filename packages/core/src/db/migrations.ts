import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./sql.ts";
import type { DatabaseLogFunction } from "./open.ts";

export const CURRENT_SCHEMA_VERSION = 7;

export type Migration = {
  version: number;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: SCHEMA_SQL },
  {
    version: 2,
    sql: `
ALTER TABLE rulesets ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rulesets ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;
`,
  },
  {
    version: 3,
    sql: `
PRAGMA defer_foreign_keys = ON;

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

-- Build the duplicate-to-canonical map in one ordered pass. The correlated
-- form used O(entries^2) scans and blocked startup on existing libraries.
CREATE TABLE _entry_path_map_v3 AS
WITH ranked_entries AS (
  SELECT
    duplicate.id AS duplicate_id,
    first_value(duplicate.id) OVER (
      PARTITION BY replace(duplicate.path, '\\', '/')
      ORDER BY duplicate.rowid
    ) AS keep_id
  FROM entries duplicate
)
SELECT duplicate_id, keep_id FROM ranked_entries;

CREATE INDEX idx__entry_path_map_v3_duplicate
  ON _entry_path_map_v3(duplicate_id);

INSERT OR REPLACE INTO library_entries(entry_id, library_id, rel_path, seen_at, tombstone)
SELECT
  coalesce(path_map.keep_id, entry.id),
  entry.library_id,
  entry.rel_path,
  coalesce(entry.seen_at, 0),
  entry.tombstone
FROM entries entry
LEFT JOIN _entry_path_map_v3 path_map ON path_map.duplicate_id = entry.id;

UPDATE OR REPLACE entries
SET parent_id = (
  SELECT path_map.keep_id
  FROM _entry_path_map_v3 path_map
  WHERE path_map.duplicate_id = entries.parent_id
)
WHERE entries.parent_id IN (SELECT path_map.duplicate_id FROM _entry_path_map_v3 path_map);

UPDATE OR REPLACE signals
SET entry_id = (
  SELECT path_map.keep_id
  FROM _entry_path_map_v3 path_map
  WHERE path_map.duplicate_id = signals.entry_id
)
WHERE signals.entry_id IN (SELECT path_map.duplicate_id FROM _entry_path_map_v3 path_map);

UPDATE OR REPLACE name_trigrams
SET entry_id = (
  SELECT path_map.keep_id
  FROM _entry_path_map_v3 path_map
  WHERE path_map.duplicate_id = name_trigrams.entry_id
)
WHERE name_trigrams.entry_id IN (SELECT path_map.duplicate_id FROM _entry_path_map_v3 path_map);

UPDATE OR REPLACE thumbnails
SET entry_id = (
  SELECT path_map.keep_id
  FROM _entry_path_map_v3 path_map
  WHERE path_map.duplicate_id = thumbnails.entry_id
)
WHERE thumbnails.entry_id IN (SELECT path_map.duplicate_id FROM _entry_path_map_v3 path_map);

UPDATE OR REPLACE dup_members
SET entry_id = (
  SELECT path_map.keep_id
  FROM _entry_path_map_v3 path_map
  WHERE path_map.duplicate_id = dup_members.entry_id
)
WHERE dup_members.entry_id IN (SELECT path_map.duplicate_id FROM _entry_path_map_v3 path_map);

CREATE TABLE entries_v3 (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stem TEXT NOT NULL,
  ext TEXT NOT NULL,
  is_dir INTEGER NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER,
  ctime INTEGER,
  atime INTEGER,
  ino TEXT,
  dev TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'local',
  mime TEXT,
  path TEXT NOT NULL,
  parent_path TEXT,
  rel_path TEXT NOT NULL,
  hash_quick TEXT,
  hash_full TEXT,
  child_count INTEGER,
  file_count INTEGER,
  dir_count INTEGER,
  tombstone INTEGER NOT NULL DEFAULT 0,
  seen_at INTEGER,
  indexed_at INTEGER,
  UNIQUE(path)
);

INSERT INTO entries_v3
SELECT entry.*
FROM entries entry
WHERE entry.id NOT IN (SELECT path_map.duplicate_id FROM _entry_path_map_v3 path_map);

DROP TRIGGER IF EXISTS entries_ai;
DROP TRIGGER IF EXISTS entries_ad;
DROP TRIGGER IF EXISTS entries_au;
DROP TABLE entries;
ALTER TABLE entries_v3 RENAME TO entries;

CREATE INDEX idx_entries_library_name ON entries(library_id, name);
CREATE INDEX idx_entries_library_ext ON entries(library_id, ext);
CREATE INDEX idx_entries_library_size ON entries(library_id, size);
CREATE INDEX idx_entries_library_mtime ON entries(library_id, mtime);
CREATE INDEX idx_entries_library_kind ON entries(library_id, kind);
CREATE INDEX idx_entries_hash_quick ON entries(hash_quick);
CREATE INDEX idx_entries_hash_full ON entries(hash_full);
CREATE INDEX idx_entries_parent_id ON entries(parent_id);

UPDATE entries
SET tombstone = CASE
  WHEN EXISTS (
    SELECT 1 FROM library_entries membership
    WHERE membership.entry_id = entries.id AND membership.tombstone = 0
  ) THEN 0
  ELSE 1
END;

DROP TABLE IF EXISTS entry_fts;
CREATE VIRTUAL TABLE entry_fts USING fts5(
  name,
  stem,
  parent_path,
  rel_path,
  content='entries',
  content_rowid='rowid'
);
CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entry_fts(rowid, name, stem, parent_path, rel_path)
  VALUES (new.rowid, new.name, new.stem, new.parent_path, new.rel_path);
END;
CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entry_fts(entry_fts, rowid, name, stem, parent_path, rel_path)
  VALUES ('delete', old.rowid, old.name, old.stem, old.parent_path, old.rel_path);
END;
CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entry_fts(entry_fts, rowid, name, stem, parent_path, rel_path)
  VALUES ('delete', old.rowid, old.name, old.stem, old.parent_path, old.rel_path);
  INSERT INTO entry_fts(rowid, name, stem, parent_path, rel_path)
  VALUES (new.rowid, new.name, new.stem, new.parent_path, new.rel_path);
END;

INSERT INTO entry_fts(entry_fts)
VALUES ('rebuild');

DROP TABLE _entry_path_map_v3;
`,
  },
  {
    version: 4,
    sql: `
CREATE INDEX IF NOT EXISTS idx_library_entries_active
  ON library_entries(library_id, tombstone, entry_id);
CREATE INDEX IF NOT EXISTS idx_entries_parent_active_name
  ON entries(parent_id, tombstone, name COLLATE NOCASE, id);

CREATE TABLE IF NOT EXISTS sync_state (
  library_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0,
  last_event_id INTEGER,
  last_reconcile_at INTEGER,
  last_success_at INTEGER,
  watcher_state TEXT NOT NULL DEFAULT 'starting',
  dirty INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS change_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  old_path TEXT,
  observed_at INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_change_queue_pending
  ON change_queue(status, library_id, id);
CREATE INDEX IF NOT EXISTS idx_change_queue_path
  ON change_queue(library_id, path, status);
CREATE TABLE IF NOT EXISTS search_index_state (
  name TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  version INTEGER NOT NULL DEFAULT 2,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO search_index_state(name, generation, status, version, updated_at)
VALUES ('sqlite', 0, 'ready', 2, unixepoch('now') * 1000);
`,
  },
  {
    version: 5,
    sql: `
CREATE INDEX IF NOT EXISTS idx_entries_active_name
  ON entries(tombstone, name COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS idx_entries_active_ext_name
  ON entries(tombstone, ext, name COLLATE NOCASE, id);
`,
  },
  {
    version: 6,
    sql: `
CREATE INDEX IF NOT EXISTS idx_entries_parent_path_active_name
  ON entries(
    replace(coalesce(parent_path, ''), '\\', '/'),
    tombstone,
    name COLLATE NOCASE,
    id
  );
`,
  },
  {
    version: 7,
    sql: `
CREATE INDEX IF NOT EXISTS idx_name_trigrams_gram_entry
  ON name_trigrams(gram, entry_id);
DROP INDEX IF EXISTS idx_name_trigrams_gram;
`,
  },
];

function hasMigrationsTable(db: DatabaseSync): boolean {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get() as { name: string } | undefined;
  return row != null;
}

export function getSchemaVersion(db: DatabaseSync): number {
  if (!hasMigrationsTable(db)) {
    return 0;
  }
  const row = db.prepare(`SELECT MAX(version) AS version FROM schema_migrations`).get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

export function applyMigrations(db: DatabaseSync, log?: DatabaseLogFunction): number {
  const migrationsTableStartedAt = Date.now();
  log?.("db.migrations.table.start");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  log?.("db.migrations.table.finished", {
    elapsedMs: Date.now() - migrationsTableStartedAt,
  });

  const initialVersion = getSchemaVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.version > initialVersion).sort(
    (a, b) => a.version - b.version,
  );
  log?.("db.migrations.pending", {
    currentVersion: initialVersion,
    targetVersion: CURRENT_SCHEMA_VERSION,
    pendingVersions: pending.map((migration) => migration.version),
  });

  for (const migration of pending) {
    const migrationStartedAt = Date.now();
    log?.("db.migration.start", {
      version: migration.version,
      sqlBytes: migration.sql.length,
    });
    log?.("db.migration.transaction.start", { version: migration.version });
    db.exec("BEGIN IMMEDIATE");
    log?.("db.migration.transaction.acquired", { version: migration.version });
    try {
      const sqlStartedAt = Date.now();
      db.exec(migration.sql);
      log?.("db.migration.sql.finished", {
        version: migration.version,
        elapsedMs: Date.now() - sqlStartedAt,
      });
      const recordStartedAt = Date.now();
      db.prepare(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)`).run(
        migration.version,
        Date.now(),
      );
      log?.("db.migration.record.finished", {
        version: migration.version,
        elapsedMs: Date.now() - recordStartedAt,
      });
      log?.("db.migration.commit.start", { version: migration.version });
      db.exec("COMMIT");
      log?.("db.migration.commit.finished", { version: migration.version });
      log?.("db.migration.finished", {
        version: migration.version,
        elapsedMs: Date.now() - migrationStartedAt,
      });
    } catch (error) {
      log?.("db.migration.rollback.start", {
        version: migration.version,
        message: error instanceof Error ? error.message : String(error),
      });
      db.exec("ROLLBACK");
      log?.("db.migration.rollback.finished", { version: migration.version });
      throw error;
    }
  }

  const finalVersion = getSchemaVersion(db);
  log?.("db.migrations.finished", { finalVersion });
  return finalVersion;
}
