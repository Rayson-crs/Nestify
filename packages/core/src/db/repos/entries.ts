import type { DatabaseSync } from "node:sqlite";
import type { Entry } from "@nestify/shared";
import { and, asc, eq, getTableColumns, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { allOrm, getOrm, orm, runOrm, withOrmTransaction } from "../orm.ts";
import { entries, libraryEntries, nameTrigrams } from "../schema.ts";
import { mapEntryRow, mapEntryToRow, type EntryRow } from "./map.ts";
import { gramsForName } from "../../search/trigram.ts";
import { normalizeScanPath } from "../../fs/path.ts";

export { createLibrary, getLibrary } from "./libraries.ts";

export function getEntryByPath(
  db: DatabaseSync,
  _libraryId: string,
  path: string,
): Entry | undefined {
  const row = getOrm<EntryRow>(
    db,
    orm()
      .select()
      .from(entries)
      .where(eq(entries.path, path)),
  );
  return row ? mapEntryRow(row) : undefined;
}

export function getEntryById(db: DatabaseSync, id: string): Entry | undefined {
  const row = getOrm<EntryRow>(db, orm().select().from(entries).where(eq(entries.id, id)));
  return row ? mapEntryRow(row) : undefined;
}

export function upsertEntry(db: DatabaseSync, entry: Entry): void {
  const [row] = upsertEntriesBatch(db, [entry]);
  if (!row) throw new Error(`failed to upsert entry: ${entry.path}`);
}

function entryValues(row: EntryRow) {
  return {
    id: row.id,
    libraryId: row.library_id,
    parentId: row.parent_id,
    name: row.name,
    stem: row.stem,
    ext: row.ext,
    isDir: row.is_dir,
    size: row.size,
    mtime: row.mtime,
    ctime: row.ctime,
    atime: row.atime,
    ino: row.ino,
    dev: row.dev,
    depth: row.depth,
    kind: row.kind,
    protocol: row.protocol,
    mime: row.mime,
    path: row.path,
    parentPath: row.parent_path,
    relPath: row.rel_path,
    hashQuick: row.hash_quick,
    hashFull: row.hash_full,
    childCount: row.child_count,
    fileCount: row.file_count,
    dirCount: row.dir_count,
    tombstone: row.tombstone,
    seenAt: row.seen_at,
    indexedAt: row.indexed_at,
  };
}

const entryUpdate = {
  // Do not update library_id on a path conflict. A canonical entry can belong
  // to several overlapping libraries and ownership must remain stable.
  parentId: sql`excluded.parent_id`,
  name: sql`excluded.name`,
  stem: sql`excluded.stem`,
  ext: sql`excluded.ext`,
  isDir: sql`excluded.is_dir`,
  size: sql`excluded.size`,
  mtime: sql`excluded.mtime`,
  ctime: sql`excluded.ctime`,
  atime: sql`excluded.atime`,
  ino: sql`excluded.ino`,
  dev: sql`excluded.dev`,
  depth: sql`excluded.depth`,
  kind: sql`excluded.kind`,
  protocol: sql`excluded.protocol`,
  mime: sql`excluded.mime`,
  parentPath: sql`excluded.parent_path`,
  relPath: sql`excluded.rel_path`,
  hashQuick: sql`excluded.hash_quick`,
  hashFull: sql`excluded.hash_full`,
  childCount: sql`excluded.child_count`,
  fileCount: sql`excluded.file_count`,
  dirCount: sql`excluded.dir_count`,
  tombstone: sql`excluded.tombstone`,
  seenAt: sql`excluded.seen_at`,
  indexedAt: sql`excluded.indexed_at`,
};

export function upsertEntriesBatch(db: DatabaseSync, input: readonly Entry[]): EntryRow[] {
  if (input.length === 0) return [];
  const inputRows = input.map(mapEntryToRow);
  // A concurrent scan can return the same path from overlapping roots. Keep
  // one row per canonical path so SQLite never updates the same key twice in
  // one INSERT statement.
  const uniquePaths = new Map<string, EntryRow>();
  for (const row of inputRows) {
    uniquePaths.set(row.path, row);
  }
  const rows = [...uniquePaths.values()];
  const parentPaths = rows
    .map((row) => row.parent_path)
    .filter((path): path is string => path != null && path !== "");
  const lookupPaths = [...new Set([...rows.map((row) => row.path), ...parentPaths])];
  const existing = allOrm<{ id: string; path: string }>(
    db,
    orm().select({ id: entries.id, path: entries.path }).from(entries).where(inArray(entries.path, lookupPaths)),
  );
  const ids = new Map(existing.map((row) => [row.path, row.id]));
  for (const row of rows) {
    ids.set(row.path, ids.get(row.path) ?? row.id);
  }
  // Resolve parent ids by path, rather than trusting the id supplied by the
  // walker. This handles out-of-order worker results and migrated databases
  // where a path may already have a different canonical id.
  const resolvedRows = rows
    .map((row): EntryRow => ({
      ...row,
      id: ids.get(row.path) ?? row.id,
      parent_id: row.parent_path == null
        ? null
        : ids.get(row.parent_path) ?? row.parent_id,
    }))
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const values = resolvedRows.map(entryValues);
  withOrmTransaction(db, () => {
    runOrm(db, orm().insert(entries).values(values).onConflictDoUpdate({ target: entries.path, set: entryUpdate }));
    runOrm(db, orm().insert(libraryEntries).values(values.map((row) => ({
      entryId: row.id,
      libraryId: row.libraryId,
      relPath: row.relPath,
      seenAt: row.seenAt ?? 0,
      tombstone: row.tombstone,
    }))).onConflictDoUpdate({
      target: [libraryEntries.entryId, libraryEntries.libraryId],
      set: { relPath: sql`excluded.rel_path`, seenAt: sql`excluded.seen_at`, tombstone: sql`excluded.tombstone` },
    }));
    const grams = values.flatMap((row) => gramsForNameWithId(row.id, row.name));
    if (grams.length > 0) {
      runOrm(db, orm().delete(nameTrigrams).where(inArray(nameTrigrams.entryId, values.map((row) => row.id))));
      runOrm(db, orm().insert(nameTrigrams).values(grams).onConflictDoNothing());
    }
  });
  return resolvedRows;
}

export function markSeenBatch(db: DatabaseSync, items: readonly { id: string; libraryId: string; relPath?: string }[], seenAt: number): void {
  if (items.length === 0) return;
  withOrmTransaction(db, () => {
    const ids = items.map((item) => item.id);
    runOrm(db, orm().update(entries).set({ seenAt, tombstone: 0 }).where(inArray(entries.id, ids)));
    runOrm(db, orm().insert(libraryEntries).values(items.map((item) => ({
      entryId: item.id,
      libraryId: item.libraryId,
      relPath: item.relPath ?? "",
      seenAt,
      tombstone: 0,
    }))).onConflictDoUpdate({
      target: [libraryEntries.entryId, libraryEntries.libraryId],
      set: {
        seenAt: sql`excluded.seen_at`,
        relPath: sql`CASE WHEN excluded.rel_path = '' THEN library_entries.rel_path ELSE excluded.rel_path END`,
        tombstone: 0,
      },
    }));
  });
}

function gramsForNameWithId(entryId: string, name: string): Array<{ entryId: string; gram: string }> {
  return gramsForName(name).map((gram) => ({ entryId, gram }));
}

export function markSeen(
  db: DatabaseSync,
  id: string,
  seenAt: number,
  libraryId?: string,
  relPath?: string,
): void {
  runOrm(
    db,
    orm()
      .update(entries)
      .set({ seenAt, tombstone: 0 })
      .where(eq(entries.id, id)),
  );
  if (!libraryId) {
    runOrm(
      db,
      orm()
        .update(libraryEntries)
        .set({ seenAt, tombstone: 0 })
        .where(eq(libraryEntries.entryId, id)),
    );
    return;
  }
  runOrm(
    db,
    orm()
      .insert(libraryEntries)
      .values({ entryId: id, libraryId, relPath: relPath ?? "", seenAt, tombstone: 0 })
      .onConflictDoUpdate({
        target: [libraryEntries.entryId, libraryEntries.libraryId],
        set: {
          seenAt: sql`excluded.seen_at`,
          relPath: sql`CASE WHEN excluded.rel_path = '' THEN library_entries.rel_path ELSE excluded.rel_path END`,
          tombstone: 0,
        },
      }),
  );
}

export function tombstoneMissing(db: DatabaseSync, libraryId: string, seenAt: number): number {
  const result = runOrm(
    db,
    orm()
      .update(libraryEntries)
      .set({ tombstone: 1 })
      .where(
        and(
          eq(libraryEntries.libraryId, libraryId),
          or(isNull(libraryEntries.seenAt), lt(libraryEntries.seenAt, seenAt)),
        ),
      ),
  );
  runOrm(
    db,
    orm()
      .update(entries)
      .set({
        tombstone: sql`CASE WHEN EXISTS (
          SELECT 1 FROM library_entries membership
          WHERE membership.entry_id = ${entries.id} AND membership.tombstone = 0
        ) THEN 0 ELSE 1 END`,
      }),
  );
  return Number(result.changes);
}

export function tombstoneMissingUnderPath(
  db: DatabaseSync,
  libraryId: string,
  path: string,
  seenAt: number,
): number {
  const normalized = normalizeScanPath(path);
  const separator = normalized.includes("\\") ? "\\" : "/";
  const pattern = childPathLikePattern(normalized, separator);
  const result = db.prepare(
    `UPDATE library_entries
     SET tombstone = 1
     WHERE library_id = ?
       AND (entry_id IN (
         SELECT id FROM entries
         WHERE path = ? OR path LIKE ? ESCAPE '\\'
       ))
       AND (seen_at IS NULL OR seen_at < ?)`,
    ).run(libraryId, normalized, pattern, seenAt);
  db.prepare(
    `UPDATE entries
     SET tombstone = CASE WHEN EXISTS (
       SELECT 1 FROM library_entries membership
       WHERE membership.entry_id = entries.id AND membership.tombstone = 0
     ) THEN 0 ELSE 1 END
     WHERE id IN (
       SELECT id FROM entries WHERE path = ? OR path LIKE ? ESCAPE '\\'
     )`,
    ).run(normalized, pattern);
  return Number(result.changes);
}

function childPathLikePattern(path: string, separator: string): string {
  return `${escapeLike(path)}${escapeLike(separator)}%`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function listChildren(db: DatabaseSync, parentId: string | null): Entry[] {
  const rows = allOrm<EntryRow>(
    db,
    orm()
      .select()
      .from(entries)
      .where(parentId == null ? isNull(entries.parentId) : eq(entries.parentId, parentId))
      .orderBy(asc(entries.name)),
  );
  return rows.map(mapEntryRow);
}

export function listEntries(
  db: DatabaseSync,
  libraryId: string,
  options: { includeTombstones?: boolean } = {},
): Entry[] {
  const rows = allOrm<EntryRow>(
    db,
    orm()
      .select({ ...getTableColumns(entries), rel_path: libraryEntries.relPath })
      .from(entries)
      .innerJoin(libraryEntries, eq(libraryEntries.entryId, entries.id))
      .where(
        and(
          eq(libraryEntries.libraryId, libraryId),
          options.includeTombstones ? undefined : eq(libraryEntries.tombstone, 0),
        ),
      )
      .orderBy(asc(entries.depth), asc(entries.path)),
  );
  return rows.map(mapEntryRow);
}
export function countEntries(
  db: DatabaseSync,
  libraryId: string,
): { files: number; dirs: number } {
  const row = getOrm<{ files: number; dirs: number }>(
    db,
    orm()
      .select({
        files: sql<number>`coalesce(sum(case when ${entries.isDir} = 0 then 1 else 0 end), 0) as files`,
        dirs: sql<number>`coalesce(sum(case when ${entries.isDir} = 1 then 1 else 0 end), 0) as dirs`,
      })
      .from(entries)
      .innerJoin(libraryEntries, eq(libraryEntries.entryId, entries.id))
      .where(and(eq(libraryEntries.libraryId, libraryId), eq(libraryEntries.tombstone, 0))),
  );
  return { files: Number(row?.files ?? 0), dirs: Number(row?.dirs ?? 0) };
}

export function entryBelongsToLibrary(
  db: DatabaseSync,
  entryId: string,
  libraryId: string,
): boolean {
  return (
    getOrm<{ entryId: string }>(
      db,
      orm()
        .select({ entryId: libraryEntries.entryId })
        .from(libraryEntries)
        .where(
          and(eq(libraryEntries.entryId, entryId), eq(libraryEntries.libraryId, libraryId)),
        ),
    ) != null
  );
}

export function membershipLibraryIdFor(
  db: DatabaseSync,
  entryId: string,
  preferredLibraryId?: string,
): string | undefined {
  const memberships = allOrm<{ libraryId: string }>(
    db,
    orm()
      .select({ libraryId: sql<string>`${libraryEntries.libraryId}`.as("libraryId") })
      .from(libraryEntries)
      .where(eq(libraryEntries.entryId, entryId)),
  );
  return (
    memberships.find((item) => item.libraryId === preferredLibraryId)?.libraryId ??
    memberships[0]?.libraryId
  );
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
