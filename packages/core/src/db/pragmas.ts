import type { DatabaseSync } from "node:sqlite";

const BUSY_TIMEOUT_MS = 5000;

import type { DatabaseLogFunction } from "./open.ts";

export function applyPragmas(db: DatabaseSync, log?: DatabaseLogFunction): void {
  const statements = [
    "PRAGMA foreign_keys = ON",
    "PRAGMA journal_mode = WAL",
    `PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`,
    "PRAGMA synchronous = NORMAL",
  ];

  for (const statement of statements) {
    const startedAt = Date.now();
    log?.("db.pragma.start", { statement });
    db.exec(statement);
    log?.("db.pragma.finished", {
      statement,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
