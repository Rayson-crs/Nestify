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
import { gramsForName } from "./trigram.ts";

export { ALL_LIBRARIES_ID } from "./query-filters.ts";
export type {
  SearchEntriesRequest,
  SearchEntriesResult,
  SearchEntryHit,
  SearchSort,
} from "./query-types.ts";

const DEFAULT_LIMIT = 200;
const SORT_FIELDS = new Set(["relevance", "mtime", "size", "path", "name", "path_mtime"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);
const HIT_SELECT = `
  SELECT
    e.id AS entryId,
    coalesce((
      SELECT membership.library_id
      FROM library_entries membership
      WHERE membership.entry_id = e.id
        AND membership.tombstone = 0
      ORDER BY membership.library_id
      LIMIT 1
    ), e.library_id) AS libraryId,
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
  const sort = normalizeSort(request.sort);
  const textTokens = textSources(parsed);
  const hasText = textTokens.length > 0;
  const hasLong = textTokens.some((token) => token.length >= 3);

  const finish = (rows: { hits: SearchEntryHit[]; total: number }): SearchEntriesResult => ({
    hits: rows.hits,
    total: rows.total,
    elapsedMs: Date.now() - started,
  });

  if (parsed.expression) {
    const scope = buildScopeFilters(request);
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
        "",
        sort,
      ),
    );
  }

  const filters = buildFilters(request, parsed);

  if (!hasText) {
    return finish(executeSearch(db, filters, limit, offset, "", sort));
  }

  if (hasLong) {
    const match = buildFtsMatch(parsed);
    if (match) {
      try {
        const fts = executeSearch(
          db,
          {
            sql: `entry_fts MATCH ? AND ${filters.sql}`,
            params: [match, ...filters.params],
          },
          limit,
          offset,
          "JOIN entry_fts ON entry_fts.rowid = e.rowid",
          sort,
        );
        if (fts.total > 0) {
          return finish(fts);
        }
      } catch {
        return finish(executeSearch(db, withLike(filters, parsed), limit, offset, "", sort));
      }
    }
  }

  const grams = queryGrams(parsed);
  if (grams.length > 0) {
    const trigram = executeSearch(db, withTrigrams(filters, grams), limit, offset, "", sort);
    if (trigram.total > 0) {
      return finish(trigram);
    }
  }

  return finish(executeSearch(db, withLike(filters, parsed), limit, offset, "", sort));
}

function executeSearch(
  db: DatabaseSync,
  where: SqlClause,
  limit: number,
  offset: number,
  joinSql = "",
  sort: NormalizedSort = { field: "name", direction: "asc" },
): { hits: SearchEntryHit[]; total: number } {
  const from = joinSql ? `entries e ${joinSql}` : "entries e";
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE ${where.sql}`)
    .get(...where.params) as { n: number };
  const hits = db
    .prepare(
      `${HIT_SELECT}
       FROM ${from}
       WHERE ${where.sql}
       ORDER BY ${orderSql(sort, Boolean(joinSql))}
       LIMIT ? OFFSET ?`,
    )
    .all(...where.params, limit, offset) as SearchEntryHit[];
  return { hits, total: totalRow.n };
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
    return hasFts ? `bm25(entry_fts) ${direction}` : `e.name COLLATE NOCASE ${direction}`;
  }
  if (sort.field === "path_mtime") {
    return `e.is_dir DESC, e.parent_path COLLATE NOCASE ${direction}, e.mtime ${
      direction === "ASC" ? "DESC" : "ASC"
    }, e.name COLLATE NOCASE ASC`;
  }
  const columns = {
    mtime: "e.mtime",
    size: "e.size",
    path: "e.path COLLATE NOCASE",
    name: "e.name COLLATE NOCASE",
  } as const;
  return `${columns[sort.field]} ${direction}, e.name COLLATE NOCASE ASC`;
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

function withTrigrams(filters: SqlClause, grams: string[]): SqlClause {
  const placeholders = grams.map(() => "?").join(", ");
  return {
    sql: `${filters.sql} AND e.id IN (
      SELECT nt.entry_id
      FROM name_trigrams nt
      WHERE nt.gram IN (${placeholders})
      GROUP BY nt.entry_id
      HAVING COUNT(DISTINCT nt.gram) = ?
    )`,
    params: [...filters.params, ...grams, grams.length],
  };
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

function queryGrams(parsed: ParsedSearchQuery): string[] {
  const grams = new Set<string>();
  for (const source of textSources(parsed)) {
    for (const gram of gramsForName(source)) {
      grams.add(gram);
    }
  }
  return [...grams];
}
