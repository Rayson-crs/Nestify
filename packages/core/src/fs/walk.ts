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
  onTaskError?: (error: WalkErrorDetail) => void
}

export type WalkErrorOperation = 'stat' | 'readdir' | 'worker'

export interface WalkErrorDetail {
  path: string
  operation: WalkErrorOperation
  message: string
  code?: string
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
  isDirHint?: boolean
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

export function fromStats(
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

export function fromDirectoryHint(
  root: string,
  path: string,
  parentPath: string | null,
  depth: number,
): WalkedEntry {
  return fromNameHint(root, path, parentPath, depth, true)
}

export function fromNameHint(
  root: string,
  path: string,
  parentPath: string | null,
  depth: number,
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
    size: 0,
    mtime: null,
    ctime: null,
    atime: null,
    ino: null,
    dev: null,
    kind: classifyKind(name, isDir),
    protocol: detectProtocol(root),
  }
}

export function mergeDirectoryChildNames(typedNames: readonly string[], names: readonly string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  const add = (name: string) => {
    if (!name || name === '.' || name === '..' || seen.has(name)) return
    seen.add(name)
    merged.push(name)
  }
  for (const name of names) add(name)
  for (const name of typedNames) add(name)
  return merged
}

export async function listDirectoryEntries(path: string): Promise<{
  children: Array<{ name: string; dirent: Dirent | null }>
  readFailed: boolean
  error?: WalkErrorDetail
}> {
  const target = toLongPath(path)
  const typedResult = await readdir(target, { withFileTypes: true })
    .then((value) => ({ value, error: null }))
    .catch((error: unknown) => ({ value: null, error }))
  const namesResult = await readdir(target)
    .then((value) => ({ value, error: null }))
    .catch((error: unknown) => ({ value: null, error }))
  const typed = typedResult.value
  const names = namesResult.value
  if (typed == null && names == null) {
    return {
      children: [],
      readFailed: true,
      error: toWalkError(path, 'readdir', namesResult.error ?? typedResult.error),
    }
  }
  const direntByName = new Map((typed ?? []).map((dirent) => [dirent.name, dirent] as const))
  const merged = mergeDirectoryChildNames(
    (typed ?? []).map((dirent) => dirent.name),
    names ?? [],
  )
  return {
    children: merged.map((name) => ({ name, dirent: direntByName.get(name) ?? null })),
    readFailed: false,
  }
}

export async function safeStat(path: string, follow: boolean): Promise<Stats | null> {
  return (await safeStatResult(path, follow)).value
}

export async function safeStatResult(path: string, follow: boolean): Promise<{
  value: Stats | null
  error?: WalkErrorDetail
}> {
  try {
    const target = toLongPath(path)
    return { value: follow ? await stat(target) : await lstat(target) }
  } catch (error: unknown) {
    return { value: null, error: toWalkError(path, 'stat', error) }
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

    const statResult = await safeStatResult(current.path, follow)
    const info = statResult.value
    if (info?.isSymbolicLink() && !follow) continue

    const isDir = info?.isDirectory() ?? current.isDirHint === true
    const name = current.path === root ? basename(root) || root : basename(current.path)
    if (current.depth > 0 && excluder.shouldSkip(current.path, name, isDir)) continue
    if (!scanHidden && current.depth > 0 && isHiddenName(name)) continue

    if (!info) {
      options.onTaskError?.(statResult.error ?? toWalkError(current.path, 'stat', new Error('unable to read path')))
      if (current.depth === 0) continue
      if (!isDir) continue
    } else {
      yield fromStats(root, current.path, current.parentPath, current.depth, info, isDir)
      if (!isDir) continue
    }
    if (maxDepth != null && current.depth >= maxDepth) continue

    const listed = await listDirectoryEntries(current.path)
    if (listed.readFailed) {
      options.onTaskError?.(listed.error ?? toWalkError(current.path, 'readdir', new Error('unable to list directory')))
      continue
    }

    for (const child of listed.children) {
      if (options.signal?.aborted) return
      if (!follow && child.dirent && isLinkDirent(child.dirent)) continue
      const childPath = join(current.path, child.name)
      const childName = basename(childPath)
      const hintedDir = child.dirent?.isDirectory() === true
      if (excluder.shouldSkip(childPath, childName, hintedDir)) continue
      if (!scanHidden && isHiddenName(childName)) continue
      yield fromNameHint(root, childPath, current.path, current.depth + 1, hintedDir)
      queue.push({
        path: childPath,
        parentPath: current.path,
        depth: current.depth + 1,
        isDirHint: hintedDir,
      })
    }
  }
}

function toWalkError(path: string, operation: WalkErrorOperation, error: unknown): WalkErrorDetail {
  const candidate = error as { code?: unknown; message?: unknown } | null
  const code = typeof candidate?.code === 'string' ? candidate.code : undefined
  const message = typeof candidate?.message === 'string' ? candidate.message : String(error)
  return { path, operation, message, ...(code ? { code } : {}) }
}
