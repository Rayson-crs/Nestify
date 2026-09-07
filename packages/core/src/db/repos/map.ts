import type {
  Entry,
  EntryKind,
  HashStrategy,
  Library,
  MediaStrategy,
  PreviewStrategy,
  StorageProtocol,
} from "@nestify/shared";
import { asEntryId, asLibraryId } from "@nestify/shared";

export type LibraryRow = {
  id: string;
  name: string;
  roots_json: string;
  exclude_globs_json: string;
  max_depth: number | null;
  follow_symlinks: number;
  scan_hidden: number;
  hash_strategy: string;
  media_strategy: string;
  preview_strategy: string;
  created_at: number;
  updated_at: number;
};

export type EntryRow = {
  id: string;
  library_id: string;
  parent_id: string | null;
  name: string;
  stem: string;
  ext: string;
  is_dir: number;
  size: number;
  mtime: number | null;
  ctime: number | null;
  atime: number | null;
  ino: string | null;
  dev: string | null;
  depth: number;
  kind: string;
  protocol: string;
  mime: string | null;
  path: string;
  parent_path: string | null;
  rel_path: string;
  hash_quick: string | null;
  hash_full: string | null;
  child_count: number | null;
  file_count: number | null;
  dir_count: number | null;
  tombstone: number;
  seen_at: number | null;
  indexed_at: number | null;
};

export function sqlBool(value: boolean | null | undefined, fallback = false): number {
  return (value ?? fallback) ? 1 : 0;
}

export function fromSqlBool(value: number | null | undefined): boolean {
  return value === 1;
}

export function parseJsonStringArray(value: string | null | undefined): string[] {
  if (value == null || value === "") return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => String(item));
}

/** DB may store `mkv` or `.mkv`; Entry.ext always has a leading dot, or '' for dirs. */
export function normalizeExt(ext: string | null | undefined, isDir: boolean): string {
  if (isDir) return "";
  if (ext == null || ext === "") return "";
  return ext.startsWith(".") ? ext : `.${ext}`;
}

export function mapLibraryRow(row: LibraryRow): Library {
  return {
    id: asLibraryId(row.id),
    name: row.name,
    roots: parseJsonStringArray(row.roots_json),
    excludeGlobs: parseJsonStringArray(row.exclude_globs_json),
    maxDepth: row.max_depth,
    followSymlinks: fromSqlBool(row.follow_symlinks),
    scanHidden: fromSqlBool(row.scan_hidden),
    hashStrategy: row.hash_strategy as HashStrategy,
    mediaStrategy: row.media_strategy as MediaStrategy,
    previewStrategy: row.preview_strategy as PreviewStrategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEntryRow(row: EntryRow): Entry {
  const isDir = fromSqlBool(row.is_dir);
  return {
    id: asEntryId(row.id),
    libraryId: asLibraryId(row.library_id),
    parentId: row.parent_id == null ? null : asEntryId(row.parent_id),
    name: row.name,
    stem: row.stem,
    ext: normalizeExt(row.ext, isDir),
    isDir,
    size: row.size,
    mtime: row.mtime ?? 0,
    ctime: row.ctime ?? 0,
    atime: row.atime ?? 0,
    ino: row.ino,
    dev: row.dev,
    depth: row.depth,
    kind: row.kind as EntryKind,
    protocol: row.protocol as StorageProtocol,
    mime: row.mime,
    path: row.path,
    parentPath: row.parent_path,
    relPath: row.rel_path,
    hashQuick: row.hash_quick,
    hashFull: row.hash_full,
    childCount: row.child_count ?? 0,
    fileCount: row.file_count ?? 0,
    dirCount: row.dir_count ?? 0,
    tombstone: fromSqlBool(row.tombstone),
    seenAt: row.seen_at ?? 0,
    indexedAt: row.indexed_at,
  };
}

export function mapEntryToRow(entry: Entry): EntryRow {
  return {
    id: entry.id,
    library_id: entry.libraryId,
    parent_id: entry.parentId,
    name: entry.name,
    stem: entry.stem,
    ext: entry.ext,
    is_dir: sqlBool(entry.isDir),
    size: entry.size,
    mtime: entry.mtime,
    ctime: entry.ctime,
    atime: entry.atime,
    ino: entry.ino,
    dev: entry.dev,
    depth: entry.depth,
    kind: entry.kind,
    protocol: entry.protocol,
    mime: entry.mime,
    path: entry.path,
    parent_path: entry.parentPath,
    rel_path: entry.relPath,
    hash_quick: entry.hashQuick,
    hash_full: entry.hashFull,
    child_count: entry.childCount,
    file_count: entry.fileCount,
    dir_count: entry.dirCount,
    tombstone: sqlBool(entry.tombstone),
    seen_at: entry.seenAt,
    indexed_at: entry.indexedAt,
  };
}

export const libraryFromRow = mapLibraryRow;
export const entryFromRow = mapEntryRow;
export const entryToParams = mapEntryToRow;
