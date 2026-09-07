import type { DatabaseSync } from "node:sqlite";

const BUSY_TIMEOUT_MS = 5000;

export function applyPragmas(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA synchronous = NORMAL");
}
