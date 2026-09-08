import type { DatabaseSync } from "node:sqlite";

export interface ThumbnailCacheRecord {
  entryId: string;
  cacheKey: string;
  path: string;
  width: number;
  height: number;
  generatedAt: number;
}

type ThumbnailRow = {
  entry_id: string;
  cache_key: string;
  path: string;
  width: number | null;
  height: number | null;
  generated_at: number;
};

export function getThumbnailCache(
  db: DatabaseSync,
  entryId: string,
): ThumbnailCacheRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM thumbnails WHERE entry_id = ?`)
    .get(entryId) as ThumbnailRow | undefined;
  if (!row) return undefined;

  return {
    entryId: row.entry_id,
    cacheKey: row.cache_key,
    path: row.path,
    width: row.width ?? 0,
    height: row.height ?? 0,
    generatedAt: row.generated_at,
  };
}

export function saveThumbnailCache(db: DatabaseSync, record: ThumbnailCacheRecord): void {
  db.prepare(
    `INSERT INTO thumbnails(entry_id, cache_key, path, width, height, generated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(entry_id) DO UPDATE SET
       cache_key = excluded.cache_key,
       path = excluded.path,
       width = excluded.width,
       height = excluded.height,
       generated_at = excluded.generated_at`,
  ).run(
    record.entryId,
    record.cacheKey,
    record.path,
    record.width,
    record.height,
    record.generatedAt,
  );
}

export function deleteThumbnailCache(db: DatabaseSync, entryId: string): void {
  db.prepare(`DELETE FROM thumbnails WHERE entry_id = ?`).run(entryId);
}
