import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./sql.ts";

export const CURRENT_SCHEMA_VERSION = 1;

export type Migration = {
  version: number;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: SCHEMA_SQL },
];

function hasMigrationsTable(db: DatabaseSync): boolean {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get() as { name: string } | undefined;
  return row != null;
}

export function getSchemaVersion(db: DatabaseSync): number {
  if (!hasMigrationsTable(db)) {
    return 0;
  }
  const row = db.prepare(`SELECT MAX(version) AS version FROM schema_migrations`).get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

export function applyMigrations(db: DatabaseSync): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const pending = MIGRATIONS.filter((migration) => migration.version > getSchemaVersion(db)).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)`).run(
        migration.version,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return getSchemaVersion(db);
}
