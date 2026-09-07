import type { EntryId, LibraryId } from './ids.ts';
import type { EntryKind } from './entry.ts';

export const PREVIEW_KINDS = ['thumbnail', 'poster', 'sprite', 'text'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

export interface ThumbnailRequest {
  libraryId: LibraryId;
  entryId: EntryId;
  size?: number;
}

export interface ThumbnailResult {
  entryId: EntryId;
  kind: EntryKind;
  cacheKey: string;
  mime: string;
  width: number;
  height: number;
  url: string | null;
  error: string | null;
}

export interface PreviewCacheKey {
  entryId: EntryId;
  sizeBytes: number;
  mtime: number;
  generatorVersion: number;
}
