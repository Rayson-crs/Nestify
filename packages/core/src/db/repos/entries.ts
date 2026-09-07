import type { DatabaseSync } from "node:sqlite";
import type { Entry } from "@nestify/shared";
import { mapEntryRow, mapEntryToRow, type EntryRow } from "./map.ts";

export { createLibrary, getLibrary } from "./libraries.ts";

export function getEntryByPath(
  db: DatabaseSync,
  libraryId: string,
  path: string,
): Entry | undefined {
  const row = db
    .prepare(`SELECT * FROM entries WHERE library_id = ? AND path = ?`)
    .get(libraryId, path) as EntryRow | undefined;
  return row ? mapEntryRow(row) : undefined;
}

export function getEntryById(db: DatabaseSync, id: string): Entry | undefined {
  const row = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(id) as EntryRow | undefined;
  return row ? mapEntryRow(row) : undefined;
}

export function upsertEntry(db: DatabaseSync, entry: Entry): void {
  const row = mapEntryToRow(entry);
  db.prepare(
    `INSERT INTO entries(
      id, library_id, parent_id, name, stem, ext, is_dir, size,
      mtime, ctime, atime, ino, dev, depth, kind, protocol, mime,
      path, parent_path, rel_path, hash_quick, hash_full,
      child_count, file_count, dir_count, tombstone, seen_at, indexed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(library_id, path) DO UPDATE SET
      parent_id = excluded.parent_id,
      name = excluded.name,
      stem = excluded.stem,
      ext = excluded.ext,
      is_dir = excluded.is_dir,
      size = excluded.size,
      mtime = excluded.mtime,
      ctime = excluded.ctime,
      atime = excluded.atime,
      ino = excluded.ino,
      dev = excluded.dev,
      depth = excluded.depth,
      kind = excluded.kind,
      protocol = excluded.protocol,
      mime = excluded.mime,
      parent_path = excluded.parent_path,
      rel_path = excluded.rel_path,
      hash_quick = excluded.hash_quick,
      hash_full = excluded.hash_full,
      child_count = excluded.child_count,
      file_count = excluded.file_count,
      dir_count = excluded.dir_count,
      tombstone = excluded.tombstone,
      seen_at = excluded.seen_at,
      indexed_at = excluded.indexed_at`,
  ).run(
    row.id,
    row.library_id,
    row.parent_id,
    row.name,
    row.stem,
    row.ext,
    row.is_dir,
    row.size,
    row.mtime,
    row.ctime,
    row.atime,
    row.ino,
    row.dev,
    row.depth,
    row.kind,
    row.protocol,
    row.mime,
    row.path,
    row.parent_path,
    row.rel_path,
    row.hash_quick,
    row.hash_full,
    row.child_count,
    row.file_count,
    row.dir_count,
    row.tombstone,
    row.seen_at,
    row.indexed_at,
  );
}

export function markSeen(db: DatabaseSync, id: string, seenAt: number): void {
  db.prepare(`UPDATE entries SET seen_at = ?, tombstone = 0 WHERE id = ?`).run(seenAt, id);
}

export function tombstoneMissing(db: DatabaseSync, libraryId: string, seenAt: number): number {
  const result = db
    .prepare(
      `UPDATE entries
       SET tombstone = 1
       WHERE library_id = ? AND (seen_at IS NULL OR seen_at < ?)`,
    )
    .run(libraryId, seenAt);
  return Number(result.changes);
}

export function listChildren(db: DatabaseSync, parentId: string | null): Entry[] {
  const rows =
    parentId == null
      ? (db.prepare(`SELECT * FROM entries WHERE parent_id IS NULL ORDER BY name`).all() as EntryRow[])
      : (db
          .prepare(`SELECT * FROM entries WHERE parent_id = ? ORDER BY name`)
          .all(parentId) as EntryRow[]);
  return rows.map(mapEntryRow);
}

export function listEntries(
  db: DatabaseSync,
  libraryId: string,
  options: { includeTombstones?: boolean } = {},
): Entry[] {
  const rows = options.includeTombstones
    ? (db
        .prepare(
          `SELECT * FROM entries WHERE library_id = ? ORDER BY depth ASC, path ASC`,
        )
        .all(libraryId) as EntryRow[])
    : (db
        .prepare(
          `SELECT * FROM entries WHERE library_id = ? AND tombstone = 0 ORDER BY depth ASC, path ASC`,
        )
        .all(libraryId) as EntryRow[]);
  return rows.map(mapEntryRow);
}
export function countEntries(
  db: DatabaseSync,
  libraryId: string,
): { files: number; dirs: number } {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN is_dir = 0 THEN 1 ELSE 0 END), 0) AS files,
         COALESCE(SUM(CASE WHEN is_dir = 1 THEN 1 ELSE 0 END), 0) AS dirs
       FROM entries
       WHERE library_id = ? AND tombstone = 0`,
    )
    .get(libraryId) as { files: number; dirs: number };
  return { files: Number(row.files), dirs: Number(row.dirs) };
}

export function replaceTrigrams(db: DatabaseSync, entryId: string, grams: string[]): void {
  db.prepare(`DELETE FROM name_trigrams WHERE entry_id = ?`).run(entryId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO name_trigrams(entry_id, gram) VALUES (?, ?)`,
  );
  for (const gram of grams) {
    insert.run(entryId, gram);
  }
}
