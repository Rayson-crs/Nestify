import type { DatabaseSync } from "node:sqlite";
import { eq, isNull, sql } from "drizzle-orm";
import { allOrm, getOrm, orm, runOrm } from "../db/orm.ts";
import { entries, thumbnails } from "../db/schema.ts";

export interface ThumbnailCacheRecord {
  entryId: string;
  cacheKey: string;
  path: string;
  width: number;
  height: number;
  generatedAt: number;
}

type ThumbnailRow = typeof thumbnails.$inferSelect;

export function getThumbnailCache(
  db: DatabaseSync,
  entryId: string,
): ThumbnailCacheRecord | undefined {
  const row = getOrm<ThumbnailRow>(
    db,
    orm()
      .select({
        entryId: sql`${thumbnails.entryId}`.as("entryId"),
        cacheKey: sql`${thumbnails.cacheKey}`.as("cacheKey"),
        path: sql`${thumbnails.path}`.as("path"),
        width: sql`${thumbnails.width}`.as("width"),
        height: sql`${thumbnails.height}`.as("height"),
        generatedAt: sql`${thumbnails.generatedAt}`.as("generatedAt"),
      })
      .from(thumbnails)
      .where(eq(thumbnails.entryId, entryId)),
  );
  if (!row) return undefined;

  return {
    entryId: row.entryId,
    cacheKey: row.cacheKey,
    path: row.path,
    width: row.width ?? 0,
    height: row.height ?? 0,
    generatedAt: row.generatedAt,
  };
}

export function listOrphanThumbnailCaches(db: DatabaseSync): ThumbnailCacheRecord[] {
  const rows = allOrm<ThumbnailRow>(
    db,
    orm()
      .select({
        entryId: sql`${thumbnails.entryId}`.as("entryId"),
        cacheKey: sql`${thumbnails.cacheKey}`.as("cacheKey"),
        path: sql`${thumbnails.path}`.as("path"),
        width: sql`${thumbnails.width}`.as("width"),
        height: sql`${thumbnails.height}`.as("height"),
        generatedAt: sql`${thumbnails.generatedAt}`.as("generatedAt"),
      })
      .from(thumbnails)
      .leftJoin(entries, eq(thumbnails.entryId, entries.id))
      .where(isNull(entries.id)),
  );

  return rows.map((row) => ({
    entryId: row.entryId,
    cacheKey: row.cacheKey,
    path: row.path,
    width: row.width ?? 0,
    height: row.height ?? 0,
    generatedAt: row.generatedAt,
  }));
}

export function saveThumbnailCache(db: DatabaseSync, record: ThumbnailCacheRecord): void {
  runOrm(
    db,
    orm()
      .insert(thumbnails)
      .values({
        entryId: record.entryId,
        cacheKey: record.cacheKey,
        path: record.path,
        width: record.width,
        height: record.height,
        generatedAt: record.generatedAt,
      })
      .onConflictDoUpdate({
        target: thumbnails.entryId,
        set: {
          cacheKey: sql`excluded.cache_key`,
          path: sql`excluded.path`,
          width: sql`excluded.width`,
          height: sql`excluded.height`,
          generatedAt: sql`excluded.generated_at`,
        },
      }),
  );
}

export function deleteThumbnailCache(db: DatabaseSync, entryId: string): void {
  runOrm(db, orm().delete(thumbnails).where(eq(thumbnails.entryId, entryId)));
}
