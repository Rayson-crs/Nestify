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
  appendComparison(clauses, params, "e.ctime", parsed.ctime);
  appendComparison(clauses, params, "e.depth", parsed.depth);
  appendComparison(clauses, params, "e.child_count", parsed.childCount);
  appendComparison(clauses, params, "e.file_count", parsed.fileCount);
  appendComparison(clauses, params, "e.dir_count", parsed.dirCount);

  appendDatePattern(clauses, params, "e.name", parsed.nameDate);
  appendDatePattern(clauses, params, "e.path", parsed.pathDate);
  appendDatePatternAny(clauses, params, parsed.datePattern);
  appendComparison(clauses, params, "length(e.stem)", parsed.nameLength);
  appendNameDigits(clauses, params, parsed.nameDigits);

  if (parsed.has) {
    clauses.push(sidecarExistsSql(parsed.has));
  }

  if (parsed.missing) {
    clauses.push(missingSidecarSql(parsed.missing));
  }

  if (parsed.dup !== undefined) {
    clauses.push(duplicateExistsSql(parsed.dup));
  }

  if (parsed.uniqueVideo !== undefined) {
    clauses.push(uniqueVideoSql(parsed.uniqueVideo));
  }

  if (parsed.isSidecar !== undefined) {
    clauses.push(isSidecarSql(parsed.isSidecar));
  }

  if (parsed.windowsIllegal !== undefined) {
    clauses.push(windowsIllegalSql(parsed.windowsIllegal));
  }

  if (parsed.usefulFileCount) {
    appendComparison(clauses, params, usefulFileCountSql(), parsed.usefulFileCount);
  }

  if (parsed.sameStem !== undefined) {
    clauses.push(sameStemSql(parsed.sameStem));
  }

  if (parsed.orphanSidecar !== undefined) {
    clauses.push(orphanSidecarSql(parsed.orphanSidecar));
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
  if (node.type === "not") {
    const child = compileBoolean(node.child);
    return { sql: `NOT (${child.sql})`, params: child.params };
  }
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
  if (node.field === "size" || node.field === "mtime" || node.field === "ctime" || node.field === "depth") {
    const filter =
      node.field === "size"
        ? parseSizeFilter(value)
        : node.field === "depth"
          ? parseIntegerFilter(value)
          : parseMtimeFilter(value);
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    appendComparison(clauses, params, `e.${node.field}`, filter);
    return { sql: clauses[0] ?? "0", params };
  }
  if (node.field === "child_count" || node.field === "file_count" || node.field === "dir_count") {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    appendComparison(clauses, params, `e.${node.field}`, parseIntegerFilter(value));
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
    return { sql: sidecarExistsSql(value.toLowerCase()), params: [] };
  }
  if (node.field === "missing") {
    return { sql: missingSidecarSql(value.toLowerCase()), params: [] };
  }
  if (node.field === "unique_video") {
    return { sql: uniqueVideoSql(value.toLowerCase() === "true"), params: [] };
  }
  if (node.field === "is_sidecar") {
    return { sql: isSidecarSql(value.toLowerCase() === "true"), params: [] };
  }
  if (node.field === "windows_illegal") {
    return { sql: windowsIllegalSql(value.toLowerCase() === "true"), params: [] };
  }
  if (node.field === "useful_file_count") {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    appendComparison(clauses, params, usefulFileCountSql(), parseIntegerFilter(value));
    return { sql: clauses[0] ?? "0", params };
  }
  if (node.field === "same_stem") {
    return { sql: sameStemSql(value.toLowerCase() === "true"), params: [] };
  }
  if (node.field === "orphan_sidecar") {
    return { sql: orphanSidecarSql(value.toLowerCase() === "true"), params: [] };
  }
  if (node.field === "dup") {
    return { sql: duplicateExistsSql(value.toLowerCase() === "true"), params: [] };
  }

  return { sql: "0", params: [] };
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

const SUBTITLE_EXTS = [".srt", ".ass", ".ssa", ".vtt"];
const COVER_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"];
const COVER_STEMS = [
  "cover",
  "poster",
  "folder",
  "fanart",
  "backdrop",
  "thumb",
  "front",
  "back",
  "disc",
  "banner",
];

function sidecarExistsSql(feature: string): string {
  const predicate = sidecarSiblingPredicate(feature);
  return predicate ? `EXISTS (${predicate})` : "0";
}

function missingSidecarSql(feature: string): string {
  const predicate = sidecarSiblingPredicate(feature);
  return predicate ? `NOT EXISTS (${predicate})` : "0";
}

function sidecarSiblingPredicate(feature: string): string | null {
  const sameFolder = `
    sidecar.tombstone = 0
      AND sidecar.id <> e.id
      AND sidecar.is_dir = 0
      AND (
        sidecar.parent_id = e.parent_id
        OR sidecar.parent_path IS e.parent_path
      )
  `;
  if (feature === "subtitle") {
    return `
    SELECT 1
    FROM entries sidecar
    WHERE ${sameFolder}
      AND sidecar.stem = e.stem
      AND ${extInSql("sidecar.ext", SUBTITLE_EXTS)}
  `;
  }
  if (feature === "nfo") {
    return `
    SELECT 1
    FROM entries sidecar
    WHERE ${sameFolder}
      AND sidecar.stem = e.stem
      AND ${extInSql("sidecar.ext", [".nfo"])}
  `;
  }
  if (feature === "cover") {
    return `
    SELECT 1
    FROM entries sidecar
    WHERE ${sameFolder}
      AND ${extInSql("sidecar.ext", COVER_EXTS)}
      AND (
        lower(sidecar.stem) IN (${sqlStringList(COVER_STEMS)})
        OR sidecar.stem = e.stem
      )
  `;
  }
  if (feature === "sidecar") {
    return `
    SELECT 1
    FROM entries sidecar
    WHERE ${sameFolder}
      AND (
        (sidecar.stem = e.stem AND ${extInSql("sidecar.ext", SUBTITLE_EXTS)})
        OR (sidecar.stem = e.stem AND ${extInSql("sidecar.ext", [".nfo"])})
        OR (
          ${extInSql("sidecar.ext", COVER_EXTS)}
          AND (
            lower(sidecar.stem) IN (${sqlStringList(COVER_STEMS)})
            OR sidecar.stem = e.stem
          )
        )
      )
  `;
  }
  return null;
}

function uniqueVideoSql(wanted: boolean): string {
  const predicate = `(
    e.is_dir = 1
    AND (
      SELECT COUNT(*)
      FROM entries child
      WHERE child.tombstone = 0
        AND child.is_dir = 0
        AND child.kind = 'video'
        AND (
          child.parent_id = e.id
          OR child.parent_path IS e.path
        )
    ) = 1
  )`;
  return wanted ? predicate : `NOT ${predicate}`;
}

function isSidecarSql(wanted: boolean): string {
  const sameFolderVideo = `
    video.tombstone = 0
      AND video.is_dir = 0
      AND video.kind = 'video'
      AND (
        video.parent_id = e.parent_id
        OR video.parent_path IS e.parent_path
      )
  `;
  const predicate = `(
    e.is_dir = 0
    AND (
      e.kind = 'subtitle'
      OR ${extInSql("e.ext", [".nfo"])}
      OR (
        (e.kind = 'image' OR ${extInSql("e.ext", COVER_EXTS)})
        AND EXISTS (
          SELECT 1
          FROM entries video
          WHERE ${sameFolderVideo}
            AND (
              lower(e.stem) IN (${sqlStringList(COVER_STEMS)})
              OR video.stem = e.stem
            )
        )
      )
    )
  )`;
  return wanted ? predicate : `NOT ${predicate}`;
}

function windowsIllegalSql(wanted: boolean): string {
  const predicate = `(
    e.name GLOB '*[<>:"|?*]*'
    OR e.name GLOB '*.'
    OR e.name GLOB '* '
  )`;
  return wanted ? predicate : `NOT ${predicate}`;
}

function usefulFileCountSql(): string {
  return `(
    SELECT COUNT(*)
    FROM entries child
    WHERE child.tombstone = 0
      AND child.is_dir = 0
      AND (
        child.parent_id = e.id
        OR child.parent_path IS e.path
      )
      AND NOT (
        child.kind = 'subtitle'
        OR ${extInSql("child.ext", [".nfo"])}
        OR (
          (child.kind = 'image' OR ${extInSql("child.ext", COVER_EXTS)})
          AND (
            lower(child.stem) IN (${sqlStringList(COVER_STEMS)})
            OR EXISTS (
              SELECT 1
              FROM entries sibling
              WHERE sibling.tombstone = 0
                AND sibling.is_dir = 0
                AND sibling.kind = 'video'
                AND (
                  sibling.parent_id = child.parent_id
                  OR sibling.parent_path IS child.parent_path
                )
            )
          )
        )
      )
  )`;
}

function sameStemSql(wanted: boolean): string {
  const predicate = `EXISTS (
    SELECT 1
    FROM entries sibling
    WHERE sibling.tombstone = 0
      AND sibling.id <> e.id
      AND sibling.is_dir = 0
      AND e.is_dir = 0
      AND sibling.stem = e.stem
      AND (
        sibling.parent_id = e.parent_id
        OR sibling.parent_path IS e.parent_path
      )
  )`;
  return wanted ? predicate : `NOT ${predicate}`;
}

function orphanSidecarSql(wanted: boolean): string {
  const sameFolder = `
    sibling.tombstone = 0
      AND sibling.id <> e.id
      AND sibling.is_dir = 0
      AND (
        sibling.parent_id = e.parent_id
        OR sibling.parent_path IS e.parent_path
      )
  `;
  const isSubtitleOrNfo = `(e.kind = 'subtitle' OR ${extInSql("e.ext", [".nfo"])})`;
  const isCoverStem = `(
    (e.kind = 'image' OR ${extInSql("e.ext", COVER_EXTS)})
    AND lower(e.stem) IN (${sqlStringList(COVER_STEMS)})
  )`;
  const isSameStemImage = `(
    (e.kind = 'image' OR ${extInSql("e.ext", COVER_EXTS)})
    AND lower(e.stem) NOT IN (${sqlStringList(COVER_STEMS)})
  )`;
  const hasSameStemMain = `EXISTS (
    SELECT 1
    FROM entries sibling
    WHERE ${sameFolder}
      AND sibling.stem = e.stem
      AND sibling.kind <> 'subtitle'
      AND NOT ${extInSql("sibling.ext", [".nfo"])}
      AND NOT (
        (sibling.kind = 'image' OR ${extInSql("sibling.ext", COVER_EXTS)})
        AND lower(sibling.stem) IN (${sqlStringList(COVER_STEMS)})
      )
  )`;
  const hasFolderVideo = `EXISTS (
    SELECT 1
    FROM entries sibling
    WHERE ${sameFolder}
      AND sibling.kind = 'video'
  )`;
  const predicate = `(
    e.is_dir = 0
    AND (
      (${isSubtitleOrNfo} AND NOT ${hasSameStemMain})
      OR (${isCoverStem} AND NOT ${hasFolderVideo})
      OR (${isSameStemImage} AND NOT ${hasSameStemMain})
    )
  )`;
  return wanted ? predicate : `NOT ${predicate}`;
}

function extInSql(column: string, exts: readonly string[]): string {
  const values = exts.flatMap((ext) => {
    const bare = ext.replace(/^\.+/, "").toLowerCase();
    return [bare, "." + bare];
  });
  return "lower(" + column + ") IN (" + sqlStringList(values) + ")";
}

function sqlStringList(values: readonly string[]): string {
  return values.map((value) => "'" + value.replaceAll("'", "''") + "'").join(", ");
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
