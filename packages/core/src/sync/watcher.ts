import { watch, type FSWatcher } from "node:fs";
import { dirname } from "node:path";
import { normalizeScanPath } from "../fs/path.ts";
import { enqueueChange, getSyncState, markPendingChangesDirty, updateSyncState, type ChangeEventType } from "../db/repos/sync.ts";
import type { DatabaseSync } from "node:sqlite";

export type WatcherEvent = {
  libraryId: string;
  eventType: ChangeEventType;
  path: string;
  observedAt: number;
  generation: number;
};

export type LibraryWatcher = {
  close(): void;
  markDirty(): void;
};

export function startLibraryWatcher(
  db: DatabaseSync,
  library: { id: string; roots: readonly string[] },
  onEvent?: (event: WatcherEvent) => void,
): LibraryWatcher {
  const handles: FSWatcher[] = [];
  const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let closed = false;
  const enqueueEvent = (event: WatcherEvent) => {
    enqueueChange(db, event);
    updateSyncState(db, library.id, { watcherState: "watching", generation: event.generation, dirty: false });
    onEvent?.(event);
  };
  const scheduleParentReconcile = (path: string) => {
    const parentPath = normalizeScanPath(dirname(path));
    const previous = reconcileTimers.get(parentPath);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      reconcileTimers.delete(parentPath);
      if (closed) return;
      const observedAt = Date.now();
      const state = getSyncState(db, library.id);
      try {
        enqueueEvent({
          libraryId: library.id,
          eventType: "reconcile",
          path: parentPath,
          observedAt,
          generation: state.generation + 1,
        });
      } catch {
        markPendingChangesDirty(db, library.id, library.roots[0]);
      }
    }, 250);
    reconcileTimers.set(parentPath, timer);
  };
  const publish = (eventType: ChangeEventType, root: string, filename: string | Buffer) => {
    if (closed) return;
    const raw = String(filename);
    const path = normalizeScanPath(raw.includes(":") || raw.startsWith("/") ? raw : `${root}/${raw}`);
    const observedAt = Date.now();
    const state = getSyncState(db, library.id);
    const event = { libraryId: library.id, eventType, path, observedAt, generation: state.generation + 1 };
    try {
      // Keep the path-level rename event: if the path disappeared, the
      // processor can tombstone it immediately. A delayed parent reconcile
      // then catches editor-style replacements and real renames reliably.
      enqueueEvent(event);
      if (eventType === "rename") scheduleParentReconcile(path);
    } catch {
      markPendingChangesDirty(db, library.id, library.roots[0]);
    }
  };

  for (const root of library.roots) {
    try {
      const handle = watch(root, { recursive: process.platform === "win32" }, (eventType, filename) => {
        if (!filename) {
          markPendingChangesDirty(db, library.id, root);
          return;
        }
        publish(eventType === "rename" ? "rename" : "change", root, filename);
      });
      handle.on("error", () => markPendingChangesDirty(db, library.id, root));
      handles.push(handle);
    } catch {
      markPendingChangesDirty(db, library.id, root);
    }
  }
  updateSyncState(db, library.id, { watcherState: handles.length > 0 ? "watching" : "error", dirty: handles.length === 0 });

  return {
    close() {
      if (closed) return;
      closed = true;
      for (const handle of handles) handle.close();
      for (const timer of reconcileTimers.values()) clearTimeout(timer);
      reconcileTimers.clear();
      updateSyncState(db, library.id, { watcherState: "stopped" });
    },
    markDirty() {
      markPendingChangesDirty(db, library.id, library.roots[0]);
    },
  };
}

export function eventTypeForExists(exists: boolean): ChangeEventType {
  return exists ? "change" : "delete";
}
