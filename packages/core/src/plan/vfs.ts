import type { Entry } from "@nestify/shared";
import { normalizeKey, replacePrefix } from "./paths.ts";

export interface VfsNode {
  entryId: string | null;
  isDir: boolean;
}

export class VirtualFs {
  private readonly currentPaths = new Map<string, string>();
  private readonly isDir = new Map<string, boolean>();
  private readonly byPath = new Map<string, VfsNode>();

  constructor(entries: readonly Entry[]) {
    for (const entry of entries) {
      if (entry.tombstone) continue;
      this.currentPaths.set(entry.id, entry.path);
      this.isDir.set(entry.id, entry.isDir);
      this.byPath.set(normalizeKey(entry.path), { entryId: entry.id, isDir: entry.isDir });
    }
  }

  current(entryId: string): string | undefined {
    return this.currentPaths.get(entryId);
  }

  lookup(path: string): VfsNode | undefined {
    return this.byPath.get(normalizeKey(path));
  }

  occupiedByOther(path: string, entryId: string): boolean {
    const hit = this.lookup(path);
    if (!hit) return false;
    return hit.entryId !== entryId;
  }

  has(path: string): boolean {
    return this.byPath.has(normalizeKey(path));
  }

  addDir(path: string): void {
    if (this.has(path)) return;
    this.byPath.set(normalizeKey(path), { entryId: null, isDir: true });
  }

  relocate(entryId: string, to: string): void {
    const from = this.currentPaths.get(entryId);
    if (!from || normalizeKey(from) === normalizeKey(to)) return;
    const dir = this.isDir.get(entryId) === true;
    this.byPath.delete(normalizeKey(from));

    if (dir) {
      const updates: Array<{ id: string; next: string }> = [];
      for (const [id, path] of this.currentPaths) {
        if (id === entryId) continue;
        const next = replacePrefix(path, from, to);
        if (next !== path) updates.push({ id, next });
      }
      for (const update of updates) {
        const oldPath = this.currentPaths.get(update.id);
        if (oldPath) this.byPath.delete(normalizeKey(oldPath));
        this.currentPaths.set(update.id, update.next);
        this.byPath.set(normalizeKey(update.next), {
          entryId: update.id,
          isDir: this.isDir.get(update.id) === true,
        });
      }
    }

    this.currentPaths.set(entryId, to);
    this.byPath.set(normalizeKey(to), { entryId, isDir: dir });
  }

  remove(entryId: string): void {
    const from = this.currentPaths.get(entryId);
    if (from) this.byPath.delete(normalizeKey(from));
    this.currentPaths.delete(entryId);
    this.isDir.delete(entryId);
  }
}
