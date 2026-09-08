import type { DatabaseSync } from "node:sqlite";
import type { SQLWrapper } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema.ts";

type SqlValue = null | number | bigint | string | Uint8Array;
type PlannedQuery = { sql: string; params: readonly unknown[] };

const queryFactory = drizzle(
  async () => {
    throw new Error("Drizzle queries must be executed through runOrm/allOrm");
  },
  { schema },
);

export type OrmQueryFactory = typeof queryFactory;

export function orm(): OrmQueryFactory {
  return queryFactory;
}

export function allOrm<TRow>(db: DatabaseSync, query: SQLWrapper): TRow[] {
  const planned = planQuery(query);
  return db.prepare(planned.sql).all(...toBindings(planned.params)) as TRow[];
}

export function getOrm<TRow>(db: DatabaseSync, query: SQLWrapper): TRow | undefined {
  return allOrm<TRow>(db, query)[0];
}

export function runOrm(db: DatabaseSync, query: SQLWrapper): { changes: number } {
  const planned = planQuery(query);
  const result = db.prepare(planned.sql).run(...toBindings(planned.params));
  return { changes: Number(result.changes) };
}

function planQuery(query: SQLWrapper): PlannedQuery {
  if (!("toSQL" in query) || typeof query.toSQL !== "function") {
    throw new TypeError("Drizzle query does not expose SQL");
  }
  const planned = query.toSQL();
  if (typeof planned.sql !== "string" || !Array.isArray(planned.params)) {
    throw new TypeError("Drizzle query produced invalid SQL");
  }
  return planned;
}

function toBindings(params: readonly unknown[]): SqlValue[] {
  return params.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
      return value;
    }
    if (value instanceof Uint8Array) return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    throw new TypeError(`unsupported SQLite binding: ${typeof value}`);
  });
}
