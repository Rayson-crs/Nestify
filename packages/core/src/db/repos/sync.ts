import type { DatabaseSync } from "node:sqlite";

export type SyncWatcherState = "starting" | "watching" | "dirty" | "stopped" | "error";
export type ChangeEventType = "create" | "change" | "delete" | "rename" | "reconcile";
export type ChangeQueueStatus = "pending" | "processing" | "completed" | "failed" | "dead-letter";

export type ChangeQueueItem = {
  id: number;
  libraryId: string;
  eventType: ChangeEventType;
  path: string;
  oldPath: string | null;
  observedAt: number;
  generation: number;
  status: ChangeQueueStatus;
  retryCount: number;
  lastError: string | null;
  processedAt: number | null;
};

export type SyncState = {
  libraryId: string;
  generation: number;
  lastEventId: number | null;
  lastReconcileAt: number | null;
  lastSuccessAt: number | null;
  watcherState: SyncWatcherState;
  dirty: boolean;
  updatedAt: number;
};

const MAX_RETRIES = 8;

export function getSyncState(db: DatabaseSync, libraryId: string): SyncState {
  const row = db.prepare(`SELECT * FROM sync_state WHERE library_id = ?`).get(libraryId) as Record<string, unknown> | undefined;
  if (row) return mapSyncState(row);
  const now = Date.now();
  db.prepare(`INSERT INTO sync_state(library_id, updated_at) VALUES (?, ?)`).run(libraryId, now);
  return {
    libraryId,
    generation: 0,
    lastEventId: null,
    lastReconcileAt: null,
    lastSuccessAt: null,
    watcherState: "starting",
    dirty: false,
    updatedAt: now,
  };
}

export function updateSyncState(
  db: DatabaseSync,
  libraryId: string,
  patch: Partial<Omit<SyncState, "libraryId">>,
): SyncState {
  const current = getSyncState(db, libraryId);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  db.prepare(`UPDATE sync_state SET generation = ?, last_event_id = ?, last_reconcile_at = ?, last_success_at = ?, watcher_state = ?, dirty = ?, updated_at = ? WHERE library_id = ?`).run(
    next.generation,
    next.lastEventId,
    next.lastReconcileAt,
    next.lastSuccessAt,
    next.watcherState,
    next.dirty ? 1 : 0,
    next.updatedAt,
    libraryId,
  );
  return next;
}

export type ChangeQueueInput = Omit<ChangeQueueItem, "id" | "status" | "retryCount" | "lastError" | "processedAt" | "oldPath"> & { oldPath?: string | null };

