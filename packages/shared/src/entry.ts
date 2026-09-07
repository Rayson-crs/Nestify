import type { EntryId, LibraryId } from './ids.ts';

export const ENTRY_KINDS = [
  'file',
  'dir',
  'image',
  'video',
  'audio',
  'archive',
  'subtitle',
  'document',
  'installer',
  'unknown',
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

export const STORAGE_PROTOCOLS = ['local', 'smb', 'usb'] as const;
export type StorageProtocol = (typeof STORAGE_PROTOCOLS)[number];

export interface Entry {
  id: EntryId;
  libraryId: LibraryId;
  parentId: EntryId | null;
  name: string;
  stem: string;
  /** Extension including leading dot; empty for directories. */
  ext: string;
  isDir: boolean;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
  ctime: number;
  atime: number;
  /** JSON-safe inode/device identity. */
  ino: string | null;
  dev: string | null;
  depth: number;
  kind: EntryKind;
  protocol: StorageProtocol;
  mime: string | null;
  path: string;
  parentPath: string | null;
  relPath: string;
  hashQuick: string | null;
  hashFull: string | null;
  childCount: number;
  fileCount: number;
  dirCount: number;
  tombstone: boolean;
  seenAt: number;
  indexedAt: number | null;
}
