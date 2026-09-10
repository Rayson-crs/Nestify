import type { DatabaseSync } from "node:sqlite";
import {
  parseSearchQuery,
  type ParsedSearchQuery,
} from "./parse.ts";
import {
  buildFilters,
  buildScopeFilters,
  compileBoolean,
  kindClause,
  resolveKinds,
  type SqlClause,
} from "./query-filters.ts";
import type {
  SearchEntriesRequest,
  SearchEntriesResult,
  SearchEntryHit,
  SearchSort,
} from "./query-types.ts";
import { SQLITE_SEARCH_INDEX_VERSION, sqliteSearchIndexVersion } from "./index-state.ts";
import { gramsForName } from "./trigram.ts";

import { ALL_LIBRARIES_ID } from "./query-filters.ts";

export { ALL_LIBRARIES_ID } from "./query-filters.ts";
export type {
  SearchEntriesRequest,
  SearchEntriesResult,
  SearchEntryHit,
  SearchSort,
} from "./query-types.ts";

const DEFAULT_LIMIT = 100;
const ENTRIES_SCAN_RATIO = 0.1;
const SCAN_STATS_TTL_MS = 60_000;
const TRIGRAM_FREQUENCY_CAP = 1_001;
const TRIGRAM_FREQUENCY_MAX_CAP = 1_048_576;
const SORT_FIELDS = new Set(["relevance", "mtime", "size", "path", "name", "path_mtime"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);
const scanStatsCache = new WeakMap<DatabaseSync, {
  expiresAt: number;
  totalActive: number;
  libraryCounts: Map<string, number>;
}>();
const trigramFrequencyCache = new WeakMap<DatabaseSync, {
  expiresAt: number;
  samples: Map<string, { count: number; cap: number; exact: boolean }>;
}>();

function chooseScanDirection(db: DatabaseSync, request: SearchEntriesRequest): boolean {
  if (request.scope === "directory" || request.scope === "selection") {
    return false;
  }
  if (request.libraryId === ALL_LIBRARIES_ID) {
    return true;
  }

  const stats = scanStats(db);
  if (stats.totalActive === 0) {
    return false;
  }
  return countActiveMembership(db, request.libraryId) / stats.totalActive >= ENTRIES_SCAN_RATIO;
}

function scanStats(db: DatabaseSync): {
  expiresAt: number;
  totalActive: number;
  libraryCounts: Map<string, number>;
} {
  const now = Date.now();
  const cached = scanStatsCache.get(db);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const stats = {
    expiresAt: now + SCAN_STATS_TTL_MS,
    totalActive: countActiveEntries(db),
    libraryCounts: new Map<string, number>(),
  };
  scanStatsCache.set(db, stats);
  return stats;
}

function countActiveEntries(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS count FROM entries WHERE tombstone = 0").get() as {
    count: number;
  }).count;
}

function countActiveMembership(db: DatabaseSync, libraryId: string): number {
  const stats = scanStatsCache.get(db);
  const cached = stats && stats.expiresAt > Date.now()
    ? stats.libraryCounts.get(libraryId)
    : undefined;
  if (cached !== undefined) {
    return cached;
  }

  const count = (db.prepare(
    "SELECT COUNT(*) AS count FROM library_entries WHERE library_id = ? AND tombstone = 0",
  ).get(libraryId) as { count: number }).count;
  if (stats && stats.expiresAt > Date.now()) {
    stats.libraryCounts.set(libraryId, count);
  }
  return count;
}
const HIT_SELECT = `
  SELECT
    e.id AS entryId,
    e.library_id AS libraryId,
    e.name AS name,
    e.path AS path,
    e.ext AS ext,
    e.parent_path AS parent,
    e.kind AS kind,
    e.size AS size,
    e.mtime AS mtime
`;

