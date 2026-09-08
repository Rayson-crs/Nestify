import type { DatabaseSync } from 'node:sqlite'
import type { Entry, Library } from '@nestify/shared'
import { asLibraryId } from '@nestify/shared'
import { createLibrary, getLibrary } from '../db/repos/libraries.ts'
import { getEntryByPath, markSeen, tombstoneMissing, upsertEntry } from '../db/repos/entries.ts'
import { DEFAULT_EXCLUDE_NAMES } from '../fs/exclude.ts'
import { walkRoot, type WalkedEntry } from '../fs/walk.ts'
import { normalizeScanPath } from '../fs/path.ts'
import type { ModuleContext, ScanProgress, ScanRequest, ScanResult } from '../modules/types.ts'
import { insertTrigrams } from '../search/trigram.ts'
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
    for await (const node of walkRoot(root, {
      followSymlinks: library.followSymlinks,
      scanHidden: library.scanHidden,
      maxDepth: library.maxDepth,
      exclude,
      signal: ctx.abortSignal,
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
          markSeen(db, existing.id, seenAt)
        } else {
          const parentPath = node.parentPath
          const parentId =
            parentPath && isUnderRoot(parentPath, root) ? entryIdFor(libraryId, parentPath) : null
          const entry: Entry = {
            id: existing?.id ?? entryIdFor(libraryId, path),
            libraryId: asLibraryId(libraryId),
            parentId,
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
          upsertEntry(db, entry)
          insertTrigrams(db, entry.id, entry.name)
        }
      } catch {
        progress.errors += 1
      }

      const elapsed = Math.max(1, Date.now() - started) / 1000
      progress.filesPerSecond = progress.filesScanned / elapsed
      ctx.onProgress?.(progress)
    }
  }

  progress.phase = 'upsert'
  ctx.onProgress?.(progress)
  if (!ctx.abortSignal?.aborted) {
    tombstoneMissing(db, libraryId, seenAt)
  }
  progress.phase = ctx.abortSignal?.aborted ? 'cancelled' : 'idle'
  ctx.onProgress?.(progress)
  return {
    filesScanned: progress.filesScanned,
    dirsScanned: progress.dirsScanned,
    errors: progress.errors,
  }
}
