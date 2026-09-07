import type { DatabaseSync } from "node:sqlite";
import { parseSearchQuery, type ParsedSearchQuery } from "./parse.ts";
import { gramsForName } from "./trigram.ts";

export type SearchEntriesRequest = {
  libraryId: string;
  text: string;
  limit?: number;
  offset?: number;
  kinds?: string[];
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

type SqlClause = {
  sql: string;
  params: Array<string | number>;
};

const DEFAULT_LIMIT = 200;
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
  const limit = request.limit ?? DEFAULT_LIMIT;
  const offset = request.offset ?? 0;
  const filters = buildFilters(request.libraryId, parsed, request.kinds);
  const textTokens = textSources(parsed);
  const hasText = textTokens.length > 0;
  const hasLong = textTokens.some((token) => token.length >= 3);

  const finish = (rows: { hits: SearchEntryHit[]; total: number }): SearchEntriesResult => ({
    hits: rows.hits,
    total: rows.total,
    elapsedMs: Date.now() - started,
  });

  if (!hasText) {
    return finish(executeSearch(db, filters, limit, offset));
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
        );
        if (fts.total > 0) {
          return finish(fts);
        }
      } catch {
        return finish(executeSearch(db, withLike(filters, parsed), limit, offset));
      }
    }
  }

  const grams = queryGrams(parsed);
  if (grams.length > 0) {
    const trigram = executeSearch(db, withTrigrams(filters, grams), limit, offset);
    if (trigram.total > 0) {
      return finish(trigram);
    }
  }

  return finish(executeSearch(db, withLike(filters, parsed), limit, offset));
}

function executeSearch(
  db: DatabaseSync,
  where: SqlClause,
  limit: number,
  offset: number,
  joinSql = "",
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
       ORDER BY e.name COLLATE NOCASE
       LIMIT ? OFFSET ?`,
    )
    .all(...where.params, limit, offset) as SearchEntryHit[];
  return { hits, total: totalRow.n };
}

function buildFilters(
  libraryId: string,
  parsed: ParsedSearchQuery,
  requestKinds: string[] | undefined,
): SqlClause {
  const clauses = ["e.library_id = ?", "e.tombstone = 0"];
  const params: Array<string | number> = [libraryId];

  if (parsed.ext && parsed.ext.length > 0) {
    const variants = parsed.ext.flatMap((ext) => {
      const bare = ext.replace(/^\.+/, "").toLowerCase();
      return [bare, `.${bare}`];
    });
    clauses.push(`lower(e.ext) IN (${variants.map(() => "?").join(", ")})`);
    params.push(...variants);
  }

  const kinds = resolveKinds(parsed.kind, requestKinds);
  if (kinds) {
    if (kinds.length === 0) {
      clauses.push("0");
    } else {
      clauses.push(`e.kind IN (${kinds.map(() => "?").join(", ")})`);
      params.push(...kinds);
    }
  }

  if (parsed.parent) {
    clauses.push("e.parent_path LIKE '%' || ?");
    params.push(parsed.parent);
  }

  if (parsed.path) {
    clauses.push("(e.path LIKE '%' || ? || '%' OR e.rel_path LIKE '%' || ? || '%')");
    params.push(parsed.path, parsed.path);
  }

  return { sql: clauses.join(" AND "), params };
}

function resolveKinds(parsedKind: string | undefined, requestKinds: string[] | undefined): string[] | null {
  const requested = (requestKinds ?? []).filter(Boolean);
  if (parsedKind && requested.length > 0) {
    return requested.filter((kind) => kind === parsedKind);
  }
  if (parsedKind) {
    return [parsedKind];
  }
  if (requested.length > 0) {
    return requested;
  }
  return null;
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