export function searchEntries(
  db: DatabaseSync,
  request: SearchEntriesRequest,
): SearchEntriesResult {
  const started = Date.now();
  const parsed = parseSearchQuery(request.text ?? "");
  const { limit, offset } = normalizePagination(request);
  const resultMode = request.resultMode ?? "hits-and-exact-stats";
  const sort = normalizeSort(request.sort);
  const textTokens = textSources(parsed);
  const hasText = textTokens.length > 0;
  const hasLong = textTokens.some((token) => token.length >= 3);

  const finish = (rows: { hits: SearchEntryHit[]; total: number; fileCount: number; directoryCount: number; kindCounts: Record<string, number>; hasMore: boolean; nextCursor?: string; statsIncluded: boolean }): SearchEntriesResult => ({
    hits: resolveHitLibraryIds(db, rows.hits, request.libraryId),
    total: rows.total,
    fileCount: rows.fileCount,
    directoryCount: rows.directoryCount,
    kindCounts: rows.kindCounts,
    elapsedMs: Date.now() - started,
    hasMore: rows.hasMore,
    nextCursor: rows.nextCursor,
    statsIncluded: rows.statsIncluded,
  });

  const driveFromEntries = chooseScanDirection(db, request);

  if (parsed.expression) {
    const scope = buildScopeFilters(request, driveFromEntries);
    const expression = compileBoolean(parsed.expression);
    const kinds = kindClause(resolveKinds(undefined, request.kinds));
    return finish(
      executeSearch(
        db,
        {
          sql: `${scope.sql}${kinds ? ` AND ${kinds.sql}` : ""} AND (${expression.sql})`,
          params: [...scope.params, ...(kinds?.params ?? []), ...expression.params],
        },
        limit,
        offset,
        request.cursor,
        resultMode,
        "",
        sort,
        driveFromEntries,
      ),
    );
  }

  const filters = buildFilters(db, request, parsed, driveFromEntries);

  if (!hasText) {
    return finish(executeSearch(db, filters, limit, offset, request.cursor, resultMode, "", sort, driveFromEntries));
  }

  if (hasLong && request.textMode !== "substring") {
    const match = buildFtsMatch(parsed);
    if (match) {
      try {
        const orderedNamePage = shouldUseOrderedNamePage(request, sort, driveFromEntries);
        if (orderedNamePage && hasBroadFtsMatch(db, match)) {
          return finish(
            executeSearch(
              db,
              withLike(filters, parsed),
              limit,
              offset,
              request.cursor,
              resultMode,
              "",
              sort,
              true,
            ),
          );
        }

        const joinSql = ftsJoinSql();
        const fts = executeSearch(
          db,
          {
            sql: `entry_fts MATCH ? AND ${filters.sql}`,
            params: [match, ...filters.params],
          },
          limit,
          offset,
          request.cursor,
          resultMode,
          joinSql,
          sort,
          driveFromEntries,
          [],
          true,
        );
        if (fts.hits.length > 0 || fts.total > 0) {
          return finish(fts);
        }
      } catch {
        return finish(executeSearch(db, withLike(filters, parsed), limit, offset, request.cursor, resultMode, "", sort, driveFromEntries));
      }
    }
  }

  const grams = queryGrams(parsed, sqliteSearchIndexVersion(db));
  if (grams.length > 0) {
    const probeCount = request.textMode === "substring" ? 2 : 1;
    const trigramClause = trigramJoin(
      chooseTrigramAnchor(db, grams, probeCount),
      probeCount,
    );
    const trigram = executeSearch(
      db,
      withLike(filters, parsed),
      limit,
      offset,
      request.cursor,
      resultMode,
      trigramClause.sql,
      sort,
      driveFromEntries,
      trigramClause.params,
    );
    if (trigram.hits.length > 0 || trigram.total > 0) {
      return finish(trigram);
    }
  }

  return finish(executeSearch(db, withLike(filters, parsed), limit, offset, request.cursor, resultMode, "", sort, driveFromEntries));
}

