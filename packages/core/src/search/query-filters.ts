import {
  parseIntegerFilter,
  parseMtimeFilter,
  parseSizeFilter,
  type ParsedSearchQuery,
  type SearchBooleanNode,
  type SearchComparisonFilter,
} from "./parse.ts";
import type { SearchEntriesRequest } from "./query-types.ts";

export type SqlClause = {
  sql: string;
  params: Array<string | number>;
};

export const ALL_LIBRARIES_ID = "__all__";
export const SEARCH_SCOPES = new Set(["library", "directory", "selection"]);

export function buildFilters(request: SearchEntriesRequest, parsed: ParsedSearchQuery): SqlClause {
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

export function buildScopeFilters(request: SearchEntriesRequest): SqlClause {
  const isAllLibraries = request.libraryId === ALL_LIBRARIES_ID;
  const clauses = ["e.tombstone = 0"];
  const params: Array<string | number> = [];
  clauses.push(`EXISTS (
    SELECT 1
    FROM library_entries membership
    WHERE membership.entry_id = e.id
      AND membership.tombstone = 0
      ${isAllLibraries ? "" : "AND membership.library_id = ?"}
  )`);
  if (!isAllLibraries) params.push(request.libraryId);
  const scope = request.scope ?? "library";

  if (!SEARCH_SCOPES.has(scope)) {
    throw new Error(`unsupported search scope: ${scope}`);
  }

  if (scope === "directory") {
    if (!request.directory) {
      throw new Error("directory scope requires directory");
    }
    const directory = normalizeDirectory(request.directory);
    const normalizedPath = "replace(e.path, '\\', '/')";
    if (request.directChildren) {
      clauses.push("replace(coalesce(e.parent_path, ''), '\\', '/') = ?");
      params.push(directory);
      return { sql: clauses.join(" AND "), params };
    }
    const prefix = directory.endsWith("/") ? directory : `${directory}/`;
    clauses.push(`(${normalizedPath} = ? OR substr(${normalizedPath}, 1, ?) = ?)`);
    params.push(directory, prefix.length, prefix);
  } else if (scope === "selection") {
    const entryIds = (request.entryIds ?? []).filter(Boolean);
    if (entryIds.length === 0) {
      throw new Error("selection scope requires entryIds");
    }
    const placeholders = entryIds.map(() => "?").join(", ");
    clauses.push(`(
      e.id IN (${placeholders})
      OR EXISTS (
        SELECT 1
        FROM entries selected
        WHERE selected.id IN (${placeholders})
          AND selected.tombstone = 0
          AND (
            e.path = selected.path
            OR substr(e.path, 1, length(selected.path) + 1) = selected.path || '/'
          )
      )
    )`);
    params.push(...entryIds);
    params.push(...entryIds);
  }

  return { sql: clauses.join(" AND "), params };
}

export function compileBoolean(node: SearchBooleanNode): SqlClause {
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

export function resolveKinds(parsedKind: string | undefined, requestKinds: string[] | undefined): string[] | null {
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

export function kindClause(kinds: string[] | null): SqlClause | null {
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

function normalizeDirectory(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const directory = normalized.replace(/\/+$/, "") || normalized;
  if (!directory) {
    throw new Error("directory scope requires directory");
  }
  if (/^[A-Za-z]:$/.test(directory)) {
    return `${directory}/`;
  }
  return directory;
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
    WHERE other.tombstone = 0
      AND e.is_dir = 0
      AND other.is_dir = 0
      AND other.id <> e.id
      AND e.hash_full IS NOT NULL
      AND other.hash_full = e.hash_full
  )`;
  return duplicate ? predicate : `NOT ${predicate}`;
}
