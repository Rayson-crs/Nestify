import type { DatabaseSync } from "node:sqlite";

export type DatabaseMaintenanceResult = {
  analyzeMs: number;
  optimizeMs: number;
};

/**
 * Run planner maintenance outside the startup critical path. SQLite keeps
 * the resulting statistics in the database, so callers should schedule this
 * during idle time or after a sufficiently large indexing batch.
 */
export function maintainDatabase(db: DatabaseSync): DatabaseMaintenanceResult {
  const analyzeStartedAt = Date.now();
  db.exec("ANALYZE");
  const optimizeStartedAt = Date.now();
  db.exec("PRAGMA optimize");
  return {
    analyzeMs: optimizeStartedAt - analyzeStartedAt,
    optimizeMs: Date.now() - optimizeStartedAt,
  };
}
