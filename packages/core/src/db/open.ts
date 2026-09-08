import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations } from "./migrations.ts";
import { applyPragmas } from "./pragmas.ts";

export type DatabaseLogFunction = (event: string, details?: unknown) => void;

export function openDatabase(path: string, log?: DatabaseLogFunction): DatabaseSync {
  if (path !== ":memory:") {
    log?.("db.ensure-directory.start", { path });
    mkdirSync(dirname(path), { recursive: true });
    log?.("db.ensure-directory.finished", { path });
  }

  log?.("db.constructor.start", { path });
  const db = new DatabaseSync(path);
  log?.("db.constructor.finished", { path });
  applyPragmas(db, log);
  applyMigrations(db, log);
  return db;
}
