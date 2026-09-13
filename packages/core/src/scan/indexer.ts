import type { DatabaseSync } from 'node:sqlite'
import type { Entry, Library } from '@nestify/shared'
import { asEntryId, asLibraryId } from '@nestify/shared'
import { createLibrary, getLibrary } from '../db/repos/libraries.ts'
import { getEntryByPath, listEntries, markSeenBatch, tombstoneMissing, tombstoneMissingUnderPath, upsertEntriesBatch } from '../db/repos/entries.ts'
import { createExcluder, DEFAULT_EXCLUDE_NAMES } from '../fs/exclude.ts'
import { walkRoot, type WalkedEntry } from '../fs/walk.ts'
import { walkRootConcurrent } from '../fs/walk-concurrent.ts'
import { isPathWithinRoot, normalizeScanPath, scanPathAliases } from '../fs/path.ts'
import type { ModuleContext, ScanErrorDetail, ScanProgress, ScanRequest, ScanResult } from '../modules/types.ts'
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
const MAX_SCAN_ERROR_DETAILS = 200

function isUnderRoot(path: string, root: string): boolean {
  return isPathWithinRoot(path, root)
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

function isHintOnly(node: WalkedEntry): boolean {
  return node.mtime == null && node.ctime == null && node.atime == null && node.ino == null && node.dev == null && node.size === 0
}

function isSparseEntry(entry: Entry): boolean {
  return entry.mtime === 0 && entry.size === 0 && entry.ino == null && entry.dev == null
}

function preferIndexedEntry(current: Entry | undefined, next: Entry): Entry {
  if (!current) return next
  if (isSparseEntry(current) && !isSparseEntry(next)) return next
  if (!isSparseEntry(current) && isSparseEntry(next)) return current
  return next
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
  let walkHadErrors = false
  const errorDetails: ScanErrorDetail[] = []
  const errorSummary: Record<string, number> = {}
  const pendingEntries: Entry[] = []
  const pendingSeen: Array<{ id: string; libraryId: string; relPath: string }> = []
  // Only paths in the not-yet-flushed batch live here. Once persisted, parent
  // lookups go back to SQLite, keeping memory bounded for very large scans.
  const pendingIds = new Map<string, string>()
  const countedPaths = new Set<string>()

  const recordError = (error: ScanErrorDetail) => {
    const key = `${error.operation}:${error.code ?? 'UNKNOWN'}`
    errorSummary[key] = (errorSummary[key] ?? 0) + 1
    if (errorDetails.length < MAX_SCAN_ERROR_DETAILS) errorDetails.push(error)
  }

  const flushBatch = () => {
    if (pendingEntries.length > 0) {
      const byPath = new Map<string, Entry>()
      for (const entry of pendingEntries) {
        byPath.set(entry.path, preferIndexedEntry(byPath.get(entry.path), entry))
      }
      const batch = [...byPath.values()]
      upsertEntriesBatch(db, batch)
      pendingEntries.splice(0, pendingEntries.length)
      for (const entry of batch) {
        pendingIds.delete(entry.path)
        for (const alias of scanPathAliases(entry.path)) pendingIds.delete(alias)
      }
    }
    if (pendingSeen.length > 0) {
      const batch = pendingSeen.slice()
      markSeenBatch(db, batch, seenAt)
      pendingSeen.splice(0, pendingSeen.length)
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
    let rootTaskErrors = 0
    for await (const node of walkRootConcurrent(root, {
      followSymlinks: library.followSymlinks,
      scanHidden: library.scanHidden,
      maxDepth: library.maxDepth,
      exclude,
      signal: ctx.abortSignal,
      concurrency: walkerConcurrency,
      onTaskError: (error) => {
        rootTaskErrors += 1
        recordError({ ...error })
      },
    })) {
      await ctx.pauseGate?.waitWhilePaused(ctx.abortSignal)
      if (ctx.abortSignal?.aborted) break
      const path = node.path
      progress.currentPath = path
      if (!countedPaths.has(path)) {
        countedPaths.add(path)
        if (node.isDir) progress.dirsScanned += 1
        else {
          progress.filesScanned += 1
          progress.bytesScanned += node.size
        }
      } else if (!node.isDir && node.size > 0) {
        progress.bytesScanned += node.size
      }

      try {
        const existing = incremental ? getEntryByPath(db, libraryId, path) : undefined
        if (isHintOnly(node) && !existing) {
          // A name hint is only an ordering aid. Do not persist an entry until
          // stat succeeds, otherwise transient download files become ghosts.
        } else if (existing && (isHintOnly(node) || sameIdentity(existing, node))) {
          pendingSeen.push({ id: existing.id, libraryId, relPath: node.relPath })
        } else {
          const parentPath = node.parentPath
          const parentId = parentPath && isUnderRoot(parentPath, root)
            ? resolvePendingParentId(pendingIds, parentPath)
              ?? getEntryByPath(db, libraryId, parentPath)?.id
              ?? null
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
          rememberPendingId(pendingIds, path, entry.id)
        }
      } catch (error) {
        progress.errors += 1
        recordError({
          path,
          operation: 'upsert',
          message: error instanceof Error ? error.message : String(error),
        })
      }

      if (pendingEntries.length + pendingSeen.length >= WRITE_BATCH_SIZE) {
        try {
          flushBatch()
        } catch (error) {
          const failedCount = pendingEntries.length + pendingSeen.length
          progress.errors += failedCount
          recordError({
            path: pendingEntries[0]?.path ?? pendingSeen[0]?.relPath ?? root,
            operation: 'upsert',
            message: error instanceof Error ? error.message : String(error),
          })
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
    taskErrors += rootTaskErrors
    if (rootTaskErrors > 0) walkHadErrors = true
  }

  try {
    flushBatch()
  } catch (error) {
    const failedCount = pendingEntries.length + pendingSeen.length
    progress.errors += failedCount
    recordError({
      path: pendingEntries[0]?.path ?? pendingSeen[0]?.relPath ?? request.roots[0] ?? '',
      operation: 'upsert',
      message: error instanceof Error ? error.message : String(error),
    })
    pendingEntries.length = 0
    pendingSeen.length = 0
  }

  progress.errors += taskErrors
  progress.phase = 'upsert'
  ctx.onProgress?.(progress)
  // A network/SMB read can fail for one subtree while the rest of the scan
  // succeeds. Keep the previous index in that case; treating unreadable
  // paths as missing would hide valid directories and files.
  if (!ctx.abortSignal?.aborted && !walkHadErrors) {
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
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    errorSummary: Object.keys(errorSummary).length > 0 ? errorSummary : undefined,
  }
}

function rememberPendingId(pendingIds: Map<string, string>, path: string, id: string): void {
  pendingIds.set(path, id)
  for (const alias of scanPathAliases(path)) pendingIds.set(alias, id)
}

function resolvePendingParentId(pendingIds: Map<string, string>, parentPath: string): string | undefined {
  return scanPathAliases(parentPath).map((alias) => pendingIds.get(alias)).find(Boolean)
}
