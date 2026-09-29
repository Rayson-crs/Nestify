import type { DatabaseSync } from "node:sqlite";

export interface SqliteBusyRetryOptions {
  attempts?: number;
  delayMs?: number;
  busyTimeoutMs?: number;
  onRetry?: (error: unknown, attempt: number) => void;
}

export async function retrySqliteBusy<T>(
  db: DatabaseSync,
  operation: () => T,
  options: SqliteBusyRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? 3));
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 25));
  const busyTimeoutMs = Math.max(0, Math.trunc(options.busyTimeoutMs ?? 25));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return withBusyTimeout(db, busyTimeoutMs, operation);
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= attempts) throw error;
      options.onRetry?.(error, attempt);
      await delay(delayMs * attempt);
    }
  }
}

export function isSqliteBusyError(error: unknown): boolean {
  const value = error as { code?: unknown; errcode?: unknown; message?: unknown } | null;
  const code = typeof value?.code === "string" ? value.code.toUpperCase() : "";
  const message = typeof value?.message === "string" ? value.message.toLowerCase() : String(error).toLowerCase();
  return code === "SQLITE_BUSY"
    || code === "SQLITE_BUSY_SNAPSHOT"
    || value?.errcode === 5
    || message.includes("database is locked")
    || message.includes("database table is locked")
    || message.includes("sqlite_busy");
}

function withBusyTimeout<T>(db: DatabaseSync, timeoutMs: number, operation: () => T): T {
  const row = db.prepare("PRAGMA busy_timeout").get() as { timeout?: number } | undefined;
  const previousTimeout = Math.max(0, Math.trunc(row?.timeout ?? 0));
  db.exec(`PRAGMA busy_timeout = ${timeoutMs}`);
  try {
    return operation();
  } finally {
    db.exec(`PRAGMA busy_timeout = ${previousTimeout}`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
