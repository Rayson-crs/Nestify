export type SearchEntriesRequest = {
  libraryId: string;
  text: string;
  textMode?: "full-text" | "substring";
  limit?: number;
  offset?: number;
  cursor?: string;
  resultMode?: "hits-only" | "hits-and-approximate-count" | "hits-and-exact-stats";
  kinds?: string[];
  scope?: "library" | "directory" | "selection";
  directory?: string;
  directChildren?: boolean;
  entryIds?: string[];
  sort?: SearchSort;
};

export type SearchEntryHit = {
  entryId: string;
  libraryId: string;
  name: string;
  path: string;
  ext: string;
  parent: string | null;
  kind: string;
  size: number;
  mtime: number | null;
};

export type SearchEntriesResult = {
  hits: SearchEntryHit[];
  total: number;
  fileCount: number;
  directoryCount: number;
  kindCounts: Record<string, number>;
  elapsedMs: number;
  hasMore: boolean;
  nextCursor?: string;
  statsIncluded: boolean;
};

export type SearchSort = {
  field?: "relevance" | "mtime" | "size" | "path" | "name" | "path_mtime";
  direction?: "asc" | "desc";
};