export function enqueueChanges(
  db: DatabaseSync,
  input: readonly ChangeQueueInput[],
): number[] {
  if (input.length === 0) return [];
  const insert = db.prepare(`INSERT INTO change_queue(library_id, event_type, path, old_path, observed_at, generation) VALUES (?, ?, ?, ?, ?, ?)`);
  const findPending = db.prepare(`SELECT * FROM change_queue WHERE library_id = ? AND path = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`);
  const mergePending = db.prepare(`UPDATE change_queue SET event_type = ?, old_path = ?, observed_at = ?, generation = ? WHERE id = ?`);
  const ids: number[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of input) {
      const path = normalizeChangePath(item.path);
      const oldPath = item.oldPath ? normalizeChangePath(item.oldPath) : null;
      const pending = findPending.get(item.libraryId, path) as Record<string, unknown> | undefined;
      if (pending) {
        const merged = mergeEvent(
          String(pending.event_type) as ChangeEventType,
          item.eventType,
        );
        mergePending.run(
          merged,
          oldPath ?? (pending.old_path == null ? null : String(pending.old_path)),
          Math.max(Number(pending.observed_at), item.observedAt),
          Math.max(Number(pending.generation), item.generation),
          Number(pending.id),
        );
        ids.push(Number(pending.id));
        continue;
      }
      const result = insert.run(item.libraryId, item.eventType, path, oldPath, item.observedAt, item.generation);
      ids.push(Number(result.lastInsertRowid));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return ids;
}

export function enqueueChange(
  db: DatabaseSync,
  item: ChangeQueueInput,
): number {
  return enqueueChanges(db, [item])[0]!;
}

export function claimChanges(db: DatabaseSync, limit = 128, libraryId?: string): ChangeQueueItem[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("limit must be a positive integer");
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(
      `SELECT * FROM change_queue WHERE status = 'pending' ${libraryId ? "AND library_id = ?" : ""} ORDER BY id LIMIT ?`,
    ).all(...(libraryId ? [libraryId, limit] : [limit])) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      db.exec("COMMIT");
      return [];
    }
    const ids = rows.map((row) => Number(row.id));
    const update = db.prepare(`UPDATE change_queue SET status = 'processing' WHERE id = ? AND status = 'pending'`);
    for (const id of ids) {
      const result = update.run(id);
      if (Number(result.changes) !== 1) {
        throw new Error(`failed to claim change queue item: ${id}`);
      }
    }
    db.exec("COMMIT");
    return rows.map((row) => ({ ...mapChange(row), status: "processing" }));
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recoverProcessingChanges(db: DatabaseSync): number {
  const result = db.prepare(`UPDATE change_queue SET status = 'pending' WHERE status = 'processing'`).run();
  return Number(result.changes);
}

/**
 * Drops reconciliation requests that were queued before an explicit scan.
 * The scan becomes the new baseline; replaying an older partial reconcile
 * after it can incorrectly tombstone a network-backed subtree.
 */
export function discardReconciliations(db: DatabaseSync, libraryId: string): number {
  const result = db.prepare(
    `DELETE FROM change_queue
     WHERE library_id = ? AND event_type = 'reconcile'
       AND status IN ('pending', 'processing')`,
  ).run(libraryId);
  return Number(result.changes);
}

export function hasPendingChanges(db: DatabaseSync, libraryId?: string): boolean {
  const row = db.prepare(
    `SELECT 1 AS present
     FROM change_queue
     WHERE status = 'pending' ${libraryId ? "AND library_id = ?" : ""}
     LIMIT 1`,
  ).get(...(libraryId ? [libraryId] : [])) as { present: number } | undefined;
  return row != null;
}

export function completeChange(db: DatabaseSync, id: number): void {
  db.prepare(`UPDATE change_queue SET status = 'completed', processed_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function failChange(db: DatabaseSync, id: number, error: unknown, maxRetries = MAX_RETRIES): ChangeQueueStatus {
  const message = error instanceof Error ? error.message : String(error);
  const row = db.prepare(`SELECT retry_count FROM change_queue WHERE id = ?`).get(id) as { retry_count: number } | undefined;
  const retryCount = Number(row?.retry_count ?? 0) + 1;
  const status: ChangeQueueStatus = retryCount >= maxRetries ? "dead-letter" : "pending";
  db.prepare(`UPDATE change_queue SET status = ?, retry_count = ?, last_error = ?, processed_at = CASE WHEN ? = 'dead-letter' THEN ? ELSE processed_at END WHERE id = ?`).run(status, retryCount, message, status, Date.now(), id);
  return status;
}

export function markPendingChangesDirty(db: DatabaseSync, libraryId: string, path?: string): void {
  updateSyncState(db, libraryId, { dirty: true, watcherState: "dirty" });
  if (path) {
    enqueueChange(db, {
      libraryId,
      eventType: "reconcile",
      path,
      observedAt: Date.now(),
      generation: getSyncState(db, libraryId).generation + 1,
    });
  }
}

export function ensureInitialReconciliation(
  db: DatabaseSync,
  library: { id: string; roots: readonly string[] },
): number {
  const state = getSyncState(db, library.id);
  if (state.lastReconcileAt != null) return 0;
  const roots = [...new Set(library.roots.map(normalizeChangePath))];
  const alreadyQueued = new Set(
    (db.prepare(
      `SELECT path
       FROM change_queue
       WHERE library_id = ?
         AND event_type = 'reconcile'
         AND status IN ('pending', 'processing')`,
    ).all(library.id) as Array<{ path: string }>).map((row) => normalizeChangePath(row.path)),
  );
  const missingRoots = roots.filter((path) => !alreadyQueued.has(path));
  const ids = enqueueChanges(db, missingRoots.map((path) => ({
    libraryId: library.id,
    eventType: "reconcile" as const,
    path,
    observedAt: Date.now(),
    generation: state.generation + 1,
  })));
  if (ids.length > 0) updateSyncState(db, library.id, { dirty: true, watcherState: "dirty" });
  return ids.length;
}

export function pruneCompletedChanges(db: DatabaseSync, before: number, limit = 1000): number {
  const result = db.prepare(`DELETE FROM change_queue WHERE id IN (SELECT id FROM change_queue WHERE status = 'completed' AND processed_at < ? ORDER BY id LIMIT ?)`).run(before, limit);
  return Number(result.changes);
}

function mapChange(row: Record<string, unknown>): ChangeQueueItem {
  return {
    id: Number(row.id),
    libraryId: String(row.library_id),
    eventType: String(row.event_type) as ChangeEventType,
    path: String(row.path),
    oldPath: row.old_path == null ? null : String(row.old_path),
    observedAt: Number(row.observed_at),
    generation: Number(row.generation),
    status: String(row.status) as ChangeQueueStatus,
    retryCount: Number(row.retry_count),
    lastError: row.last_error == null ? null : String(row.last_error),
    processedAt: row.processed_at == null ? null : Number(row.processed_at),
  };
}

function mapSyncState(row: Record<string, unknown>): SyncState {
  return {
    libraryId: String(row.library_id),
    generation: Number(row.generation),
    lastEventId: row.last_event_id == null ? null : Number(row.last_event_id),
    lastReconcileAt: row.last_reconcile_at == null ? null : Number(row.last_reconcile_at),
    lastSuccessAt: row.last_success_at == null ? null : Number(row.last_success_at),
    watcherState: String(row.watcher_state) as SyncWatcherState,
    dirty: Number(row.dirty) === 1,
    updatedAt: Number(row.updated_at),
  };
}

export function normalizeChangePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  const normalized = trimmed.replaceAll("\\", "/").replace(/\/+/g, "/");
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized.replace("/", "\\");
  if (process.platform === "win32") return normalized.replaceAll("/", "\\").replace(/\\+$/, "");
  return normalized.replace(/\/$/, "");
}

function mergeEvent(previous: ChangeEventType, next: ChangeEventType): ChangeEventType {
  if (next === "delete") return "delete";
  if (next === "create") return previous === "rename" ? "rename" : "create";
  if (previous === "rename") return "rename";
  if (previous === "create") return "create";
  return next;
}
