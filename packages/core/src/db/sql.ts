/**
 * Nestify v1 SQLite schema.
 * `entry_fts` is an external-content FTS5 table (`content='entries'`) kept in
 * sync by triggers. `name_trigrams` is maintained by the indexer, not SQL.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  roots_json TEXT NOT NULL,
  exclude_globs_json TEXT NOT NULL DEFAULT '[]',
  max_depth INTEGER,
  follow_symlinks INTEGER NOT NULL DEFAULT 0,
  scan_hidden INTEGER NOT NULL DEFAULT 0,
  hash_strategy TEXT NOT NULL DEFAULT 'duplicate-candidate-only',
  media_strategy TEXT NOT NULL DEFAULT 'off',
  preview_strategy TEXT NOT NULL DEFAULT 'standard',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
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
  UNIQUE(library_id, path)
);

CREATE INDEX IF NOT EXISTS idx_entries_library_name ON entries(library_id, name);
CREATE INDEX IF NOT EXISTS idx_entries_library_ext ON entries(library_id, ext);
CREATE INDEX IF NOT EXISTS idx_entries_library_size ON entries(library_id, size);
CREATE INDEX IF NOT EXISTS idx_entries_library_mtime ON entries(library_id, mtime);
CREATE INDEX IF NOT EXISTS idx_entries_library_kind ON entries(library_id, kind);
CREATE INDEX IF NOT EXISTS idx_entries_hash_quick ON entries(hash_quick);
CREATE INDEX IF NOT EXISTS idx_entries_hash_full ON entries(hash_full);
CREATE INDEX IF NOT EXISTS idx_entries_parent_id ON entries(parent_id);
CREATE INDEX IF NOT EXISTS idx_entries_parent_active_name
  ON entries(parent_id, tombstone, name COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS idx_entries_parent_path_active_name
  ON entries(
    replace(coalesce(parent_path, ''), '\', '/'),
    tombstone,
    name COLLATE NOCASE,
    id
  );
CREATE INDEX IF NOT EXISTS idx_entries_active_name
  ON entries(tombstone, name COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS idx_entries_active_ext_name
  ON entries(tombstone, ext, name COLLATE NOCASE, id);

CREATE TABLE IF NOT EXISTS signals (
  entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts USING fts5(
  name,
  stem,
  parent_path,
  rel_path,
  content='entries',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entry_fts(rowid, name, stem, parent_path, rel_path)
  VALUES (new.rowid, new.name, new.stem, new.parent_path, new.rel_path);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entry_fts(entry_fts, rowid, name, stem, parent_path, rel_path)
  VALUES ('delete', old.rowid, old.name, old.stem, old.parent_path, old.rel_path);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entry_fts(entry_fts, rowid, name, stem, parent_path, rel_path)
  VALUES ('delete', old.rowid, old.name, old.stem, old.parent_path, old.rel_path);
  INSERT INTO entry_fts(rowid, name, stem, parent_path, rel_path)
  VALUES (new.rowid, new.name, new.stem, new.parent_path, new.rel_path);
END;

CREATE TABLE IF NOT EXISTS name_trigrams (
  entry_id TEXT NOT NULL,
  gram TEXT NOT NULL,
  PRIMARY KEY(entry_id, gram)
);

CREATE INDEX IF NOT EXISTS idx_name_trigrams_gram_entry
  ON name_trigrams(gram, entry_id);

CREATE TABLE IF NOT EXISTS scan_cursors (
  library_id TEXT PRIMARY KEY,
  cursor_json TEXT,
  updated_at INTEGER NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_change_queue_pending ON change_queue(status, library_id, id);
CREATE INDEX IF NOT EXISTS idx_change_queue_path ON change_queue(library_id, path, status);
CREATE TABLE IF NOT EXISTS search_index_state (
  name TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  version INTEGER NOT NULL DEFAULT 2,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dup_groups (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  hash_full TEXT,
  hash_quick TEXT,
  size INTEGER,
  file_count INTEGER,
  wasted_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dup_members (
  group_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  keep INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  PRIMARY KEY(group_id, entry_id)
);

CREATE TABLE IF NOT EXISTS rulesets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  yaml TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  ruleset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL,
  yaml TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  library_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT,
  stats_json TEXT
);

CREATE TABLE IF NOT EXISTS job_ops (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  op TEXT NOT NULL,
  from_path TEXT NOT NULL,
  to_path TEXT,
  rule_id TEXT,
  status TEXT NOT NULL,
  risk TEXT,
  reason TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS thumbnails (
  entry_id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL,
  path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  generated_at INTEGER NOT NULL
);
`.trim();
