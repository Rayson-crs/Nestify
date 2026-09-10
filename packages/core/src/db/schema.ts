import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const schemaMigrations = sqliteTable("schema_migrations", {
  version: integer("version").primaryKey(),
  appliedAt: integer("applied_at").notNull(),
});

export const libraries = sqliteTable("libraries", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootsJson: text("roots_json").notNull(),
  excludeGlobsJson: text("exclude_globs_json").notNull().default("[]"),
  maxDepth: integer("max_depth"),
  followSymlinks: integer("follow_symlinks").notNull().default(0),
  scanHidden: integer("scan_hidden").notNull().default(0),
  hashStrategy: text("hash_strategy").notNull().default("duplicate-candidate-only"),
  mediaStrategy: text("media_strategy").notNull().default("off"),
  previewStrategy: text("preview_strategy").notNull().default("standard"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => entries.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    stem: text("stem").notNull(),
    ext: text("ext").notNull(),
    isDir: integer("is_dir").notNull(),
    size: integer("size").notNull().default(0),
    mtime: integer("mtime"),
    ctime: integer("ctime"),
    atime: integer("atime"),
    ino: text("ino"),
    dev: text("dev"),
    depth: integer("depth").notNull().default(0),
    kind: text("kind").notNull(),
    protocol: text("protocol").notNull().default("local"),
    mime: text("mime"),
    path: text("path").notNull(),
    parentPath: text("parent_path"),
    relPath: text("rel_path").notNull(),
    hashQuick: text("hash_quick"),
    hashFull: text("hash_full"),
    childCount: integer("child_count"),
    fileCount: integer("file_count"),
    dirCount: integer("dir_count"),
    tombstone: integer("tombstone").notNull().default(0),
    seenAt: integer("seen_at"),
    indexedAt: integer("indexed_at"),
  },
  (table) => [
    unique("entries_path_unique").on(table.path),
    index("idx_entries_library_name").on(table.libraryId, table.name),
    index("idx_entries_library_ext").on(table.libraryId, table.ext),
    index("idx_entries_library_size").on(table.libraryId, table.size),
    index("idx_entries_library_mtime").on(table.libraryId, table.mtime),
    index("idx_entries_library_kind").on(table.libraryId, table.kind),
    index("idx_entries_hash_quick").on(table.hashQuick),
    index("idx_entries_hash_full").on(table.hashFull),
    index("idx_entries_parent_id").on(table.parentId),
    index("idx_entries_parent_path_active_name").on(
      sql`replace(coalesce(${table.parentPath}, ''), '\\', '/')`,
      table.tombstone,
      sql`${table.name} COLLATE NOCASE`,
      table.id,
    ),
    index("idx_entries_active_name").on(table.tombstone, table.name, table.id),
    index("idx_entries_active_ext_name").on(table.tombstone, table.ext, table.name, table.id),
  ],
);

export const libraryEntries = sqliteTable(
  "library_entries",
  {
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    relPath: text("rel_path").notNull(),
    seenAt: integer("seen_at").notNull(),
    tombstone: integer("tombstone").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.libraryId] }),
    index("idx_library_entries_library").on(table.libraryId),
    index("idx_library_entries_entry").on(table.entryId),
    index("idx_library_entries_active").on(table.libraryId, table.tombstone, table.entryId),
  ],
);

export const syncState = sqliteTable("sync_state", {
  libraryId: text("library_id").primaryKey(),
  generation: integer("generation").notNull().default(0),
  lastEventId: integer("last_event_id"),
  lastReconcileAt: integer("last_reconcile_at"),
  lastSuccessAt: integer("last_success_at"),
  watcherState: text("watcher_state").notNull().default("starting"),
  dirty: integer("dirty").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const changeQueue = sqliteTable(
  "change_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    libraryId: text("library_id").notNull(),
    eventType: text("event_type").notNull(),
    path: text("path").notNull(),
    oldPath: text("old_path"),
    observedAt: integer("observed_at").notNull(),
    generation: integer("generation").notNull(),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    lastError: text("last_error"),
    processedAt: integer("processed_at"),
  },
  (table) => [
    index("idx_change_queue_pending").on(table.status, table.libraryId, table.id),
    index("idx_change_queue_path").on(table.libraryId, table.path, table.status),
  ],
);

export const searchIndexState = sqliteTable("search_index_state", {
  name: text("name").primaryKey(),
  generation: integer("generation").notNull().default(0),
  status: text("status").notNull().default("ready"),
  version: integer("version").notNull().default(2),
  updatedAt: integer("updated_at").notNull(),
});

export const signals = sqliteTable("signals", {
  entryId: text("entry_id")
    .primaryKey()
    .references(() => entries.id, { onDelete: "cascade" }),
  json: text("json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const nameTrigrams = sqliteTable(
  "name_trigrams",
  {
    entryId: text("entry_id").notNull(),
    gram: text("gram").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.gram] }),
    index("idx_name_trigrams_gram_entry").on(table.gram, table.entryId),
  ],
);

export const scanCursors = sqliteTable("scan_cursors", {
  libraryId: text("library_id").primaryKey(),
  cursorJson: text("cursor_json"),
  updatedAt: integer("updated_at").notNull(),
});

export const duplicateGroups = sqliteTable("dup_groups", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull(),
  hashFull: text("hash_full"),
  hashQuick: text("hash_quick"),
  size: integer("size"),
  fileCount: integer("file_count"),
  wastedBytes: integer("wasted_bytes"),
  status: text("status").notNull().default("open"),
  createdAt: integer("created_at").notNull(),
});

export const duplicateMembers = sqliteTable(
  "dup_members",
  {
    groupId: text("group_id").notNull(),
    entryId: text("entry_id").notNull(),
    keep: integer("keep").notNull().default(0),
    reason: text("reason"),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.entryId] })],
);

export const ruleSets = sqliteTable("rulesets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  yaml: text("yaml").notNull(),
  builtin: integer("builtin").notNull().default(0),
  enabled: integer("enabled").notNull().default(1),
  priority: integer("priority").notNull().default(100),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(),
  ruleSetId: text("rule_set_id")
    .notNull()
    .references(() => ruleSets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: integer("enabled").notNull().default(1),
  priority: integer("priority").notNull(),
  yaml: text("yaml").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  libraryId: text("library_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  dryRun: integer("dry_run").notNull().default(1),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  error: text("error"),
  statsJson: text("stats_json"),
});

export const jobOps = sqliteTable("job_ops", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  op: text("op").notNull(),
  fromPath: text("from_path").notNull(),
  toPath: text("to_path"),
  ruleId: text("rule_id"),
  status: text("status").notNull(),
  risk: text("risk"),
  reason: text("reason"),
  error: text("error"),
});

export const thumbnails = sqliteTable("thumbnails", {
  entryId: text("entry_id").primaryKey(),
  cacheKey: text("cache_key").notNull(),
  path: text("path").notNull(),
  width: integer("width"),
  height: integer("height"),
  generatedAt: integer("generated_at").notNull(),
});