function executeSearch(
  db: DatabaseSync,
  where: SqlClause,
  limit: number,
  offset: number,
  cursor: string | undefined,
  resultMode: NonNullable<SearchEntriesRequest["resultMode"]>,
  joinSql = "",
  sort: NormalizedSort = { field: "name", direction: "asc" },
  driveFromEntries = false,
  joinParams: Array<string | number> = [],
  hasFtsIndex = false,
): { hits: SearchEntryHit[]; total: number; fileCount: number; directoryCount: number; kindCounts: Record<string, number>; hasMore: boolean; nextCursor?: string; statsIncluded: boolean } {
  const baseFrom = driveFromEntries
    ? "entries e"
    : "library_entries le JOIN entries e ON e.id = le.entry_id";
  const from = joinSql ? `${baseFrom} ${joinSql}` : baseFrom;
  const stats = resultMode === "hits-and-exact-stats";
  const totalRow = stats
    ? db
      .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN e.is_dir = 0 THEN 1 ELSE 0 END) AS file_count, SUM(CASE WHEN e.is_dir = 1 THEN 1 ELSE 0 END) AS directory_count FROM ${from} WHERE ${where.sql}`)
      .get(...joinParams, ...where.params) as { n: number; file_count: number | null; directory_count: number | null }
    : { n: -1, file_count: null, directory_count: null };
  const kindRows = stats
    ? db
      .prepare(`SELECT e.kind AS kind, COUNT(*) AS count FROM ${from} WHERE ${where.sql} GROUP BY e.kind ORDER BY e.kind`)
      .all(...joinParams, ...where.params) as Array<{ kind: string | null; count: number }>
    : [];
  const cursorClause = cursorClauseFor(sort, cursor);
  const pageLimit = limit + 1;
  const hits = db
    .prepare(
      `${HIT_SELECT}
       FROM ${from}
       WHERE ${where.sql}${cursorClause ? ` AND ${cursorClause.sql}` : ""}
       ORDER BY ${orderSql(sort, hasFtsIndex)}
       LIMIT ? OFFSET ?`,
    )
    .all(...joinParams, ...where.params, ...(cursorClause?.params ?? []), pageLimit, cursor ? 0 : offset) as SearchEntryHit[];
  const hasMore = hits.length > limit;
  const visibleHits = hasMore ? hits.slice(0, limit) : hits;
  return {
    hits: visibleHits,
    total: stats ? totalRow.n : (hasMore ? visibleHits.length + 1 : visibleHits.length),
    fileCount: totalRow.file_count ?? 0,
    directoryCount: totalRow.directory_count ?? 0,
    kindCounts: Object.fromEntries(kindRows.filter((row) => row.kind).map((row) => [row.kind as string, row.count])),
    hasMore,
    nextCursor: hasMore && visibleHits.length > 0 ? encodeCursor(sort, visibleHits[visibleHits.length - 1]!) : undefined,
    statsIncluded: stats,
  };
}

function resolveHitLibraryIds(
  db: DatabaseSync,
  hits: SearchEntryHit[],
  requestedLibraryId: string,
): SearchEntryHit[] {
  if (hits.length === 0) return hits;
  if (requestedLibraryId !== ALL_LIBRARIES_ID) {
    for (const hit of hits) hit.libraryId = requestedLibraryId;
    return hits;
  }

  const entryIds = [...new Set(hits.map((hit) => hit.entryId))];
  for (let start = 0; start < entryIds.length; start += 500) {
    const chunk = entryIds.slice(start, start + 500);
    const rows = db.prepare(`
      SELECT entry_id, library_id
      FROM library_entries
      WHERE tombstone = 0 AND entry_id IN (${chunk.map(() => "?").join(", ")})
    `).all(...chunk) as Array<{ entry_id: string; library_id: string }>;
    const firstMembership = new Map<string, string>();
    for (const row of rows) {
      const existing = firstMembership.get(row.entry_id);
      if (existing === undefined || row.library_id < existing) {
        firstMembership.set(row.entry_id, row.library_id);
      }
    }
    for (const hit of hits) {
      const libraryId = firstMembership.get(hit.entryId);
      if (libraryId) hit.libraryId = libraryId;
    }
  }
  return hits;
}

function ftsJoinSql(): string {
  return `JOIN entry_fts ON entry_fts.rowid = e.rowid`;
}

function shouldUseOrderedNamePage(
  request: SearchEntriesRequest,
  sort: NormalizedSort,
  driveFromEntries: boolean,
): boolean {
  return Boolean(request.cursor)
    && sort.field === "name"
    && (request.scope ?? "library") === "library"
    && driveFromEntries;
}

function hasBroadFtsMatch(db: DatabaseSync, match: string): boolean {
  const rows = db.prepare(
    "SELECT 1 AS hit FROM entry_fts WHERE entry_fts MATCH ? LIMIT ?",
  ).all(match, TRIGRAM_FREQUENCY_CAP) as Array<{ hit: number }>;
  return rows.length >= TRIGRAM_FREQUENCY_CAP;
}


function normalizePagination(request: SearchEntriesRequest): { limit: number; offset: number } {
  const limit = request.limit ?? DEFAULT_LIMIT;
  const offset = request.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative integer");
  }
  return { limit, offset };
}

type NormalizedSort = {
  field: NonNullable<SearchSort["field"]>;
  direction: NonNullable<SearchSort["direction"]>;
};

function normalizeSort(sort: SearchSort | undefined): NormalizedSort {
  const field = sort?.field ?? "name";
  const direction = sort?.direction ?? (field === "mtime" || field === "size" ? "desc" : "asc");
  if (!SORT_FIELDS.has(field)) {
    throw new Error(`unsupported search sort field: ${field}`);
  }
  if (!SORT_DIRECTIONS.has(direction)) {
    throw new Error(`unsupported search sort direction: ${direction}`);
  }
  return { field, direction };
}

function orderSql(sort: NormalizedSort, hasFts: boolean): string {
  const direction = sort.direction.toUpperCase();
  if (sort.field === "relevance") {
    return hasFts ? `bm25(entry_fts) ${direction}, e.name COLLATE NOCASE ASC, e.id ASC` : `e.name COLLATE NOCASE ${direction}, e.id ASC`;
  }
  if (sort.field === "path_mtime") {
    return `e.is_dir DESC, e.parent_path COLLATE NOCASE ${direction}, e.mtime ${
      direction === "ASC" ? "DESC" : "ASC"
    }, e.name COLLATE NOCASE ASC, e.id ASC`;
  }
  const columns = {
    mtime: "e.mtime",
    size: "e.size",
    path: "e.path COLLATE NOCASE",
    name: "e.name COLLATE NOCASE",
  } as const;
  return `${columns[sort.field]} ${direction}, e.name COLLATE NOCASE ASC, e.id ASC`;
}

type CursorClause = { sql: string; params: Array<string | number> };

function encodeCursor(sort: NormalizedSort, hit: SearchEntryHit): string {
  if (sort.field === "path_mtime") {
    return Buffer.from(JSON.stringify({
      field: sort.field,
      direction: sort.direction,
      isDir: hit.kind === "dir" ? 1 : 0,
      parent: hit.parent ?? "",
      mtime: hit.mtime ?? 0,
      name: hit.name,
      id: hit.entryId,
    }), "utf8").toString("base64url");
  }
  const value = sort.field === "mtime" ? hit.mtime ?? 0
    : sort.field === "size" ? hit.size
      : sort.field === "path" ? hit.path
        : hit.name;
  return Buffer.from(JSON.stringify({ field: sort.field, direction: sort.direction, value, id: hit.entryId }), "utf8").toString("base64url");
}

function cursorClauseFor(sort: NormalizedSort, cursor: string | undefined): CursorClause | null {
  if (!cursor) return null;
  let parsed: { field?: string; direction?: string; value?: string | number; id?: string; isDir?: number; parent?: string; mtime?: number; name?: string };
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as typeof parsed;
  } catch {
    throw new Error("invalid search cursor");
  }
  if (parsed.field !== sort.field || parsed.direction !== sort.direction || parsed.id == null) {
    throw new Error("search cursor does not match sort");
  }
  if (sort.field === "path_mtime") {
    if (parsed.isDir == null || parsed.parent == null || parsed.mtime == null || parsed.name == null) {
      throw new Error("invalid path_mtime cursor");
    }
    const parentOp = sort.direction === "desc" ? "<" : ">";
    const mtimeOp = sort.direction === "desc" ? ">" : "<";
    return {
      sql: `(e.is_dir < ? OR (e.is_dir = ? AND (e.parent_path COLLATE NOCASE ${parentOp} ? OR (e.parent_path COLLATE NOCASE = ? AND (e.mtime ${mtimeOp} ? OR (e.mtime = ? AND (e.name COLLATE NOCASE > ? OR (e.name COLLATE NOCASE = ? AND e.id > ?))))))))`,
      params: [parsed.isDir, parsed.isDir, parsed.parent, parsed.parent, parsed.mtime, parsed.mtime, parsed.name, parsed.name, parsed.id],
    };
  }
  if (parsed.value == null) throw new Error("invalid search cursor");
  const column = sort.field === "mtime" ? "e.mtime"
    : sort.field === "size" ? "e.size"
      : sort.field === "path" ? "e.path COLLATE NOCASE"
        : "e.name COLLATE NOCASE";
  const op = sort.direction === "desc" ? "<" : ">";
  return { sql: `(${column} ${op} ? OR (${column} = ? AND e.id ${op} ?))`, params: [parsed.value, parsed.value, parsed.id] };
}

export function listDirectoryChildren(
  db: DatabaseSync,
  libraryId: string,
  directory: string,
  options: { limit?: number; offset?: number; sort?: SearchSort } = {},
): { hits: SearchEntryHit[]; total: number; hasMore: boolean; nextCursor?: string; elapsedMs: number } {
  const started = Date.now();
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("limit must be a positive integer");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("offset must be a non-negative integer");
  const sort = normalizeSort(options.sort);
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "") || directory;
  const rootPath = /^[A-Za-z]:$/.test(normalized) ? `${normalized}/` : normalized;
  const parent = db.prepare(`SELECT id FROM entries WHERE path = ? LIMIT 1`).get(rootPath) as { id: string } | undefined;
  const where = parent
    ? `le.library_id = ? AND le.tombstone = 0 AND e.tombstone = 0 AND e.parent_id = ?`
    : `le.library_id = ? AND le.tombstone = 0 AND e.tombstone = 0 AND replace(coalesce(e.parent_path, ''), '\\', '/') = ?`;
  const whereParams = parent ? [libraryId, parent.id] : [libraryId, rootPath];
  const rows = db.prepare(`${HIT_SELECT}
    FROM library_entries le
    JOIN entries e ON e.id = le.entry_id
    WHERE ${where}
    ORDER BY ${orderSql(sort, false)}
    LIMIT ? OFFSET ?`).all(...whereParams, limit + 1, offset) as SearchEntryHit[];
  const hasMore = rows.length > limit;
  const hits = hasMore ? rows.slice(0, limit) : rows;
  resolveHitLibraryIds(db, hits, libraryId);
  return {
    hits,
    total: hasMore ? hits.length + 1 : hits.length,
    hasMore,
    nextCursor: hasMore && hits.length > 0 && sort.field !== "path_mtime" ? encodeCursor(sort, hits[hits.length - 1]!) : undefined,
    elapsedMs: Date.now() - started,
  };
}

export function explainSearchPlan(
  db: DatabaseSync,
  request: SearchEntriesRequest,
): Array<{ id: number; parent: number; notused: number; detail: string }> {
  const driveFromEntries = chooseScanDirection(db, request);
  const sort = normalizeSort(request.sort);
  const parsed = parseSearchQuery(request.text ?? "");
  const filters = buildFilters(db, request, parsed, driveFromEntries);
  const textTokens = textSources(parsed);
  const hasLong = textTokens.some((token) => token.length >= 3);
  let where = filters;
  let joinSql = "";
  let joinParams: Array<string | number> = [];
  let hasFtsIndex = false;
  if (parsed.expression) {
    const expression = compileBoolean(parsed.expression);
    const scope = buildScopeFilters(request, driveFromEntries);
    where = {
      sql: `${scope.sql} AND (${expression.sql})`,
      params: [...scope.params, ...expression.params],
    };
  } else if (hasLong && request.textMode !== "substring") {
    const match = buildFtsMatch(parsed);
    if (match) {
      let hasFtsMatch = false;
      try {
        hasFtsMatch = db.prepare("SELECT 1 FROM entry_fts WHERE entry_fts MATCH ? LIMIT 1").get(match) != null;
      } catch {
        hasFtsMatch = false;
      }
      if (hasFtsMatch) {
        const orderedNamePage = shouldUseOrderedNamePage(request, sort, driveFromEntries);
        if (orderedNamePage && hasBroadFtsMatch(db, match)) {
          where = withLike(filters, parsed);
        } else {
          where = { sql: `entry_fts MATCH ? AND ${filters.sql}`, params: [match, ...filters.params] };
          joinSql = ftsJoinSql();
          hasFtsIndex = true;
        }
      }
    }
  }
  if (!parsed.expression && !joinSql) {
    const grams = queryGrams(parsed, sqliteSearchIndexVersion(db));
    if (grams.length > 0) {
      const probeCount = request.textMode === "substring" ? 2 : 1;
      const join = trigramJoin(
        chooseTrigramAnchor(db, grams, probeCount),
        probeCount,
      );
      joinSql = join.sql;
      joinParams = join.params;
    } else {
      where = withLike(filters, parsed);
    }
  }
  const baseFrom = driveFromEntries
    ? "entries e"
    : "library_entries le JOIN entries e ON e.id = le.entry_id";
  const from = `${baseFrom} ${joinSql}`;
  return db.prepare(
    `EXPLAIN QUERY PLAN SELECT e.id FROM ${from} WHERE ${where.sql} ORDER BY ${orderSql(sort, hasFtsIndex)} LIMIT 100`,
  ).all(...joinParams, ...where.params) as Array<{ id: number; parent: number; notused: number; detail: string }>;
}

export function explainSearchTrigramProbes(
  db: DatabaseSync,
  request: Pick<SearchEntriesRequest, "text" | "textMode">,
): string[] {
  const parsed = parseSearchQuery(request.text);
  const grams = queryGrams(parsed, sqliteSearchIndexVersion(db));
  const probeCount = request.textMode === "substring" ? 2 : 1;
  return chooseTrigramAnchor(db, grams, probeCount).slice(0, probeCount);
}

export function explainDirectoryChildrenPlan(
  db: DatabaseSync,
  libraryId: string,
  directory: string,
): Array<{ id: number; parent: number; notused: number; detail: string }> {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "") || directory;
  const rootPath = /^[A-Za-z]:$/.test(normalized) ? `${normalized}/` : normalized;
  const parent = db.prepare(`SELECT id FROM entries WHERE path = ? LIMIT 1`).get(rootPath) as { id: string } | undefined;
  const where = parent
    ? `le.library_id = ? AND le.tombstone = 0 AND e.tombstone = 0 AND e.parent_id = ?`
    : `le.library_id = ? AND le.tombstone = 0 AND e.tombstone = 0 AND replace(coalesce(e.parent_path, ''), '\\', '/') = ?`;
  const params = parent ? [libraryId, parent.id] : [libraryId, rootPath];
  return db.prepare(
    `EXPLAIN QUERY PLAN SELECT e.id FROM library_entries le JOIN entries e ON e.id = le.entry_id WHERE ${where} ORDER BY e.name COLLATE NOCASE ASC, e.id ASC LIMIT 100`,
  ).all(...params) as Array<{ id: number; parent: number; notused: number; detail: string }>;
}

function withLike(filters: SqlClause, parsed: ParsedSearchQuery): SqlClause {
  const needles = textSources(parsed);
  if (needles.length === 0) {
    return filters;
  }
  return {
    sql: `${filters.sql} AND ${needles.map(() => `e.name LIKE '%' || ? || '%'`).join(" AND ")}`,
    params: [...filters.params, ...needles],
  };
}

function trigramJoin(grams: string[], probeCount = 1): SqlClause {
  const selected = grams.slice(0, Math.max(1, probeCount));
  const [anchor] = selected;
  if (!anchor) {
    return { sql: "", params: [] };
  }
  if (selected.length === 1) {
    return {
      sql: `JOIN name_trigrams trigram_anchor
        ON trigram_anchor.entry_id = e.id
       AND trigram_anchor.gram = ?
      `,
      params: [anchor],
    };
  }
  // The final LIKE guarantees the exact substring; other grams only repeat
  // candidate probes already covered by the two lowest-frequency grams. The
  // covering (gram, entry_id) index lets SQLite intersect ordered ID streams.
  return {
    sql: `JOIN (
        SELECT entry_id FROM name_trigrams WHERE gram = ?
        INTERSECT
        SELECT entry_id FROM name_trigrams WHERE gram = ?
      ) trigram_probes ON trigram_probes.entry_id = e.id
    `,
    params: selected.slice(0, 2),
  };
}

function chooseTrigramAnchor(db: DatabaseSync, grams: string[], probeCount = 1): string[] {
  if (grams.length <= probeCount) return grams;

  const frequencies = new Map<string, number>();
  const exactGrams = new Set<string>();
  for (let cap = TRIGRAM_FREQUENCY_CAP; cap <= TRIGRAM_FREQUENCY_MAX_CAP; cap *= 2) {
    for (const gram of grams) {
      if (exactGrams.has(gram)) continue;
      const count = trigramFrequency(db, gram, cap);
      frequencies.set(gram, count);
      if (count < cap) exactGrams.add(gram);
    }
    if (exactGrams.size >= probeCount) break;
  }

  return [...grams].sort((left, right) =>
    frequencies.get(left)! - frequencies.get(right)! || left.localeCompare(right)
  );
}

function trigramFrequency(db: DatabaseSync, gram: string, cap: number): number {
  const now = Date.now();
  let cache = trigramFrequencyCache.get(db);
  if (!cache || cache.expiresAt <= now) {
    cache = { expiresAt: now + SCAN_STATS_TTL_MS, samples: new Map() };
    trigramFrequencyCache.set(db, cache);
  }

  const cached = cache.samples.get(gram);
  if (cached && (cached.exact || cap <= cached.cap)) return cached.count;
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM (SELECT 1 FROM name_trigrams WHERE gram = ? LIMIT ?)",
  ).get(gram, cap) as { count: number };
  cache.samples.set(gram, { count: row.count, cap, exact: row.count < cap });
  return row.count;
}

function buildFtsMatch(parsed: ParsedSearchQuery): string {
  const parts: string[] = [];
  for (const term of parsed.textTerms) {
    if (term) {
      parts.push(formatFtsTerm(term));
    }
  }
  if (parsed.phrase) {
    parts.push(quoteFts(parsed.phrase));
  }
  return parts.join(" AND ");
}

function formatFtsTerm(term: string): string {
  const quoted = quoteFts(term);
  if (isCjkToken(term)) {
    return quoted;
  }
  return `${quoted}*`;
}

function quoteFts(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

function isCjkToken(term: string): boolean {
  return !/[A-Za-z\s]/.test(term) && /[^\x00-\x7F]/.test(term);
}

function textSources(parsed: ParsedSearchQuery): string[] {
  const tokens = [...parsed.textTerms];
  if (parsed.phrase) {
    tokens.push(parsed.phrase);
  }
  return tokens.filter((token) => token.length > 0);
}

function queryGrams(parsed: ParsedSearchQuery, indexVersion = SQLITE_SEARCH_INDEX_VERSION): string[] {
  const grams = new Set<string>();
  for (const source of textSources(parsed)) {
    for (const gram of gramsForName(source)) {
      if (indexVersion >= SQLITE_SEARCH_INDEX_VERSION || gram.length !== 1 || !isCjkGram(gram)) {
        grams.add(gram);
      }
    }
  }
  return [...grams];
}

function isCjkGram(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}
