import type { DatabaseSync } from "node:sqlite";
import {
  parseIntegerFilter,
  parseMtimeFilter,
  parseSearchQuery,
  parseSizeFilter,
  type ParsedSearchQuery,
  type SearchBooleanNode,
  type SearchComparisonFilter,
} from "./parse.ts";
import { gramsForName } from "./trigram.ts";

export type SearchEntriesRequest = {
  libraryId: string;
  text: string;
  limit?: number;
  offset?: number;
  kinds?: string[];
  scope?: "library" | "directory" | "selection";
  directory?: string;
  entryIds?: string[];
  sort?: SearchSort;
};

export type SearchEntryHit = {
  entryId: string;
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
  field?: "relevance" | "mtime" | "size" | "path" | "name";
  direction?: "asc" | "desc";
};

type SqlClause = {
  sql: string;
  params: Array<string | number>;
};

const DEFAULT_LIMIT = 200;
const SEARCH_SCOPES = new Set(["library", "directory", "selection"]);
const SORT_FIELDS = new Set(["relevance", "mtime", "size", "path", "name"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);
const HIT_SELECT = `
  SELECT
    e.id AS entryId,
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

function buildFilters(request: SearchEntriesRequest, parsed: ParsedSearchQuery): SqlClause {
  const scope = buildScopeFilters(request);
  const clauses = [scope.sql];
  const params = [...scope.params];

  if (parsed.ext && parsed.ext.length > 0) {
    const variants = parsed.ext.flatMap((ext) => {
      const bare = ext.replace(/^\.+/, "").toLowerCase();
      return [bare, `.${bare}`];
    });
    clauses.push(`lower(e.ext) IN (${variants.map(() => "?").join(", ")})`);
    params.push(...variants);
  }

  const kinds = resolveKinds(parsed.kind, request.kinds);
  const kind = kindClause(kinds);
  if (kind) {
    clauses.push(kind.sql);
    params.push(...kind.params);
  }

  if (parsed.parent) {
    clauses.push("e.parent_path LIKE '%' || ? || '%'");
    params.push(parsed.parent);
  }

  if (parsed.path) {
    clauses.push("(e.path LIKE '%' || ? || '%' OR e.rel_path LIKE '%' || ? || '%')");
    params.push(parsed.path, parsed.path);
  }

  appendComparison(clauses, params, "e.size", parsed.size);
  appendComparison(clauses, params, "e.mtime", parsed.mtime);
  appendComparison(clauses, params, "e.depth", parsed.depth);

  if (parsed.has) {
    clauses.push(subtitleExistsSql(parsed.has));
  }

  if (parsed.dup !== undefined) {
    clauses.push(duplicateExistsSql(parsed.dup));
  }

  return { sql: clauses.join(" AND "), params };
}

function buildScopeFilters(request: SearchEntriesRequest): SqlClause {
  const clauses = ["e.library_id = ?", "e.tombstone = 0"];
  const params: Array<string | number> = [request.libraryId];
  const scope = request.scope ?? "library";

  if (!SEARCH_SCOPES.has(scope)) {
    throw new Error(`unsupported search scope: ${scope}`);
  }

  if (scope === "directory") {
    if (!request.directory) {
      throw new Error("directory scope requires directory");
    }
    const directory = normalizeDirectory(request.directory);
    const prefix = `${directory}/`;
    clauses.push("(e.path = ? OR substr(e.path, 1, ?) = ?)");
    params.push(directory, prefix.length, prefix);
  } else if (scope === "selection") {
    const entryIds = (request.entryIds ?? []).filter(Boolean);
    if (entryIds.length === 0) {
      throw new Error("selection scope requires entryIds");
    }
    const placeholders = entryIds.map(() => "?").join(", ");
    clauses.push(`EXISTS (
      SELECT 1
      FROM entries selected
      WHERE selected.library_id = e.library_id
        AND selected.tombstone = 0
        AND selected.id IN (${placeholders})
        AND (
          e.path = selected.path
          OR substr(e.path, 1, length(selected.path) + 1) = selected.path || '/'
        )
    )`);
    params.push(...entryIds);
  }

  return { sql: clauses.join(" AND "), params };
}

function normalizeDirectory(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const directory = normalized.replace(/\/+$/, "") || normalized;
  if (!directory) {
    throw new Error("directory scope requires directory");
  }
  return directory;
}

function resolveKinds(parsedKind: string | undefined, requestKinds: string[] | undefined): string[] | null {
  const requested = (requestKinds ?? []).filter(Boolean);
  const parsedKinds = parsedKind?.split("|").map((kind) => kind.toLowerCase()).filter(Boolean) ?? [];
  if (parsedKinds.length > 0 && requested.length > 0) {
    return requested.filter((kind) => parsedKinds.includes(kind.toLowerCase()));
  }
  if (parsedKinds.length > 0) {
    return parsedKinds;
  }
  if (requested.length > 0) {
    return requested;
  }
  return null;
}

function kindClause(kinds: string[] | null): SqlClause | null {
  if (!kinds) {
    return null;
  }
  if (kinds.length === 0) {
    return { sql: "0", params: [] };
  }
  return {
    sql: `e.kind IN (${kinds.map(() => "?").join(", ")})`,
    params: kinds,
  };
}

function appendComparison(
  clauses: string[],
  params: Array<string | number>,
  column: string,
  filter: SearchComparisonFilter | undefined,
): void {
  if (!filter) {
    return;
  }
  if (filter.operator === "between") {
    if (filter.min === undefined || filter.max === undefined) {
      clauses.push("0");
      return;
    }
    clauses.push(`${column} BETWEEN ? AND ?`);
    params.push(filter.min, filter.max);
    return;
  }
  if (filter.value === undefined) {
    clauses.push("0");
    return;
  }
  const operators = {
    eq: "=",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  } as const;
  clauses.push(`${column} ${operators[filter.operator]} ?`);
  params.push(filter.value);
}

function subtitleExistsSql(feature: string): string {
  if (feature !== "subtitle") {
    return "0";
  }
  return `EXISTS (
    SELECT 1
    FROM entries sidecar
    WHERE sidecar.tombstone = 0
      AND sidecar.library_id = e.library_id
      AND sidecar.id <> e.id
      AND sidecar.parent_path IS e.parent_path
      AND sidecar.stem = e.stem
      AND lower(sidecar.ext) IN ('.srt', '.ass', '.ssa', '.vtt')
  )`;
}

function duplicateExistsSql(duplicate: boolean): string {
  const predicate = `EXISTS (
    SELECT 1
    FROM entries other
    WHERE other.library_id = e.library_id
      AND other.tombstone = 0
      AND e.is_dir = 0
      AND other.is_dir = 0
      AND other.id <> e.id
      AND e.hash_full IS NOT NULL
      AND other.hash_full = e.hash_full
  )`;
  return duplicate ? predicate : `NOT ${predicate}`;
}

function compileBoolean(node: SearchBooleanNode): SqlClause {
  if (node.type === "and" || node.type === "or") {
    const children = node.children.map((child) => compileBoolean(child));
    const separator = node.type === "and" ? " AND " : " OR ";
    return {
      sql: children.map((child) => `(${child.sql})`).join(separator),
      params: children.flatMap((child) => child.params),
    };
  }

  if (node.type === "text") {
    return {
      sql: "e.name LIKE '%' || ? || '%'",
      params: [node.value],
    };
  }

  return compileFilterNode(node);
}

function compileFilterNode(node: Extract<SearchBooleanNode, { type: "filter" }>): SqlClause {
  const value = node.values[0] ?? "";
  if (node.field === "ext") {
    const exts = node.values.map((item) => item.replace(/^\.+/, "").toLowerCase()).filter(Boolean);
    const variants = exts.flatMap((ext) => [ext, `.${ext}`]);
    return {
      sql: variants.length > 0 ? `lower(e.ext) IN (${variants.map(() => "?").join(", ")})` : "0",
      params: variants,
    };
  }
  if (node.field === "parent" || node.field === "dir") {
    return {
      sql: value ? "e.parent_path LIKE '%' || ? || '%'" : "0",
      params: value ? [value] : [],
    };
  }
  if (node.field === "kind" || node.field === "type") {
    return {
      sql: node.values.length > 0 ? `e.kind IN (${node.values.map(() => "?").join(", ")})` : "0",
      params: node.values,
    };
  }
  if (node.field === "path") {
    return {
      sql: value ? "(e.path LIKE '%' || ? || '%' OR e.rel_path LIKE '%' || ? || '%')" : "0",
      params: value ? [value, value] : [],
    };
  }
  if (node.field === "size" || node.field === "mtime" || node.field === "depth") {
    const filter =
      node.field === "size"
        ? parseSizeFilter(value)
        : node.field === "mtime"
          ? parseMtimeFilter(value)
          : parseIntegerFilter(value);
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    appendComparison(clauses, params, `e.${node.field}`, filter);
    return { sql: clauses[0] ?? "0", params };
  }
  if (node.field === "has") {
    return { sql: subtitleExistsSql(value.toLowerCase()), params: [] };
  }

  return { sql: duplicateExistsSql(value.toLowerCase() === "true"), params: [] };
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
