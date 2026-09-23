import { clipboard, ipcMain, shell } from 'electron'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { getLibrary, relocateOnDisk } from '@nestify/core'
import { getRuntime } from './runtime-host'
import { appState } from './state'
import { isInsideDirectory } from './thumbnails'

export function registerFileOperationsIpc(): void {
  ipcMain.handle('shell.reveal', async (_event, input: { path: string }) => {
    await stat(input.path)
    shell.showItemInFolder(input.path)
    return { ok: true as const }
  })
  ipcMain.handle('shell.open', async (_event, input: { path: string }) => {
    const openError = await shell.openPath(input.path)
    if (openError) throw new Error(openError)
    return { ok: true as const }
  })
  ipcMain.handle('shell.openExternal', async (_event, input: { url: string }) => {
    const url = typeof input?.url === 'string' ? input.url.trim() : ''
    if (!isAllowedExternalUrl(url)) throw new Error('不允许打开该链接')
    await shell.openExternal(url)
    return { ok: true as const }
  })
  ipcMain.handle('clipboard.writeText', (_event, input: { text: string }) => {
    clipboard.writeText(input.text)
    return { ok: true as const }
  })
  ipcMain.handle('file.rename', async (_event, input: { libraryId: string; path: string; name: string }) =>
    runExclusiveFileOperation(() => renameFile(input)),
  )
  ipcMain.handle('file.move', async (_event, input: { libraryId: string; path: string; directory: string }) =>
    runExclusiveFileOperation(() => moveFile(input)),
  )
  ipcMain.handle('file.delete', async (_event, input: { libraryId: string; path: string }) =>
    runExclusiveFileOperation(() => deleteFile(input)),
  )
}

export function runExclusiveFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  const execution = appState.fileOperationTail.then(operation)
  appState.fileOperationTail = execution.then(
    () => undefined,
    () => undefined,
  )
  return execution
}

export function assertNoActiveScan(): void {
  const active = getRuntime().getActiveScanJob()
  if (active && (active.status === 'running' || active.status === 'paused' || active.status === 'cancelling')) {
    throw new Error('扫描正在进行，请先暂停或取消后再修改文件')
  }
}

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'gitee.com' || host.endsWith('.gitee.com') || host === 'github.com' || host.endsWith('.github.com')
  } catch {
    return false
  }
}

async function renameFile(input: { libraryId: string; path: string; name: string }): Promise<{ ok: true }> {
  assertNoActiveScan()
  const runtime = getRuntime()
  const library = getLibrary(runtime.db, input.libraryId)
  if (!library) throw new Error('资料库不存在')
  const source = statPathInLibrary(library.roots, input.path)
  const name = input.name.trim()
  if (!name || name.includes('\\') || name.includes('/') || name === '.' || name === '..') throw new Error('名称无效')
  const target = join(dirname(source), name)
  await relocateSafely(source, target)
  await runtime.refreshLibrariesContainingPaths([source, target])
  return { ok: true }
}

async function moveFile(input: { libraryId: string; path: string; directory: string }): Promise<{ ok: true }> {
  assertNoActiveScan()
  const runtime = getRuntime()
  const library = getLibrary(runtime.db, input.libraryId)
  if (!library) throw new Error('资料库不存在')
  const source = statPathInLibrary(library.roots, input.path)
  const directory = statPathInLibrary(library.roots, input.directory)
  const directoryInfo = await stat(directory)
  if (!directoryInfo.isDirectory()) throw new Error('目标必须是目录')
  if (isInsideDirectory(source, directory)) throw new Error('不能把目录移动到自身或子目录内')
  const target = join(directory, basename(source))
  await relocateSafely(source, target)
  await runtime.refreshLibrariesContainingPaths([source, target])
  return { ok: true }
}

async function deleteFile(input: { libraryId: string; path: string }): Promise<{ ok: true }> {
  assertNoActiveScan()
  const runtime = getRuntime()
  const library = getLibrary(runtime.db, input.libraryId)
  if (!library) throw new Error('资料库不存在')
  const source = statPathInLibrary(library.roots, input.path)
  const isLibraryRoot = library.roots.some((root) =>
    source.replaceAll('\\', '/').toLowerCase() === root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase(),
  )
  if (isLibraryRoot) throw new Error('不能删除资料库根目录')
  assertNotProtectedPath(source)
  await rm(source, { recursive: true, force: false })
  await runtime.refreshLibrariesContainingPaths([source])
  return { ok: true }
}

async function relocateSafely(source: string, target: string): Promise<void> {
  assertNotProtectedPath(source)
  assertNotProtectedPath(target)
  const sourceInfo = await stat(source)
  const targetExists = await stat(target).then(() => true, () => false)
  const samePath = source.toLowerCase() === target.toLowerCase()
  if (targetExists && !samePath) throw new Error('目标路径已存在')
  if (sourceInfo.isDirectory() && isInsideDirectory(source, target)) throw new Error('目标路径位于源目录内')
  if (samePath) return
  await mkdir(dirname(target), { recursive: true })
  await relocateOnDisk(source, target)
}

function assertNotProtectedPath(path: string): void {
  const protectedPaths = [
    process.env.SystemRoot,
    process.env.windir,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
  ].filter((value): value is string => Boolean(value))
  const normalized = path.toLowerCase()
  for (const protectedPath of protectedPaths) {
    const base = protectedPath.toLowerCase().replace(/[\\/]+$/, '')
    if (normalized === base || normalized.startsWith(`${base}\\`) || normalized.startsWith(`${base}/`)) {
      throw new Error('系统目录受保护，不能修改')
    }
  }
}

function statPathInLibrary(roots: string[], path: string): string {
  const candidate = path.trim()
  if (!candidate || !isAbsolute(candidate)) throw new Error('路径无效')
  const normalized = candidate.replaceAll('/', '\\').toLowerCase()
  const inside = roots.some((root) => {
    const base = root.replaceAll('/', '\\').replace(/[\\]+$/, '').toLowerCase()
    return normalized === base || normalized.startsWith(`${base}\\`)
  })
  if (!inside) throw new Error('只能操作资料库根目录内的路径')
  return candidate
}
