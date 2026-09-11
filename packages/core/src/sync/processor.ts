import type { DatabaseSync } from "node:sqlite";
import { stat } from "node:fs/promises";
import { basename, dirname, relative, sep } from "node:path";
import type { Entry, Library } from "@nestify/shared";
import { asEntryId, asLibraryId } from "@nestify/shared";
import { getEntryByPath, tombstoneMissingUnderPath, upsertEntriesBatch } from "../db/repos/entries.ts";
import { claimChanges, completeChange, failChange, getSyncState, hasPendingChanges, updateSyncState, type ChangeQueueItem } from "../db/repos/sync.ts";
import { classifyKind } from "../fs/kind.ts";
import { normalizeScanPath, splitName } from "../fs/path.ts";
import { entryIdFor } from "../util/ids.ts";
import { walkRoot } from "../fs/walk.ts";

export type ChangeProcessorOptions = {
  library?: Pick<Library, "id" | "roots" | "excludeGlobs" | "maxDepth" | "followSymlinks" | "scanHidden">;
  batchSize?: number;
  debounceMs?: number;
  onError?: (error: unknown, item: ChangeQueueItem) => void;
  /** 每轮处理成功后回调（count = 本轮处理的变更数，>0 时表示索引有更新）。 */
  onProcessed?: (count: number) => void;
};

export class ChangeProcessor {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  private readonly idleWaiters = new Set<() => void>();
  private readonly db: DatabaseSync;
  private readonly options: ChangeProcessorOptions;

  constructor(db: DatabaseSync, options: ChangeProcessorOptions = {}) {
    this.db = db;
    this.options = options;
  }

  schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.process();
    }, this.options.debounceMs ?? 500);
  }

  async process(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    let processed = 0;
    try {
      for (const item of claimChanges(this.db, this.options.batchSize ?? 128, this.options.library?.id)) {
        try {
          await this.apply(item);
          if (this.stopped) return processed;
          completeChange(this.db, item.id);
          const state = getSyncState(this.db, item.libraryId);
          updateSyncState(this.db, item.libraryId, {
            generation: Math.max(state.generation, item.generation),
            lastEventId: item.id,
            lastSuccessAt: Date.now(),
            dirty: item.eventType === "reconcile" ? false : state.dirty,
            lastReconcileAt: item.eventType === "reconcile" ? Date.now() : state.lastReconcileAt,
            watcherState: "watching",
          });
          processed += 1;
        } catch (error) {
          // Runtime.close() can stop the processor while stat/readdir is
          // suspended. The database may be closed before the promise resumes.
          if (this.stopped) return processed;
          failChange(this.db, item.id, error);
          this.options.onError?.(error, item);
        }
      }
      return processed;
    } finally {
      this.running = false;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
      if (processed > 0) this.options.onProcessed?.(processed);
      if (!this.stopped && hasPendingChanges(this.db, this.options.library?.id)) this.schedule();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async waitForIdle(): Promise<void> {
    if (!this.running) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  private async apply(item: ChangeQueueItem): Promise<void> {
    if (this.stopped) return;
    if (item.eventType === "reconcile") {
      await this.reconcile(item.path);
      return;
    }
    const oldExisting = item.eventType === "rename" && item.oldPath && item.oldPath !== item.path
      ? getEntryByPath(this.db, item.libraryId, item.oldPath)
      : undefined;
    const existingAtNewPath = getEntryByPath(this.db, item.libraryId, item.path);
    if (oldExisting && !existingAtNewPath) {
      this.renameEntryTree(item.libraryId, oldExisting.id, item.oldPath!, item.path, oldExisting.isDir);
    } else if (item.eventType === "rename" && item.oldPath && item.oldPath !== item.path) {
      this.tombstonePath(item.libraryId, item.oldPath);
    }
    const existing = getEntryByPath(this.db, item.libraryId, item.path);
    if (item.eventType === "delete") {
      this.tombstonePath(item.libraryId, item.path);
      return;
    }

    let info;
    try {
      info = await stat(item.path);
    } catch (error) {
      if (this.stopped) return;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        this.tombstonePath(item.libraryId, item.path);
        return;
      }
      throw error;
    }
    if (this.stopped) return;
    const name = basename(item.path);
    const parentPath = dirname(item.path);
    const root = this.options.library?.roots
      .map(normalizeScanPath)
      .filter((candidate) => isWithinRoot(item.path, candidate))
      .sort((left, right) => right.length - left.length)[0];
    const normalizedPath = normalizeScanPath(item.path);
    const normalizedRoot = root ? normalizeScanPath(root) : null;
    const relPath = normalizedRoot
      ? relative(normalizedRoot, normalizedPath).split(sep).join("/") || name
      : existing?.relPath ?? name;
    const parentId = getEntryByPath(this.db, item.libraryId, normalizeScanPath(parentPath))?.id ?? null;
    const parentDepth = parentId == null
      ? existing?.depth ?? (normalizedRoot
        ? Math.max(0, relPath.split("/").filter(Boolean).length - 1)
        : 0)
      : Number((this.db.prepare(`SELECT depth FROM entries WHERE id = ?`).get(parentId) as { depth: number } | undefined)?.depth ?? -1) + 1;
    const depth = normalizedRoot && normalizedPath.toLowerCase() === normalizedRoot.toLowerCase()
      ? 0
      : parentDepth;
    const parts = info.isDirectory() ? { stem: name, ext: "" } : splitName(name);
    const entry: Entry = {
      id: asEntryId(existing?.id ?? entryIdFor(item.libraryId, item.path)),
      libraryId: asLibraryId(item.libraryId),
      parentId,
      name,
      stem: parts.stem,
      ext: parts.ext,
      isDir: info.isDirectory(),
      size: info.isDirectory() ? 0 : Number(info.size),
      mtime: Math.round(info.mtimeMs),
      ctime: Math.round(info.ctimeMs),
      atime: Math.round(info.atimeMs),
      ino: String(info.ino),
      dev: String(info.dev),
      depth,
      kind: classifyKind(name, info.isDirectory()),
      protocol: existing?.protocol ?? "local",
      mime: existing?.mime ?? null,
      path: item.path,
      parentPath,
      relPath,
      hashQuick: existing?.hashQuick ?? null,
      hashFull: existing?.hashFull ?? null,
      childCount: existing?.childCount ?? 0,
      fileCount: existing?.fileCount ?? 0,
      dirCount: existing?.dirCount ?? 0,
      tombstone: false,
      seenAt: item.observedAt,
      indexedAt: item.observedAt,
    };
    upsertEntriesBatch(this.db, [entry]);
  }

  private async reconcile(path: string): Promise<void> {
    const normalized = normalizeScanPath(path);
    const seenAt = Date.now();
    const entries: Entry[] = [];
    let found = false;
    for await (const node of walkRoot(normalized, {
      followSymlinks: this.options.library?.followSymlinks ?? false,
      scanHidden: this.options.library?.scanHidden ?? false,
      maxDepth: this.options.library?.maxDepth,
      exclude: { globs: this.options.library?.excludeGlobs ?? [] },
    })) {
      if (this.stopped) return;
      found = true;
      const existing = getEntryByPath(this.db, this.options.library?.id ?? "", node.path);
      const root = this.options.library?.roots
        .map(normalizeScanPath)
        .filter((candidate) => isWithinRoot(node.path, candidate))
        .sort((left, right) => right.length - left.length)[0];
      const relPath = root ? relative(root, normalizeScanPath(node.path)).split(sep).join("/") : node.relPath;
      const parentPath = node.parentPath ? normalizeScanPath(node.parentPath) : null;
      const parentId = parentPath ? getEntryByPath(this.db, this.options.library?.id ?? "", parentPath)?.id ?? null : null;
      const parts = node.isDir ? { stem: node.name, ext: "" } : splitName(node.name);
      entries.push({
        id: asEntryId(existing?.id ?? entryIdFor(this.options.library?.id ?? "", node.path)),
        libraryId: asLibraryId(this.options.library?.id ?? ""),
        parentId: parentId ? asEntryId(parentId) : null,
        name: node.name,
        stem: parts.stem,
        ext: parts.ext,
        isDir: node.isDir,
        size: node.size,
        mtime: node.mtime ?? 0,
        ctime: node.ctime ?? 0,
        atime: node.atime ?? 0,
        ino: node.ino,
        dev: node.dev,
        depth: node.depth,
        kind: classifyKind(node.name, node.isDir),
        protocol: node.protocol,
        mime: existing?.mime ?? null,
        path: normalizeScanPath(node.path),
        parentPath,
        relPath,
        hashQuick: existing?.hashQuick ?? null,
        hashFull: existing?.hashFull ?? null,
        childCount: existing?.childCount ?? 0,
        fileCount: existing?.fileCount ?? 0,
        dirCount: existing?.dirCount ?? 0,
        tombstone: false,
        seenAt,
        indexedAt: seenAt,
      });
      if (entries.length >= 256) {
        upsertEntriesBatch(this.db, entries.splice(0, entries.length));
      }
    }
    if (entries.length > 0) upsertEntriesBatch(this.db, entries);
    if (found) tombstoneMissingUnderPath(this.db, this.options.library?.id ?? "", normalized, seenAt);
    else this.tombstonePath(this.options.library?.id ?? "", normalized);
  }

  private renameEntryTree(libraryId: string, entryId: string, oldPath: string, newPath: string, isDir: boolean): void {
    const from = normalizeScanPath(oldPath);
    const to = normalizeScanPath(newPath);
    const separator = from.includes("\\") ? "\\" : "/";
    const rows = this.db.prepare(
      `SELECT id, path FROM entries WHERE id = ? OR (? = 1 AND path LIKE ? ESCAPE '\\') ORDER BY length(path) ASC`,
    ).all(entryId, isDir ? 1 : 0, childPathLikePattern(from, separator)) as Array<{ id: string; path: string }>;
    const targets = rows.map((row) => ({
      ...row,
      nextPath: row.path === from ? to : `${to}${row.path.slice(from.length)}`,
    }));
    const targetIds = new Map(targets.map((row) => [row.nextPath, row.id]));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of targets) {
        this.db.prepare(`UPDATE entries SET path = ? WHERE id = ?`).run(`${row.nextPath}.nestify-renaming`, row.id);
      }
      for (const row of targets) {
        const nextPath = row.nextPath;
        const nextParent = dirname(nextPath);
        const parentId = targetIds.get(nextParent) ?? getEntryByPath(this.db, libraryId, nextParent)?.id ?? null;
        const parentDepth = parentId == null
          ? -1
          : Number((this.db.prepare(`SELECT depth FROM entries WHERE id = ?`).get(parentId) as { depth: number } | undefined)?.depth ?? -1);
        const name = basename(nextPath);
        const parts = splitName(name);
        this.db.prepare(
          `UPDATE entries SET path = ?, name = ?, stem = ?, ext = ?, parent_id = ?, parent_path = ?, depth = ? WHERE id = ?`,
        ).run(nextPath, name, parts.stem, parts.ext, parentId, nextParent, Math.max(0, parentDepth + 1), row.id);
        this.db.prepare(
          `UPDATE entries SET rel_path = ? WHERE id = ?`,
        ).run(this.relativePath(nextPath), row.id);
        this.db.prepare(
          `UPDATE library_entries SET rel_path = ? WHERE library_id = ? AND entry_id = ?`,
        ).run(this.relativePath(nextPath), libraryId, row.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private tombstonePath(libraryId: string, path: string): void {
    const normalized = normalizeChangePath(path);
    const separator = normalized.includes("\\") ? "\\" : "/";
    const rows = this.db.prepare(
      `SELECT id FROM entries WHERE path = ? OR path LIKE ? ESCAPE '\\'`,
    ).all(normalized, childPathLikePattern(normalized, separator)) as Array<{ id: string }>;
    for (const row of rows) {
      this.db.prepare(`UPDATE library_entries SET tombstone = 1 WHERE library_id = ? AND entry_id = ?`).run(libraryId, row.id);
      this.db.prepare(`UPDATE entries SET tombstone = CASE WHEN EXISTS (SELECT 1 FROM library_entries WHERE entry_id = entries.id AND tombstone = 0) THEN 0 ELSE 1 END WHERE id = ?`).run(row.id);
    }
  }

  private relativePath(path: string): string {
    const root = this.options.library?.roots
      .map(normalizeScanPath)
      .filter((candidate) => isWithinRoot(path, candidate))
      .sort((left, right) => right.length - left.length)[0];
    if (!root) return basename(path);
    return relative(root, normalizeScanPath(path)).split(sep).join("/") || basename(path);
  }
}

function normalizeChangePath(path: string): string {
  return normalizeScanPath(path);
}

function isWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalizeScanPath(path).toLowerCase();
  const normalizedRoot = normalizeScanPath(root).toLowerCase();
  if (normalizedPath === normalizedRoot) return true;
  const separator = normalizedRoot.includes("\\") ? "\\" : "/";
  return normalizedPath.startsWith(`${normalizedRoot.replace(/[\\/]$/, "")}${separator}`);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function childPathLikePattern(path: string, separator: string): string {
  // The separator is part of the literal prefix, while the final percent is
  // intentionally left unescaped as the subtree wildcard.
  return `${escapeLike(path)}${escapeLike(separator)}%`;
}
