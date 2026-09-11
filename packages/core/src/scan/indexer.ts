import type { DatabaseSync } from 'node:sqlite'
import type { Entry, Library } from '@nestify/shared'
import { asEntryId, asLibraryId } from '@nestify/shared'
import { createLibrary, getLibrary } from '../db/repos/libraries.ts'
import { getEntryByPath, listEntries, markSeenBatch, tombstoneMissing, tombstoneMissingUnderPath, upsertEntriesBatch } from '../db/repos/entries.ts'
import { createExcluder, DEFAULT_EXCLUDE_NAMES } from '../fs/exclude.ts'
import { walkRoot, type WalkedEntry } from '../fs/walk.ts'
import { walkRootConcurrent } from '../fs/walk-concurrent.ts'
import { normalizeScanPath } from '../fs/path.ts'
import type { ModuleContext, ScanProgress, ScanRequest, ScanResult } from '../modules/types.ts'
import { entryIdFor, newLibraryId } from '../util/ids.ts'

export interface ScanIndexerOptions {
  db: DatabaseSync
  libraryId?: string
  libraryName?: string
}

const IDLE: ScanProgress = {
  phase: 'idle',
  filesScanned: 0,
  dirsScanned: 0,
  bytesScanned: 0,
  errors: 0,
}

const WRITE_BATCH_SIZE = 512

function isUnderRoot(path: string, root: string): boolean {
  const nPath = path.replaceAll('/', '\\').toLowerCase()
  const nRoot = root.replaceAll('/', '\\').toLowerCase()
  if (nPath === nRoot) return true
  const prefix = nRoot.endsWith('\\') ? nRoot : `${nRoot}\\`
  return nPath.startsWith(prefix)
}

function splitExclude(items: string[]): { names: string[]; globs: string[] } {
  const names: string[] = []
  const globs: string[] = []
  for (const item of items) {
    if (item.includes('*') || item.includes('?')) globs.push(item)
    else names.push(item)
  }
  return { names, globs }
}

function mergeExclude(library: Library, extra: string[] | undefined): { names: string[]; globs: string[] } {
  return splitExclude([...DEFAULT_EXCLUDE_NAMES, ...library.excludeGlobs, ...(extra ?? [])])
}

/** 库内已被索引、但按新排除规则应剔除的幽灵条目（如 Office ~$ 锁文件残留）。 */
export function staleEntriesByExclude(
  entries: readonly Entry[],
  shouldSkip: (path: string, name: string, isDir: boolean) => boolean,
): Entry[] {
  const nameOf = (path: string) => {
    const parts = path.split(/[\\/]+/).filter(Boolean)
    return parts[parts.length - 1] ?? path
  }
  return entries.filter((entry) => shouldSkip(entry.path, nameOf(entry.path), entry.isDir))
}

function sameIdentity(existing: Entry, node: WalkedEntry): boolean {
  return (
    existing.isDir === node.isDir &&
    existing.size === node.size &&
    existing.mtime === (node.mtime ?? 0) &&
    existing.ino === node.ino &&
    existing.dev === node.dev
  )
}

function ensureLibrary(db: DatabaseSync, request: ScanRequest, ctx: ModuleContext): Library {
  const libraryId = ctx.libraryId || newLibraryId()
  const existing = getLibrary(db, libraryId)
  if (existing) return existing
  return createLibrary(db, {
    id: libraryId,
    name: ctx.libraryId || 'library',
    roots: request.roots,
    excludeGlobs: request.excludes ?? [],
    hashStrategy: request.hashStrategy ?? 'duplicate-candidate-only',
  })
}

