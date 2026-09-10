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
  let closed = false;
  const publish = (eventType: ChangeEventType, root: string, filename: string | Buffer) => {
    if (closed) return;
    const raw = String(filename);
    const path = normalizeScanPath(raw.includes(":") || raw.startsWith("/") ? raw : `${root}/${raw}`);
    const observedAt = Date.now();
    const state = getSyncState(db, library.id);
    const event = { libraryId: library.id, eventType, path, observedAt, generation: state.generation + 1 };
    try {
      // fs.watch exposes a rename notification but generally does not expose
      // the old path. Reconcile the containing directory so deletions and
      // moves are resolved from current disk state instead of guessing.
      const queuedEvent = eventType === "rename"
        ? { ...event, eventType: "reconcile" as const, path: normalizeScanPath(dirname(path)) }
        : event;
      enqueueChange(db, queuedEvent);
      updateSyncState(db, library.id, { watcherState: "watching", generation: queuedEvent.generation, dirty: false });
      onEvent?.(queuedEvent);
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
