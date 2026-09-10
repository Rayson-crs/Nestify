import type { DatabaseSync } from "node:sqlite";
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

export function buildFilters(
  db: DatabaseSync,
  request: SearchEntriesRequest,
  parsed: ParsedSearchQuery,
  driveFromEntries = false,
): SqlClause {
  const scope = buildScopeFilters(request, driveFromEntries);
  const clauses = [scope.sql];
  const params = [...scope.params];

  if (parsed.ext && parsed.ext.length > 0) {
    const extension = extensionClause(db, parsed.ext);
    if (extension) {
      clauses.push(extension.sql);
      params.push(...extension.params);
    }
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

  appendDatePattern(clauses, params, "e.name", parsed.nameDate);
  appendDatePattern(clauses, params, "e.path", parsed.pathDate);
  appendDatePatternAny(clauses, params, parsed.datePattern);
  appendComparison(clauses, params, "length(e.stem)", parsed.nameLength);
  appendNameDigits(clauses, params, parsed.nameDigits);

  if (parsed.has) {
    clauses.push(subtitleExistsSql(parsed.has));
  }

  if (parsed.dup !== undefined) {
    clauses.push(duplicateExistsSql(parsed.dup));
  }

  return { sql: clauses.join(" AND "), params };
}

export function buildScopeFilters(request: SearchEntriesRequest, driveFromEntries = false): SqlClause {
  const isAllLibraries = request.libraryId === ALL_LIBRARIES_ID;
  const params: Array<string | number> = [];
  const clauses: string[] = [];
  if (driveFromEntries) {
    clauses.push(
      "e.tombstone = 0",
      `EXISTS (
        SELECT 1
        FROM library_entries membership
        WHERE membership.entry_id = e.id
          AND membership.tombstone = 0
          ${isAllLibraries ? "" : "AND membership.library_id = ?"}
      )`,
    );
    if (!isAllLibraries) params.push(request.libraryId);
  } else {
    clauses.push("le.tombstone = 0", "e.tombstone = 0");
    if (!isAllLibraries) {
      clauses.push("le.library_id = ?");
      params.push(request.libraryId);
    }
  }
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

function extensionClause(db: DatabaseSync, requested: string[]): SqlClause | null {
  const variants = new Set<string>();
  for (const raw of requested) {
    const bare = raw.replace(/^\.+/, "").toLowerCase();
    if (!bare) continue;
    variants.add(bare);
    variants.add(`.${bare}`);
  }
  if (variants.size === 0) return null;

  // Historical databases may store either "mkv" or ".mkv". Collapsing to the
  // stored variant lets SQLite satisfy ext equality plus name ordering from
  // idx_entries_active_ext_name without a temporary sort.
  const exists = db.prepare(
    "SELECT 1 AS hit FROM entries WHERE tombstone = 0 AND ext = ? LIMIT 1",
  );
  const present = [...variants].filter((value) => exists.get(value) != null);
  const values = present.length > 0 ? present : [...variants];
  if (values.length === 1) {
    return { sql: "e.ext = ?", params: values };
  }
  return { sql: `e.ext IN (${values.map(() => "?").join(", ")})`, params: values };
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
      sql: variants.length > 0 ? `e.ext IN (${variants.map(() => "?").join(", ")})` : "0",
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
    return kindClause(node.values) ?? { sql: "0", params: [] };
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
  if (node.field === "name_date") {
    return datePatternClause("e.name", value) ?? { sql: "0", params: [] };
  }
  if (node.field === "path_date") {
    return datePatternClause("e.path", value) ?? { sql: "0", params: [] };
  }
  if (node.field === "date_pattern") {
    const name = datePatternClause("e.name", value);
    const path = datePatternClause("e.path", value);
    if (!name || !path) return { sql: "0", params: [] };
    return { sql: `(${name.sql} OR ${path.sql})`, params: [...name.params, ...path.params] };
  }
  if (node.field === "name_length") {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    appendComparison(clauses, params, "length(e.stem)", parseIntegerFilter(value));
    return { sql: clauses[0] ?? "0", params };
  }
  if (node.field === "name_digits") {
    const value = node.values[0]?.toLowerCase();
    return value === "true"
      ? { sql: "e.stem <> '' AND e.stem NOT GLOB '*[^0-9]*'", params: [] }
      : value === "any"
        ? { sql: "e.stem GLOB '*[0-9]*'", params: [] }
        : { sql: "0", params: [] };
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
  const normalized = kinds.map((kind) => kind.toLowerCase());
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (normalized.includes("file")) {
    clauses.push("e.is_dir = 0");
  }
  if (normalized.includes("dir") || normalized.includes("folder")) {
    clauses.push("e.is_dir = 1");
  }
  const exactKinds = normalized.filter((kind) => kind !== "file" && kind !== "dir" && kind !== "folder");
  if (exactKinds.length > 0) {
    clauses.push(`e.kind IN (${exactKinds.map(() => "?").join(", ")})`);
    params.push(...exactKinds);
  }
  return clauses.length > 0 ? { sql: clauses.length === 1 ? clauses[0]! : `(${clauses.join(" OR ")})`, params } : { sql: "0", params: [] };
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

function appendDatePattern(
  clauses: string[],
  params: Array<string | number>,
  column: string,
  pattern: string | undefined,
): void {
  const clause = datePatternClause(column, pattern);
  if (!clause) return;
  clauses.push(clause.sql);
  params.push(...clause.params);
}

function appendDatePatternAny(
  clauses: string[],
  params: Array<string | number>,
  pattern: string | undefined,
): void {
  const name = datePatternClause("e.name", pattern);
  const path = datePatternClause("e.path", pattern);
  if (!name || !path) return;
  clauses.push(`(${name.sql} OR ${path.sql})`);
  params.push(...name.params, ...path.params);
}

function appendNameDigits(
  clauses: string[],
  params: Array<string | number>,
  mode: "true" | "any" | undefined,
): void {
  if (mode === "true") {
    clauses.push("e.stem <> '' AND e.stem NOT GLOB '*[^0-9]*'");
  } else if (mode === "any") {
    clauses.push("e.stem GLOB '*[0-9]*'");
  }
  void params;
}

function datePatternClause(column: string, pattern: string | undefined): SqlClause | null {
  if (!pattern) return null;
  const glob = patternToGlob(pattern);
  return glob ? { sql: `${column} GLOB ?`, params: [glob] } : { sql: "0", params: [] };
}

function patternToGlob(pattern: string): string | undefined {
  const value = pattern.trim();
  if (!value || !/[yY]/.test(value)) return undefined;
  let result = "*";
  for (let index = 0; index < value.length;) {
    const token = value[index]!;
    if (/[yY]/.test(token)) {
      let end = index + 1;
      while (end < value.length && /[yY]/.test(value[end]!)) end += 1;
      result += "[0-9]".repeat(end - index);
      index = end;
      continue;
    }
    if (/[mM]/.test(token)) {
      let end = index + 1;
      while (end < value.length && /[mM]/.test(value[end]!)) end += 1;
      result += "[0-9]".repeat(end - index);
      index = end;
      continue;
    }
    if (/[dD]/.test(token)) {
      let end = index + 1;
      while (end < value.length && /[dD]/.test(value[end]!)) end += 1;
      result += "[0-9]".repeat(end - index);
      index = end;
      continue;
    }
    if (/[hHsS]/.test(token)) {
      let end = index + 1;
      while (end < value.length && /[hHsS]/.test(value[end]!)) end += 1;
      result += "[0-9]".repeat(end - index);
      index = end;
      continue;
    }
    if (/[\[\]*?]/.test(token)) result += `[${token}]`;
    else result += token.toLowerCase();
    index += 1;
  }
  return `${result}*`;
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
