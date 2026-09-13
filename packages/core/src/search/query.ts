import type { DatabaseSync } from "node:sqlite";
import {
  parseSearchQuery,
  parseIntegerFilter,
  parseMtimeFilter,
  parseSizeFilter,
  type ParsedSearchQuery,
  type SearchBooleanNode,
} from "./parse.ts";
import {
  buildFilters,
  buildScopeFilters,
  compileBoolean,
  compileBooleanSafe,
  kindClause,
  resolveKinds,
  type SqlClause,
} from "./query-filters.ts";
import type { MatchTree } from "@nestify/rules";
import type {
  SearchEntriesRequest,
  SearchEntriesResult,
  SearchEntryHit,
  SearchSort,
} from "./query-types.ts";
import { asEntryId, asLibraryId, type Entry } from "@nestify/shared";
import { SQLITE_SEARCH_INDEX_VERSION, sqliteSearchIndexVersion } from "./index-state.ts";
import { gramsForName } from "./trigram.ts";
import { directoryNameOf, normalizeScanPath, scanPathAliases } from "../fs/path.ts";
import { listEntries, listLibraries } from "../db/repos/index.ts";
import { buildContextIndex, buildRuleContext } from "../rules/context.ts";
import { matches } from "../rules/match.ts";

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
    const kinds = kindClause(resolveKinds(undefined, request.kinds));
    const expression = compileBooleanSafe(parsed.expression);
    if (!expression.supported) {
      return finish(searchExpressionInMemory(db, request, scope, kinds, parsed.expression, limit, offset, sort, driveFromEntries));
    }
    return finish(
      executeSearch(
        db,
        {
          sql: `${scope.sql}${kinds ? ` AND ${kinds.sql}` : ""} AND (${expression.clause.sql})`,
          params: [...scope.params, ...(kinds?.params ?? []), ...expression.clause.params],
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

function searchExpressionInMemory(
  db: DatabaseSync,
  request: SearchEntriesRequest,
  scope: SqlClause,
  kinds: SqlClause | null,
  expression: SearchBooleanNode,
  limit: number,
  offset: number,
  sort: NormalizedSort,
  driveFromEntries: boolean,
): { hits: SearchEntryHit[]; total: number; fileCount: number; directoryCount: number; kindCounts: Record<string, number>; hasMore: boolean; nextCursor?: string; statsIncluded: boolean } {
  const baseFrom = driveFromEntries
    ? "entries e"
    : "library_entries le JOIN entries e ON e.id = le.entry_id";
  const kindClauseSql = kinds ? ` AND ${kinds.sql}` : "";
  const rows = db.prepare(
    `SELECT e.*${driveFromEntries ? ", e.rel_path AS rel_path" : ", le.rel_path AS rel_path"}
       FROM ${baseFrom}
      WHERE ${scope.sql}${kindClauseSql}`,
  ).all(...scope.params, ...(kinds?.params ?? [])) as Array<Record<string, unknown>>;
  const entries = rows.map((row) => mapRawEntry(row));
  const indexEntries = request.libraryId === ALL_LIBRARIES_ID
    ? listLibraries(db).flatMap((library) => listEntries(db, library.id))
    : listEntries(db, request.libraryId);
  const index = buildContextIndex(indexEntries);
  const matched = entries.filter((entry) => searchBooleanMatches(expression, entry, buildRuleContext(entry, index)));
  matched.sort((left, right) => compareEntries(left, right, sort));
  const total = matched.length;
  const fileCount = matched.filter((entry) => !entry.isDir).length;
  const directoryCount = total - fileCount;
  const kindCounts: Record<string, number> = {};
  for (const entry of matched) kindCounts[entry.kind] = (kindCounts[entry.kind] ?? 0) + 1;
  const visible = matched.slice(offset, offset + limit + 1);
  const hasMore = visible.length > limit;
  const page = hasMore ? visible.slice(0, limit) : visible;
  const hits = page.map((entry) => ({
    entryId: entry.id,
    libraryId: entry.libraryId,
    name: entry.name,
    path: entry.path,
    ext: entry.ext,
    parent: entry.parentPath,
    kind: entry.kind,
    size: entry.size,
    mtime: entry.mtime,
  }));
  return {
    hits,
    total,
    fileCount,
    directoryCount,
    kindCounts,
    hasMore,
    nextCursor: hasMore && hits.length > 0 ? encodeCursor(sort, hits[hits.length - 1]!) : undefined,
    statsIncluded: true,
  };
}

function mapRawEntry(row: Record<string, unknown>): Entry {
  const isDir = Number(row.is_dir ?? 0) === 1;
  return {
    id: asEntryId(String(row.id)),
    libraryId: asLibraryId(String(row.library_id)),
    parentId: row.parent_id == null ? null : asEntryId(String(row.parent_id)),
    name: String(row.name ?? ""),
    stem: String(row.stem ?? ""),
    ext: isDir ? "" : String(row.ext ?? ""),
    isDir,
    size: Number(row.size ?? 0),
    mtime: Number(row.mtime ?? 0),
    ctime: Number(row.ctime ?? 0),
    atime: Number(row.atime ?? 0),
    ino: row.ino == null ? null : String(row.ino),
    dev: row.dev == null ? null : String(row.dev),
    depth: Number(row.depth ?? 0),
    kind: String(row.kind ?? "unknown") as import("@nestify/shared").EntryKind,
    protocol: String(row.protocol ?? "local") as import("@nestify/shared").StorageProtocol,
    mime: row.mime == null ? null : String(row.mime),
    path: String(row.path ?? ""),
    parentPath: row.parent_path == null ? null : String(row.parent_path),
    relPath: String(row.rel_path ?? ""),
    hashQuick: row.hash_quick == null ? null : String(row.hash_quick),
    hashFull: row.hash_full == null ? null : String(row.hash_full),
    childCount: Number(row.child_count ?? 0),
    fileCount: Number(row.file_count ?? 0),
    dirCount: Number(row.dir_count ?? 0),
    tombstone: Number(row.tombstone ?? 0) === 1,
    seenAt: Number(row.seen_at ?? 0),
    indexedAt: row.indexed_at == null ? null : Number(row.indexed_at),
  };
}

function searchBooleanMatches(
  node: SearchBooleanNode,
  entry: Entry,
  context: ReturnType<typeof buildRuleContext>,
): boolean {
  if (node.type === "and") return node.children.every((child) => searchBooleanMatches(child, entry, context));
  if (node.type === "or") return node.children.some((child) => searchBooleanMatches(child, entry, context));
  if (node.type === "not") return !searchBooleanMatches(node.child, entry, context);
  if (node.type === "rule") return matches(node.rule as MatchTree, context);
  if (node.type === "text") return entry.name.toLocaleLowerCase().includes(node.value.toLocaleLowerCase());
  return searchFilterMatches(node.field, node.values, entry, context);
}

function searchFilterMatches(
  field: string,
  values: string[],
  entry: Entry,
  context: ReturnType<typeof buildRuleContext>,
): boolean {
  const value = values[0] ?? "";
  switch (field) {
    case "name": return entry.name.toLocaleLowerCase().includes(value.toLocaleLowerCase());
    case "folder_name": return entry.isDir && entry.name.toLocaleLowerCase().includes(value.toLocaleLowerCase());
    case "file_name": return !entry.isDir && entry.name.toLocaleLowerCase().includes(value.toLocaleLowerCase());
    case "parent":
    case "dir": return (entry.parentPath ?? "").toLocaleLowerCase().includes(value.toLocaleLowerCase());
    case "path": return entry.path.toLocaleLowerCase().includes(value.toLocaleLowerCase()) || entry.relPath.toLocaleLowerCase().includes(value.toLocaleLowerCase());
    case "kind":
    case "type": return values.some((item) => item.toLocaleLowerCase() === (item === "dir" || item === "folder" ? (entry.isDir ? "dir" : "file") : entry.kind.toLocaleLowerCase()));
    case "ext": return values.some((item) => entry.ext.replace(/^\./, "").toLocaleLowerCase() === item.replace(/^\./, "").toLocaleLowerCase());
    case "size": return compareSearchNumber(entry.size, parseSizeFilter(value));
    case "mtime": return compareSearchNumber(entry.mtime, parseMtimeFilter(value));
    case "ctime": return compareSearchNumber(entry.ctime, parseMtimeFilter(value));
    case "depth": return compareSearchNumber(entry.depth, parseIntegerFilter(value));
    case "name_length": return compareSearchNumber(Array.from(entry.stem).length, parseIntegerFilter(value));
    case "child_count": return compareSearchNumber(entry.childCount, parseIntegerFilter(value));
    case "file_count": return compareSearchNumber(entry.fileCount, parseIntegerFilter(value));
    case "dir_count": return compareSearchNumber(entry.dirCount, parseIntegerFilter(value));
    case "name_digits": return value.toLowerCase() === "true"
      ? entry.stem.length > 0 && /^\d+$/.test(entry.stem)
      : value.toLowerCase() === "any" && /\d/.test(entry.stem);
    case "has": return hasSidecar(context, value.toLowerCase());
    case "missing": return !hasSidecar(context, value.toLowerCase());
    case "unique_video": return context.children.has_unique_video === (value.toLowerCase() === "true");
    case "is_sidecar": return isSidecarValue(context) === (value.toLowerCase() === "true");
    case "windows_illegal": return hasWindowsIllegalChars(entry.name) === (value.toLowerCase() === "true");
    case "useful_file_count": return compareSearchNumber(context.children.useful_file_count, parseIntegerFilter(value));
    case "same_stem": return hasSiblingStem(context) === (value.toLowerCase() === "true");
    case "orphan_sidecar": return isOrphanSidecar(context) === (value.toLowerCase() === "true");
    case "name_date": return hasDatePattern(entry.name, value);
    case "path_date": return hasDatePattern(entry.path, value);
    case "date_pattern": return hasDatePattern(entry.name, value) || hasDatePattern(entry.path, value);
    default: return false;
  }
}

function compareSearchNumber(actual: number, filter: ReturnType<typeof parseIntegerFilter> | ReturnType<typeof parseSizeFilter> | ReturnType<typeof parseMtimeFilter> | undefined): boolean {
  if (!filter) return false;
  if (filter.operator === "between") return filter.min !== undefined && filter.max !== undefined && actual >= filter.min && actual <= filter.max;
  if (filter.value === undefined) return false;
  if (filter.operator === "eq") return actual === filter.value;
  if (filter.operator === "gt") return actual > filter.value;
  if (filter.operator === "gte") return actual >= filter.value;
  if (filter.operator === "lt") return actual < filter.value;
  return actual <= filter.value;
}

function hasWindowsIllegalChars(value: string): boolean {
  return /[<>:"/\\|?*\u0000-\u001f]/.test(value) || /[. ]$/.test(value);
}

function hasDatePattern(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[yY]{4}/g, "\\d{4}").replace(/[yY]{2}/g, "\\d{2}").replace(/[mM]{1,2}/g, "\\d{1,2}").replace(/[dD]{1,2}/g, "\\d{1,2}");
  try { return new RegExp(escaped).test(value); } catch { return false; }
}

function hasSidecar(context: ReturnType<typeof buildRuleContext>, extension: string): boolean {
  if (extension === "nfo") return context.children.names.some((name) => name.toLowerCase().endsWith(".nfo"));
  return context.children.names.some((name) => name.toLowerCase().endsWith(`.${extension}`));
}

function isSidecarValue(context: ReturnType<typeof buildRuleContext>): boolean {
  return context.peer_dir.exists || context.kind === "subtitle" || context.ext.toLowerCase() === ".nfo";
}

function hasSiblingStem(context: ReturnType<typeof buildRuleContext>): boolean {
  return context.peer_dir.exists;
}

function isOrphanSidecar(context: ReturnType<typeof buildRuleContext>): boolean {
  return isSidecarValue(context) && !context.children.has_unique_video;
}

function compareEntries(left: import("@nestify/shared").Entry, right: import("@nestify/shared").Entry, sort: NormalizedSort): number {
  const direction = sort.direction === "asc" ? 1 : -1;
  if (sort.field === "path_mtime") {
    return compareValues(left.isDir ? 1 : 0, right.isDir ? 1 : 0, -1)
      || compareValues(left.parentPath ?? "", right.parentPath ?? "", direction)
      || compareValues(left.mtime, right.mtime, direction === 1 ? -1 : 1)
      || compareValues(left.name, right.name, 1)
      || compareValues(left.id, right.id, 1);
  }
  const leftValue = sort.field === "mtime" ? left.mtime : sort.field === "size" ? left.size : sort.field === "path" ? left.path : left.name;
  const rightValue = sort.field === "mtime" ? right.mtime : sort.field === "size" ? right.size : sort.field === "path" ? right.path : right.name;
  return compareValues(leftValue, rightValue, direction) || compareValues(left.name, right.name, 1) || compareValues(left.id, right.id, 1);
}

function compareValues(left: string | number, right: string | number, direction: number): number {
  if (left === right) return 0;
  return (left < right ? -1 : 1) * direction;
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

function directoryPathCandidates(directory: string): string[] {
  return scanPathAliases(directory);
}

const DIRECTORY_CHILDREN_FROM = "entries e JOIN library_entries le ON le.entry_id = e.id";
const DIRECTORY_CHILDREN_MEMBERSHIP = "e.tombstone = 0 AND le.library_id = ? AND le.tombstone = 0";

type DirectoryChildrenBranch = {
  where: string;
  params: Array<string | number>;
};

function canonicalDirectoryParentPath(directory: string): string {
  const slash = directory.replace(/\\/g, "/").replace(/\/+$/, "") || directory.replace(/\\/g, "/");
  return /^[A-Za-z]:$/.test(slash) ? `${slash}/` : slash;
}

function isWindowsDriveRootPath(directory: string): boolean {
  const slash = directory.replace(/\\/g, "/").replace(/\/+$/, "") || directory.replace(/\\/g, "/");
  return /^[A-Za-z]:$/.test(slash);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function displayDirectoryPath(directory: string): string {
  const trimmed = directory.trim();
  if (!trimmed) return trimmed;
  if (isWindowsDriveRootPath(trimmed)) {
    const letter = trimmed[0] ?? "C";
    return `${letter}:\\`;
  }
  if (trimmed.includes("\\") || /^[A-Za-z]:/.test(trimmed)) {
    return normalizeScanPath(trimmed) || trimmed;
  }
  return canonicalDirectoryParentPath(trimmed);
}

function joinDirectoryChildPath(directory: string, name: string): string {
  const parent = displayDirectoryPath(directory);
  if (isWindowsDriveRootPath(parent) || /^[A-Za-z]:\\$/.test(parent) || /^[A-Za-z]:\/$/.test(parent)) {
    const letter = parent[0] ?? "C";
    return `${letter}:\\${name}`;
  }
  if (parent === "/") return `/${name}`;
  const sep = parent.includes("\\") ? "\\" : "/";
  const base = parent.replace(/[\\/]+$/, "");
  return `${base}${sep}${name}`;
}

function descendantPathPrefix(directory: string): string {
  const canonical = canonicalDirectoryParentPath(directory);
  return canonical.endsWith("/") ? canonical : `${canonical}/`;
}

function synthesizeOrderSql(sort: NormalizedSort): string {
  const direction = sort.direction.toUpperCase();
  if (sort.field === "mtime") return `mtime ${direction}, name COLLATE NOCASE ASC`;
  if (sort.field === "size") return `size ${direction}, name COLLATE NOCASE ASC`;
  return `name COLLATE NOCASE ${direction}`;
}

function synthesizedDirectoryChildrenSourceSql(): string {
  return `SELECT name, MAX(mtime) AS mtime, MAX(size) AS size
     FROM (
       SELECT
         CASE
           WHEN instr(rel, '/') > 0 THEN substr(rel, 1, instr(rel, '/') - 1)
           ELSE rel
         END AS name,
         mtime,
         size
       FROM (
         SELECT substr(replace(e.path, '\\', '/'), length(?) + 1) AS rel, e.mtime AS mtime, e.size AS size
         FROM entries e
         JOIN library_entries le ON le.entry_id = e.id
         WHERE e.tombstone = 0
           AND le.library_id = ?
           AND le.tombstone = 0
           AND replace(e.path, '\\', '/') LIKE ? ESCAPE '\\'
       ) descendants
       WHERE rel IS NOT NULL AND instr(rel, '/') > 0
     ) missing_dirs
     WHERE name IS NOT NULL AND name <> '' AND name <> '.' AND name <> '..'
     GROUP BY name`;
}

function synthesizedDirectoryChildrenParams(libraryId: string, directory: string): Array<string | number> {
  const prefix = descendantPathPrefix(directory);
  return [prefix, libraryId, `${escapeLike(prefix)}%`];
}

function synthesizeMissingDirectoryChildren(
  db: DatabaseSync,
  libraryId: string,
  directory: string,
  sort: NormalizedSort,
  limit: number,
  offset: number,
): SearchEntryHit[] {
  const prefix = descendantPathPrefix(directory);
  if (!prefix || prefix === "/") return [];
  const parent = displayDirectoryPath(directory);
  const rows = db.prepare(
    `${synthesizedDirectoryChildrenSourceSql()}
     ORDER BY ${synthesizeOrderSql(sort)}
     LIMIT ? OFFSET ?`,
  ).all(...synthesizedDirectoryChildrenParams(libraryId, directory), limit, offset) as Array<{
    name: string;
    mtime: number | null;
    size: number | null;
  }>;

  return rows.map((row) => {
    const path = joinDirectoryChildPath(directory, row.name);
    return {
      entryId: `virtual:${path}`,
      libraryId,
      name: row.name || directoryNameOf(path),
      path,
      ext: "",
      parent,
      kind: "dir",
      size: row.size ?? 0,
      mtime: row.mtime,
    };
  });
}

function countSynthesizedDirectoryChildren(
  db: DatabaseSync,
  libraryId: string,
  directory: string,
): number {
  const prefix = descendantPathPrefix(directory);
  if (!prefix || prefix === "/") return 0;
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM (${synthesizedDirectoryChildrenSourceSql()})`,
  ).get(...synthesizedDirectoryChildrenParams(libraryId, directory)) as { n: number }).n;
}

function parentIdChildrenBranch(parentId: string, libraryId: string): DirectoryChildrenBranch {
  return {
    where: `e.parent_id = ? AND ${DIRECTORY_CHILDREN_MEMBERSHIP}`,
    params: [parentId, libraryId],
  };
}

function parentPathChildrenBranch(parentPath: string, libraryId: string): DirectoryChildrenBranch {
  return {
    where: `replace(coalesce(e.parent_path, ''), '\\', '/') = ? AND ${DIRECTORY_CHILDREN_MEMBERSHIP}`,
    params: [parentPath, libraryId],
  };
}

function directoryParentPathEquals(directory: string, fallback: string | null): string[] {
  const source = directory.trim() || fallback || "";
  if (!source) return fallback == null ? [] : [fallback];
  const canonical = canonicalDirectoryParentPath(source);
  return canonical ? [canonical] : [];
}

function driveRootParentPathVariants(directory: string): string[] {
  const canonical = canonicalDirectoryParentPath(directory);
  if (!isWindowsDriveRootPath(directory) && !isWindowsDriveRootPath(canonical)) return [];
  const letter = canonical[0] ?? "C";
  return [...new Set([
    `${letter.toUpperCase()}:/`,
    `${letter.toLowerCase()}:/`,
    `${letter.toUpperCase()}:`,
    `${letter.toLowerCase()}:`,
  ])];
}

function directoryChildrenBranches(
  libraryId: string,
  lookup: { parentId: string | null; parentPath: string | null },
  directory: string,
): DirectoryChildrenBranch[] {
  const branches: DirectoryChildrenBranch[] = [];
  if (lookup.parentId) {
    branches.push(parentIdChildrenBranch(lookup.parentId, libraryId));
    return branches;
  }

  // Keep each predicate as a separate indexed lookup. Mixing parent_id with
  // parent_path OR/IN makes SQLite abandon idx_entries_parent_* .
  const pathValues = directoryParentPathEquals(directory, lookup.parentPath);
  if (pathValues.length === 0) {
    branches.push(parentPathChildrenBranch(lookup.parentPath ?? "", libraryId));
    return branches;
  }
  return pathValues.map((value) => parentPathChildrenBranch(value, libraryId));
}

function unionOrderSql(sort: NormalizedSort): string {
  const direction = sort.direction.toUpperCase();
  if (sort.field === "path_mtime") {
    return `CASE WHEN kind = 'dir' THEN 1 ELSE 0 END DESC, parent COLLATE NOCASE ${direction}, mtime ${
      direction === "ASC" ? "DESC" : "ASC"
    }, name COLLATE NOCASE ASC, entryId ASC`;
  }
  if (sort.field === "relevance") {
    return `name COLLATE NOCASE ${direction}, entryId ASC`;
  }
  const columns = {
    mtime: "mtime",
    size: "size",
    path: "path COLLATE NOCASE",
    name: "name COLLATE NOCASE",
  } as const;
  return `${columns[sort.field]} ${direction}, name COLLATE NOCASE ASC, entryId ASC`;
}

function compileDirectoryChildrenSelect(
  branches: DirectoryChildrenBranch[],
  sort: NormalizedSort,
  limit: number,
  offset: number,
): { sql: string; params: Array<string | number> } {
  if (branches.length === 1) {
    const branch = branches[0]!;
    return {
      sql: `${HIT_SELECT}
    FROM ${DIRECTORY_CHILDREN_FROM}
    WHERE ${branch.where}
    ORDER BY ${orderSql(sort, false)}
    LIMIT ? OFFSET ?`,
      params: [...branch.params, limit, offset],
    };
  }
  const parts = branches.map((branch) => `${HIT_SELECT}
    FROM ${DIRECTORY_CHILDREN_FROM}
    WHERE ${branch.where}`);
  return {
    sql: `SELECT entryId, libraryId, name, path, ext, parent, kind, size, mtime FROM (
    ${parts.join("\n    UNION\n    ")}
    ) AS directory_hits
    ORDER BY ${unionOrderSql(sort)}
    LIMIT ? OFFSET ?`,
    params: [...branches.flatMap((branch) => branch.params), limit, offset],
  };
}

function compileDirectoryChildrenExplain(
  branches: DirectoryChildrenBranch[],
): { sql: string; params: Array<string | number> } {
  if (branches.length === 1) {
    const branch = branches[0]!;
    return {
      sql: `EXPLAIN QUERY PLAN SELECT e.id FROM ${DIRECTORY_CHILDREN_FROM} WHERE ${branch.where} ORDER BY e.name COLLATE NOCASE ASC, e.id ASC LIMIT 100`,
      params: branch.params,
    };
  }
  const parts = branches.map((branch) => `SELECT e.id FROM ${DIRECTORY_CHILDREN_FROM} WHERE ${branch.where}`);
  return {
    sql: `EXPLAIN QUERY PLAN ${parts.join(" UNION ")}`,
    params: branches.flatMap((branch) => branch.params),
  };
}

function compileDirectoryChildrenCount(
  branches: DirectoryChildrenBranch[],
): { sql: string; params: Array<string | number> } {
  if (branches.length === 1) {
    const branch = branches[0]!;
    return {
      sql: `SELECT COUNT(*) AS n FROM ${DIRECTORY_CHILDREN_FROM} WHERE ${branch.where}`,
      params: branch.params,
    };
  }
  const parts = branches.map((branch) => `SELECT e.id FROM ${DIRECTORY_CHILDREN_FROM} WHERE ${branch.where}`);
  return {
    sql: `SELECT COUNT(*) AS n FROM (
    ${parts.join("\n    UNION\n    ")}
    ) AS directory_counts`,
    params: branches.flatMap((branch) => branch.params),
  };
}

function countDirectoryChildren(
  db: DatabaseSync,
  branches: DirectoryChildrenBranch[],
): number {
  const compiled = compileDirectoryChildrenCount(branches);
  return (db.prepare(compiled.sql).get(...compiled.params) as { n: number }).n;
}

function resolveDirectoryParent(
  db: DatabaseSync,
  libraryId: string,
  directory: string,
  parentId?: string,
): { parentId: string | null; parentPath: string | null } {
  const requestedId = parentId?.trim();
  if (requestedId && !requestedId.startsWith("virtual:")) {
    const byId = db.prepare(`SELECT e.id
         FROM entries e
         JOIN library_entries le ON le.entry_id = e.id
        WHERE e.id = ? AND le.library_id = ? AND le.tombstone = 0 AND e.tombstone = 0
        LIMIT 1`).get(requestedId, libraryId) as { id: string } | undefined;
    if (byId) return { parentId: byId.id, parentPath: null };
  }

  const candidates = directoryPathCandidates(directory);
  if (candidates.length > 0) {
    const placeholders = candidates.map(() => "?").join(", ");
    const byPath = db.prepare(`SELECT e.id FROM entries e
        JOIN library_entries le ON le.entry_id = e.id
        WHERE e.tombstone = 0 AND le.library_id = ? AND le.tombstone = 0
          AND e.path IN (${placeholders})
        LIMIT 1`).get(libraryId, ...candidates) as { id: string } | undefined;
    if (byPath) return { parentId: byPath.id, parentPath: null };
  }

  const slash = directory.replace(/\\/g, "/").replace(/\/+$/, "") || directory.replace(/\\/g, "/");
  const parentPath = /^[A-Za-z]:$/.test(slash) ? `${slash}/` : slash;
  return { parentId: null, parentPath };
}

export function listDirectoryChildren(
  db: DatabaseSync,
  libraryId: string,
  directory: string,
  options: { limit?: number; offset?: number; sort?: SearchSort; parentId?: string } = {},
): { hits: SearchEntryHit[]; total: number; hasMore: boolean; nextCursor?: string; elapsedMs: number } {
  const started = Date.now();
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("limit must be a positive integer");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("offset must be a non-negative integer");
  const sort = normalizeSort(options.sort);
  const lookup = resolveDirectoryParent(db, libraryId, directory, options.parentId);
  const queryChildren = (branches: DirectoryChildrenBranch[]) => {
    const compiled = compileDirectoryChildrenSelect(branches, sort, limit + 1, offset);
    return db.prepare(compiled.sql).all(...compiled.params) as SearchEntryHit[];
  };
  let countedBranches = directoryChildrenBranches(libraryId, lookup, directory);
  let rows = queryChildren(countedBranches);
  if (rows.length === 0 && lookup.parentId) {
    const pathValues = directoryParentPathEquals(directory, lookup.parentPath);
    if (pathValues.length > 0) {
      countedBranches = pathValues.map((value) => parentPathChildrenBranch(value, libraryId));
      rows = queryChildren(countedBranches);
    }
  }
  if (rows.length === 0) {
    const tried = new Set(directoryParentPathEquals(directory, lookup.parentPath));
    for (const variant of driveRootParentPathVariants(directory)) {
      if (tried.has(variant)) continue;
      countedBranches = [parentPathChildrenBranch(variant, libraryId)];
      rows = queryChildren(countedBranches);
      if (rows.length > 0) break;
    }
  }
  let synthesized = false;
  if (rows.length === 0) {
    rows = synthesizeMissingDirectoryChildren(db, libraryId, directory, sort, limit + 1, offset);
    synthesized = true;
  }
  const hasMore = rows.length > limit;
  const hits = hasMore ? rows.slice(0, limit) : rows;
  resolveHitLibraryIds(db, hits, libraryId);
  const total = synthesized
    ? countSynthesizedDirectoryChildren(db, libraryId, directory)
    : countDirectoryChildren(db, countedBranches);
  return {
    hits,
    total,
    hasMore,
    nextCursor: hasMore && hits.length > 0 ? encodeCursor(sort, hits[hits.length - 1]!) : undefined,
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
    const expressionResult = compileBooleanSafe(parsed.expression);
    if (!expressionResult.supported) {
      return [{ id: 0, parent: 0, notused: 0, detail: "RULE FILTER (in-memory)" }];
    }
    const expression = expressionResult.clause;
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
  parentId?: string,
): Array<{ id: number; parent: number; notused: number; detail: string }> {
  const lookup = resolveDirectoryParent(db, libraryId, directory, parentId);
  const compiled = compileDirectoryChildrenExplain(directoryChildrenBranches(libraryId, lookup, directory));
  return db.prepare(compiled.sql).all(...compiled.params) as Array<{
    id: number;
    parent: number;
    notused: number;
    detail: string;
  }>;
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