export async function runScan(
  db: DatabaseSync,
  request: ScanRequest,
  ctx: ModuleContext,
): Promise<ScanResult> {
  const library = ensureLibrary(db, request, ctx)
  const libraryId = library.id
  const incremental = request.incremental !== false
  const exclude = mergeExclude(library, request.excludes)
  const seenAt = Date.now()
  const progress: ScanProgress = { ...IDLE, phase: 'walk' }
  const started = Date.now()
  let lastProgressAt = started
  let taskErrors = 0
  const pendingEntries: Entry[] = []
  const pendingSeen: Array<{ id: string; libraryId: string; relPath: string }> = []
  // Only paths in the not-yet-flushed batch live here. Once persisted, parent
  // lookups go back to SQLite, keeping memory bounded for very large scans.
  const pendingIds = new Map<string, string>()

  const flushBatch = () => {
    if (pendingEntries.length > 0) {
      const batch = pendingEntries.splice(0, pendingEntries.length)
      upsertEntriesBatch(db, batch)
      for (const entry of batch) pendingIds.delete(entry.path)
    }
    if (pendingSeen.length > 0) {
      const batch = pendingSeen.splice(0, pendingSeen.length)
      markSeenBatch(db, batch, seenAt)
    }
  }

  for (const rawRoot of request.roots) {
    await ctx.pauseGate?.waitWhilePaused(ctx.abortSignal)
    if (ctx.abortSignal?.aborted) {
      progress.phase = 'cancelled'
      ctx.onProgress?.(progress)
      return {
        filesScanned: progress.filesScanned,
        dirsScanned: progress.dirsScanned,
        errors: progress.errors,
      }
    }

    const root = normalizeScanPath(rawRoot)
    const walkerConcurrency = Math.max(1, Math.min(32, Math.trunc(ctx.concurrency ?? 1)))
    taskErrors = 0
    for await (const node of walkRootConcurrent(root, {
      followSymlinks: library.followSymlinks,
      scanHidden: library.scanHidden,
      maxDepth: library.maxDepth,
      exclude,
      signal: ctx.abortSignal,
      concurrency: walkerConcurrency,
      onTaskError: () => {
        taskErrors += 1
      },
    })) {
      await ctx.pauseGate?.waitWhilePaused(ctx.abortSignal)
      if (ctx.abortSignal?.aborted) break
      const path = node.path
      progress.currentPath = path
      if (node.isDir) progress.dirsScanned += 1
      else {
        progress.filesScanned += 1
        progress.bytesScanned += node.size
      }

      try {
        const existing = incremental ? getEntryByPath(db, libraryId, path) : undefined
        if (existing && sameIdentity(existing, node)) {
          pendingSeen.push({ id: existing.id, libraryId, relPath: node.relPath })
        } else {
          const parentPath = node.parentPath
          const parentId = parentPath && isUnderRoot(parentPath, root)
            ? pendingIds.get(parentPath)
              ?? getEntryByPath(db, libraryId, parentPath)?.id
              ?? entryIdFor(libraryId, parentPath)
            : null
          const entryId = asEntryId(existing?.id ?? pendingIds.get(path) ?? entryIdFor(libraryId, path))
          const entry: Entry = {
            id: entryId,
            libraryId: asLibraryId(libraryId),
            parentId: parentId == null ? null : asEntryId(parentId),
            name: node.name,
            stem: node.stem,
            ext: node.ext,
            isDir: node.isDir,
            size: node.size,
            mtime: node.mtime ?? 0,
            ctime: node.ctime ?? 0,
            atime: node.atime ?? 0,
            ino: node.ino,
            dev: node.dev,
            depth: node.depth,
            kind: node.kind,
            protocol: node.protocol,
            mime: null,
            path,
            parentPath,
            relPath: node.relPath,
            hashQuick: null,
            hashFull: null,
            childCount: existing?.childCount ?? 0,
            fileCount: existing?.fileCount ?? 0,
            dirCount: existing?.dirCount ?? 0,
            tombstone: false,
            seenAt,
            indexedAt: seenAt,
          }
          pendingEntries.push(entry)
          pendingIds.set(path, entry.id)
        }
      } catch {
        progress.errors += 1
      }

      if (pendingEntries.length + pendingSeen.length >= WRITE_BATCH_SIZE) {
        try {
          flushBatch()
        } catch {
          progress.errors += pendingEntries.length + pendingSeen.length
          pendingEntries.length = 0
          pendingSeen.length = 0
        }
      }

      const elapsed = Math.max(1, Date.now() - started) / 1000
      progress.filesPerSecond = progress.filesScanned / elapsed
      if (progress.filesScanned + progress.dirsScanned === 1 || Date.now() - lastProgressAt >= 100) {
        lastProgressAt = Date.now()
        ctx.onProgress?.(progress)
      }
    }
  }

  try {
    flushBatch()
  } catch {
    progress.errors += pendingEntries.length + pendingSeen.length
    pendingEntries.length = 0
    pendingSeen.length = 0
  }

  progress.errors += taskErrors
  progress.phase = 'upsert'
  ctx.onProgress?.(progress)
  if (!ctx.abortSignal?.aborted) {
    tombstoneMissing(db, libraryId, seenAt)
    // 排除规则升级（如新增 ~$ Office 锁文件）后，历史索引里可能残留幽灵条目：
    // 文件已不存在但条目未标记，后续哈希读取会 ENOENT。按当前规则再清一遍。
    const excluder = createExcluder(exclude)
    const stale = staleEntriesByExclude(listEntries(db, libraryId), excluder.shouldSkip)
    for (const entry of stale) {
      tombstoneMissingUnderPath(db, libraryId, entry.path, seenAt)
    }
    if (stale.length > 0) {
      tombstoneMissing(db, libraryId, seenAt)
    }
  }
  progress.phase = ctx.abortSignal?.aborted ? 'cancelled' : 'idle'
  ctx.onProgress?.(progress)
  return {
    filesScanned: progress.filesScanned,
    dirsScanned: progress.dirsScanned,
    errors: progress.errors,
  }
}
