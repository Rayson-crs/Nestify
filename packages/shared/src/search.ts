import type { DupGroupId, EntryId, LibraryId } from './ids.ts';
import type { Entry, EntryKind } from './entry.ts';

export const SEARCH_SORTS = ['relevance', 'mtime', 'size', 'path', 'name', 'path_mtime'] as const;
export type SearchSortField = (typeof SEARCH_SORTS)[number];
export type SortDir = 'asc' | 'desc';

export interface NumericRange {
  min?: number;
  max?: number;
}

export interface SearchFilters {
  ext?: string[];
  type?: EntryKind[];
  parent?: string;
  path?: string;
  size?: NumericRange;
  mtime?: NumericRange;
  depth?: NumericRange;
  dup?: boolean;
}

export interface SearchQuery {
  text: string;
  libraryId?: LibraryId;
  filters: SearchFilters;
  sort: SearchSortField;
  sortDir?: SortDir;
  limit: number;
  offset: number;
}

export interface SearchHit {
  entry: Entry;
  score: number;
  dupGroupId?: DupGroupId;
}

export interface SearchResult {
  query: SearchQuery;
  total: number;
  hits: SearchHit[];
  elapsedMs: number;
}

export interface SearchRequest {
  query: SearchQuery;
}

export interface SearchResponse {
  result: SearchResult;
  selectedIds?: EntryId[];
}
