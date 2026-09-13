import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { createExcluder, type ExcludeSpec } from './exclude.ts'
import { fromNameHint, fromStats, listDirectoryEntries, safeStatResult, type WalkErrorDetail, type WalkedEntry } from './walk.ts'

export interface WalkTask {
  root: string
  path: string
  parentPath: string | null
  depth: number
}

export interface WalkTaskResult {
  task: WalkTask
  nodes: WalkedEntry[]
  directories: WalkTask[]
  failed: boolean
  errors?: WalkErrorDetail[]
  done?: boolean
}

export interface WalkTaskOptions {
  followSymlinks?: boolean
  scanHidden?: boolean
  maxDepth?: number | null
  exclude?: ExcludeSpec
  onPartial?: (result: WalkTaskResult) => void
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.') && name !== '.' && name !== '..'
}

function isLinkDirent(dirent: Dirent): boolean {
  if (dirent.isSymbolicLink()) return true
  const maybeJunction = dirent as Dirent & { isJunction?: () => boolean }
  return typeof maybeJunction.isJunction === 'function' && maybeJunction.isJunction()
}

export async function inspectWalkTask(
  task: WalkTask,
  options: WalkTaskOptions = {},
): Promise<WalkTaskResult> {
  const follow = options.followSymlinks === true
  const scanHidden = options.scanHidden === true
  const maxDepth = options.maxDepth ?? null
  const excluder = createExcluder(options.exclude)
  const statResult = await safeStatResult(task.path, follow)
  const info = statResult.value
  if (!info) return { task, nodes: [], directories: [], failed: true, errors: statResult.error ? [statResult.error] : undefined }
  if (info.isSymbolicLink() && !follow) return { task, nodes: [], directories: [], failed: false }

  const isDir = info.isDirectory()
  const name = task.path === task.root ? basename(task.root) || task.root : basename(task.path)
  if (task.depth > 0 && excluder.shouldSkip(task.path, name, isDir)) {
    return { task, nodes: [], directories: [], failed: false }
  }
  if (!scanHidden && task.depth > 0 && isHiddenName(name)) {
    return { task, nodes: [], directories: [], failed: false }
  }

  const nodes = [fromStats(task.root, task.path, task.parentPath, task.depth, info, isDir)]
  const directories: WalkTask[] = []
  const errors: WalkErrorDetail[] = []
  let failed = false
  if (!isDir || (maxDepth != null && task.depth >= maxDepth)) {
    return { task, nodes, directories, failed: false }
  }

  const listed = await listDirectoryEntries(task.path)
  if (listed.readFailed) {
    return { task, nodes, directories, failed: true, errors: listed.error ? [listed.error] : undefined }
  }

  const childDepth = task.depth + 1
  const pendingStats: Array<{ path: string; name: string; hintedDir: boolean }> = []
  for (const child of listed.children) {
    if (!follow && child.dirent && isLinkDirent(child.dirent)) continue

    const childPath = join(task.path, child.name)
    const childName = basename(childPath)
    const hintedDir = child.dirent?.isDirectory() === true
    if (excluder.shouldSkip(childPath, childName, hintedDir)) continue
    if (!scanHidden && isHiddenName(childName)) continue
    nodes.push(fromNameHint(task.root, childPath, task.path, childDepth, hintedDir))
    if (hintedDir && (maxDepth == null || childDepth < maxDepth)) {
      directories.push({
        root: task.root,
        path: childPath,
        parentPath: task.path,
        depth: childDepth,
      })
    }
    pendingStats.push({ path: childPath, name: childName, hintedDir })
  }

  if (options.onPartial && (nodes.length > 0 || directories.length > 0)) {
    options.onPartial({
      task,
      nodes: nodes.slice(),
      directories: directories.slice(),
      failed,
      errors: errors.slice(),
      done: false,
    })
    nodes.length = 0
    directories.length = 0
  }

  for (const pending of pendingStats) {
    const childResult = await safeStatResult(pending.path, follow)
    const childInfo = childResult.value
    if (!childInfo) {
      failed = true
      if (childResult.error) errors.push(childResult.error)
      continue
    }
    const childIsDir = childInfo.isDirectory()
    if (excluder.shouldSkip(pending.path, pending.name, childIsDir)) continue
    nodes.push(fromStats(task.root, pending.path, task.path, childDepth, childInfo, childIsDir))
    if (!pending.hintedDir && childIsDir && (maxDepth == null || childDepth < maxDepth)) {
      directories.push({
        root: task.root,
        path: pending.path,
        parentPath: task.path,
        depth: childDepth,
      })
    }
  }

  return { task, nodes, directories, failed, errors: errors.length > 0 ? errors : undefined, done: true }
}
