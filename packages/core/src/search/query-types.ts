export type SearchEntriesRequest = {
  libraryId: string;
  text: string;
  limit?: number;
  offset?: number;
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
  elapsedMs: number;
};

export type SearchSort = {
  field?: "relevance" | "mtime" | "size" | "path" | "name" | "path_mtime";
  direction?: "asc" | "desc";
};
