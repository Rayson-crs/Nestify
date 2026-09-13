import type { DatabaseSync } from "node:sqlite";
import type { Entry } from "@nestify/shared";
import { and, asc, eq, getTableColumns, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { allOrm, getOrm, orm, runOrm, withOrmTransaction } from "../orm.ts";
import { entries, libraryEntries, nameTrigrams } from "../schema.ts";
import { mapEntryRow, mapEntryToRow, type EntryRow } from "./map.ts";
import { gramsForName } from "../../search/trigram.ts";
import {
  directoryNameOf,
  normalizeScanPath,
  parentScanPath,
  pathDepthOf,
  relPathUnderRoot,
  scanPathAliases,
} from "../../fs/path.ts";
import { entryIdFor } from "../../util/ids.ts";

// SQLite builds commonly allow 999 bound variables. Keep headroom for
// generated conflict expressions and use smaller chunks for every dynamic
// IN/VALUES statement in this repository.
const SQLITE_SAFE_VARIABLES = 900;

export { createLibrary, getLibrary } from "./libraries.ts";

export function getEntryByPath(
  db: DatabaseSync,
  libraryId: string,
  path: string,
): Entry | undefined {
  const aliases = scanPathAliases(path);
  const lookup = aliases.length > 0 ? aliases : [path];
  const row = getOrm<EntryRow>(
    db,
    orm()
      .select({ ...getTableColumns(entries) })
      .from(entries)
      .innerJoin(libraryEntries, eq(libraryEntries.entryId, entries.id))
      .where(
        and(
          inArray(entries.path, lookup),
          eq(libraryEntries.libraryId, libraryId),
        ),
      ),
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

function libraryRootFrom(row: EntryRow): string | null {
  const path = normalizeScanPath(row.path) || row.path;
  const rel = row.rel_path.replace(/\\/g, "/");
  if (!rel) return parentScanPath(path);
  const slashPath = path.replace(/\\/g, "/");
  const suffix = `/${rel}`;
  if (slashPath.toLowerCase().endsWith(suffix.toLowerCase())) {
    const rootSlash = slashPath.slice(0, slashPath.length - rel.length).replace(/\/+$/, "");
    if (/^[A-Za-z]:$/.test(rootSlash)) return `${rootSlash[0]}:\\`;
    return path.includes("\\") ? rootSlash.replace(/\//g, "\\") : rootSlash;
  }
  return parentScanPath(path);
}

function ancestorRelPath(row: EntryRow, ancestorPath: string): string {
  const root = libraryRootFrom(row);
  if (!root) return "";
  return relPathUnderRoot(ancestorPath, root);
}

function buildAncestorStub(source: EntryRow, path: string): EntryRow {
  const normalized = normalizeScanPath(path) || path;
  const name = directoryNameOf(normalized);
  return {
    ...source,
    id: entryIdFor(source.library_id, normalized),
    parent_id: null,
    name,
    stem: name,
    ext: "",
    is_dir: 1,
    size: 0,
    ino: null,
    dev: null,
    depth: pathDepthOf(normalized),
    kind: "dir",
    mime: null,
    path: normalized,
    parent_path: parentScanPath(normalized),
    rel_path: ancestorRelPath(source, normalized),
    hash_quick: null,
    hash_full: null,
    child_count: 0,
    file_count: 0,
    dir_count: 0,
    tombstone: 0,
  };
}

function hasPathAlias(map: Map<string, EntryRow>, path: string): boolean {
  return scanPathAliases(path).some((alias) => map.has(alias));
}

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
  const stubPaths = new Set<string>();
  for (const row of inputRows) {
    let current = row.parent_path ?? parentScanPath(row.path);
    while (current) {
      if (!hasPathAlias(uniquePaths, current)) {
        const stub = buildAncestorStub(row, current);
        uniquePaths.set(stub.path, stub);
        stubPaths.add(stub.path);
      }
      current = parentScanPath(current);
    }
  }
  const rows = [...uniquePaths.values()];
  const parentPaths = rows
    .map((row) => row.parent_path)
    .filter((path): path is string => path != null && path !== "");
  const lookupPaths = [...new Set(
    [...rows.map((row) => row.path), ...parentPaths].flatMap((path) => scanPathAliases(path)),
  )];
  const existing: Array<{ id: string; path: string }> = [];
  for (const paths of chunkByVariables(lookupPaths, 1)) {
    existing.push(...allOrm<{ id: string; path: string }>(
      db,
      orm()
        .select({ id: entries.id, path: entries.path })
        .from(entries)
        .where(inArray(entries.path, paths)),
    ));
  }
  const ids = new Map<string, string>();
  const remember = (path: string, id: string) => {
    ids.set(path, id);
    for (const alias of scanPathAliases(path)) ids.set(alias, id);
  };
  for (const row of existing) remember(row.path, row.id);
  for (const row of rows) remember(row.path, ids.get(row.path) ?? row.id);
  const existingAliases = new Set(existing.flatMap((row) => scanPathAliases(row.path)));
  const isExistingStub = (row: EntryRow): boolean =>
    stubPaths.has(row.path) && scanPathAliases(row.path).some((alias) => existingAliases.has(alias));
  // Resolve parent ids by path, rather than trusting the id supplied by the
  // walker. This handles out-of-order worker results and migrated databases
  // where a path may already have a different canonical id.
  const resolvedRows = rows
    .map((row): EntryRow => ({
      ...row,
      id: ids.get(row.path) ?? row.id,
      parent_id: row.parent_path == null
        ? null
        : ids.get(row.parent_path) ?? null,
    }))
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const persistRows = resolvedRows.filter((row) => !isExistingStub(row));
  const reviveRows = resolvedRows.filter(isExistingStub);
  const values = persistRows.map(entryValues);
  withOrmTransaction(db, () => {
    for (const valueChunk of chunkByVariables(values, Object.keys(values[0] ?? {}).length || 1)) {
      runOrm(db, orm().insert(entries).values(valueChunk).onConflictDoUpdate({ target: entries.path, set: entryUpdate }));
      const membershipValues = valueChunk.map((row) => ({
        entryId: row.id,
        libraryId: row.libraryId,
        relPath: row.relPath,
        seenAt: row.seenAt ?? 0,
        tombstone: row.tombstone,
      }));
      for (const membershipChunk of chunkByVariables(membershipValues, 5)) {
        runOrm(db, orm().insert(libraryEntries).values(membershipChunk).onConflictDoUpdate({
          target: [libraryEntries.entryId, libraryEntries.libraryId],
          set: { relPath: sql`excluded.rel_path`, seenAt: sql`excluded.seen_at`, tombstone: sql`excluded.tombstone` },
        }));
      }
      const idsForChunk = valueChunk.map((row) => row.id);
      for (const idChunk of chunkByVariables(idsForChunk, 1)) {
        runOrm(db, orm().delete(nameTrigrams).where(inArray(nameTrigrams.entryId, idChunk)));
      }
      const grams = valueChunk.flatMap((row) => gramsForNameWithId(row.id, row.name));
      for (const gramChunk of chunkByVariables(grams, 2)) {
        runOrm(db, orm().insert(nameTrigrams).values(gramChunk).onConflictDoNothing());
      }
    }
    if (reviveRows.length > 0) {
      const reviveIds = [...new Set(reviveRows.map((row) => row.id))];
      const seenAt = Math.max(...reviveRows.map((row) => row.seen_at ?? 0));
      for (const idChunk of chunkByVariables(reviveIds, 1)) {
        runOrm(db, orm().update(entries).set({ seenAt, tombstone: 0 }).where(inArray(entries.id, idChunk)));
      }
      const reviveMemberships = reviveRows.map((row) => ({
        entryId: row.id,
        libraryId: row.library_id,
        relPath: row.rel_path,
        seenAt: row.seen_at ?? seenAt,
        tombstone: 0,
      }));
      for (const membershipChunk of chunkByVariables(reviveMemberships, 5)) {
        runOrm(db, orm().insert(libraryEntries).values(membershipChunk).onConflictDoUpdate({
          target: [libraryEntries.entryId, libraryEntries.libraryId],
          set: {
            seenAt: sql`excluded.seen_at`,
            relPath: sql`CASE WHEN excluded.rel_path = '' THEN library_entries.rel_path ELSE excluded.rel_path END`,
            tombstone: 0,
          },
        }));
      }
    }
  });
  return resolvedRows;
}

export function markSeenBatch(db: DatabaseSync, items: readonly { id: string; libraryId: string; relPath?: string }[], seenAt: number): void {
  if (items.length === 0) return;
  withOrmTransaction(db, () => {
    for (const idChunk of chunkByVariables(items.map((item) => item.id), 1)) {
      runOrm(db, orm().update(entries).set({ seenAt, tombstone: 0 }).where(inArray(entries.id, idChunk)));
    }
    const memberships = items.map((item) => ({
      entryId: item.id,
      libraryId: item.libraryId,
      relPath: item.relPath ?? "",
      seenAt,
      tombstone: 0,
    }));
    for (const membershipChunk of chunkByVariables(memberships, 5)) {
      runOrm(db, orm().insert(libraryEntries).values(membershipChunk).onConflictDoUpdate({
        target: [libraryEntries.entryId, libraryEntries.libraryId],
        set: {
          seenAt: sql`excluded.seen_at`,
          relPath: sql`CASE WHEN excluded.rel_path = '' THEN library_entries.rel_path ELSE excluded.rel_path END`,
          tombstone: 0,
        },
      }));
    }
  });
}

function chunkByVariables<T>(items: readonly T[], variablesPerItem: number): T[][] {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.floor(SQLITE_SAFE_VARIABLES / Math.max(1, variablesPerItem)));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
