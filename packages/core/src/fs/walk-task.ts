import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createExcluder, type ExcludeSpec } from './exclude.ts'
import { fromStats, safeStat, type WalkedEntry } from './walk.ts'
import { toLongPath } from './path.ts'

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
}

export interface WalkTaskOptions {
  followSymlinks?: boolean
  scanHidden?: boolean
  maxDepth?: number | null
  exclude?: ExcludeSpec
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
  const info = await safeStat(task.path, follow)
  if (!info) return { task, nodes: [], directories: [], failed: true }
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
  if (!isDir || (maxDepth != null && task.depth >= maxDepth)) {
    return { task, nodes, directories, failed: false }
  }

  let children: Dirent[]
  try {
    children = await readdir(toLongPath(task.path), { withFileTypes: true })
  } catch {
    return { task, nodes, directories, failed: true }
  }

  const childDepth = task.depth + 1
  for (const child of children) {
    if (child.name === '.' || child.name === '..') continue
    if (!follow && isLinkDirent(child)) continue

    const childPath = join(task.path, child.name)
    const childInfo = await safeStat(childPath, follow)
    if (!childInfo) continue
    const childIsDir = childInfo.isDirectory()
    const childName = basename(childPath)
    if (excluder.shouldSkip(childPath, childName, childIsDir)) continue
    if (!scanHidden && isHiddenName(childName)) continue

    if (childIsDir && (maxDepth == null || childDepth < maxDepth)) {
      directories.push({
        root: task.root,
        path: childPath,
        parentPath: task.path,
        depth: childDepth,
      })
    } else {
      // Directory nodes are emitted by their own task. Emitting them here as
      // well would make every recursive directory appear twice.
      nodes.push(fromStats(task.root, childPath, task.path, childDepth, childInfo, childIsDir))
    }
  }

  return { task, nodes, directories, failed: false }
}
