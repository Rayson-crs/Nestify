import type { Dirent, Stats } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type { EntryKind, StorageProtocol } from '@nestify/shared'
import { createExcluder, type ExcludeSpec } from './exclude.ts'
import { classifyKind } from './kind.ts'
import { isUncPath, normalizeScanPath, splitName, toLongPath } from './path.ts'

export interface WalkOptions {
  followSymlinks?: boolean
  scanHidden?: boolean
  maxDepth?: number | null
  exclude?: ExcludeSpec
  signal?: AbortSignal
}

export interface WalkedEntry {
  root: string
  path: string
  parentPath: string | null
  relPath: string
  name: string
  stem: string
  ext: string
  isDir: boolean
  depth: number
  size: number
  mtime: number | null
  ctime: number | null
  atime: number | null
  ino: string | null
  dev: string | null
  kind: EntryKind
  protocol: StorageProtocol
}

interface QueueItem {
  path: string
  parentPath: string | null
  depth: number
}

function detectProtocol(path: string): StorageProtocol {
  return isUncPath(path) ? 'smb' : 'local'
}

function toRelPath(root: string, path: string): string {
  if (path === root) return ''
  return relative(root, path).split(/[\\/]/).join('/')
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.') && name !== '.' && name !== '..'
}

function isLinkDirent(dirent: Dirent): boolean {
  if (dirent.isSymbolicLink()) return true
  const maybeJunction = dirent as Dirent & { isJunction?: () => boolean }
  return typeof maybeJunction.isJunction === 'function' && maybeJunction.isJunction()
}

function fromStats(
  root: string,
  path: string,
  parentPath: string | null,
  depth: number,
  info: Stats,
  isDir: boolean,
): WalkedEntry {
  const name = path === root ? basename(root) || root : basename(path)
  const parts = isDir ? { stem: name, ext: '' } : splitName(name)
  return {
    root,
    path,
    parentPath,
    relPath: toRelPath(root, path),
    name,
    stem: parts.stem,
    ext: parts.ext,
    isDir,
    depth,
    size: isDir ? 0 : Number(info.size),
    mtime: Number.isFinite(info.mtimeMs) ? Math.round(info.mtimeMs) : null,
    ctime: Number.isFinite(info.ctimeMs) ? Math.round(info.ctimeMs) : null,
    atime: Number.isFinite(info.atimeMs) ? Math.round(info.atimeMs) : null,
    ino: info.ino == null ? null : String(info.ino),
    dev: info.dev == null ? null : String(info.dev),
    kind: classifyKind(name, isDir),
    protocol: detectProtocol(root),
  }
}

async function safeStat(path: string, follow: boolean): Promise<Stats | null> {
  try {
    const target = toLongPath(path)
    return follow ? await stat(target) : await lstat(target)
  } catch {
    return null
  }
}

export async function* walkRoot(rootInput: string, options: WalkOptions = {}): AsyncGenerator<WalkedEntry> {
  const root = normalizeScanPath(rootInput)
  const follow = options.followSymlinks === true
  const scanHidden = options.scanHidden === true
  const maxDepth = options.maxDepth ?? null
  const excluder = createExcluder(options.exclude)
  const queue: QueueItem[] = [{ path: root, parentPath: null, depth: 0 }]

  for (let i = 0; i < queue.length; i += 1) {
    if (options.signal?.aborted) return
    const current = queue[i]!

    const info = await safeStat(current.path, follow)
    if (!info) continue
    if (info.isSymbolicLink() && !follow) continue

    const isDir = info.isDirectory()
    const name = current.path === root ? basename(root) || root : basename(current.path)
    if (current.depth > 0 && excluder.shouldSkip(current.path, name, isDir)) continue
    if (!scanHidden && current.depth > 0 && isHiddenName(name)) continue

    yield fromStats(root, current.path, current.parentPath, current.depth, info, isDir)
    if (!isDir) continue
    if (maxDepth != null && current.depth >= maxDepth) continue

    let children: Dirent[]
    try {
      children = await readdir(toLongPath(current.path), { withFileTypes: true })
    } catch {
      continue
    }

    for (const child of children) {
      if (options.signal?.aborted) return
      if (child.name === '.' || child.name === '..') continue
      if (!follow && isLinkDirent(child)) continue
      queue.push({
        path: join(current.path, child.name),
        parentPath: current.path,
        depth: current.depth + 1,
      })
    }
  }
}
