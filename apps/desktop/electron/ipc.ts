import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ALL_LIBRARIES_ID,
  getEntryById,
  getLibrary,
  membershipLibraryIdFor,
  NestifyRuntime,
  relocateOnDisk,
} from '@nestify/core'
import { ThumbnailCancelledError } from '../../../packages/core/src/preview/thumbnail-service.ts'
import {
  type PlanScopeInput,
  type RuntimeLibraryPatch,
  type RuntimeRuleSetCreate,
  type RuntimeRuleSetPatch,
  type RuntimeSearchOptions,
  toLibraryPayload,
  toRuleSetPayload,
} from './payloads'
import { logStartup } from './log'
import { getQueryWorker } from './query-worker-host'
import { getRuntime } from './runtime-host'
import { startLibraryWriter, stopLibraryWriter } from './writer-worker-host'
import { appState, IMAGE_EXT, MAX_IMAGE_PREVIEW, THUMBNAIL_PRIORITY, VIDEO_EXT } from './state'
import {
  cancelLibraryThumbnailRequests,
  getThumbnailService,
  isInsideDirectory,
  mimeForImage,
  thumbnailUnavailable,
  thumbnailUrl,
} from './thumbnails'
import { minimizeToTray, registerSpotlightShortcuts, showSpotlightWindow, closeSpotlightWindow, resizeSpotlightWindow } from './window'
import {
  DEFAULT_SETTINGS,
  normalizeAccelerator,
  readSettings,
  settingsPath,
  writeSettings,
} from './settings'

export function registerIpc(): void {
  if (appState.ipcRegistered) return
  appState.ipcRegistered = true
  registerLibraryIpc()
  registerSettingsIpc()
  registerWindowIpc()
  registerScanSearchIpc()
  registerRulesIpc()
  registerPlanIpc()
  registerPreviewIpc()
}

function registerSettingsIpc(): void {
  ipcMain.handle('settings.get', () => readSettings())
  ipcMain.handle('settings.update', async (_event, input: Record<string, unknown>) => {
    const current = await readSettings()
    const next = {
      ...current,
      ...(Number.isFinite(input.scanConcurrency) ? { scanConcurrency: Math.max(1, Math.min(32, Number(input.scanConcurrency))) } : {}),
      ...(Number.isFinite(input.thumbnailConcurrency) ? { thumbnailConcurrency: Math.max(1, Math.min(32, Number(input.thumbnailConcurrency))) } : {}),
      ...(Number.isFinite(input.searchDebounceMs) ? { searchDebounceMs: Math.max(0, Math.min(2000, Number(input.searchDebounceMs))) } : {}),
      ...(typeof input.spotlightShortcut === 'string' && normalizeAccelerator(input.spotlightShortcut)
        ? { spotlightShortcut: normalizeAccelerator(input.spotlightShortcut)! }
        : {}),
      ...(typeof input.minimizeToTrayOnClose === 'boolean' ? { minimizeToTrayOnClose: input.minimizeToTrayOnClose } : {}),
    }
    await writeSettings(next)
    getRuntime().setScanConcurrency(next.scanConcurrency)
    const shortcutRegistered = await registerSpotlightShortcuts()
    if (!shortcutRegistered) throw new Error('快捷键注册失败，可能已被其他应用占用')
    logStartup('settings.updated', next)
    return next
  })
}

function registerLibraryIpc(): void {
  ipcMain.handle('library.list', async () => {
    const libraries = getRuntime().listLibraries().map(toLibraryPayload)
    logStartup('library.list', {
      count: libraries.length,
      libraries: libraries.map((library) => ({ id: library.id, name: library.name, roots: library.roots })),
    })
    return { libraries }
  })

  ipcMain.handle('library.add', async (_event, input: { name: string; roots: string[] }) => {
    const runtime = getRuntime()
    const library = runtime.addLibrary(input)
    startLibraryWriter(runtime, library)
    return { library: toLibraryPayload(library) }
  })

  ipcMain.handle('library.update', async (_event, input: { id: string; patch: RuntimeLibraryPatch }) => {
    const runtime = getRuntime()
    await stopLibraryWriter(runtime, input.id)
    const library = runtime.updateLibrary(input)
    startLibraryWriter(runtime, library)
    return { library: toLibraryPayload(library) }
  })

  ipcMain.handle('library.remove', async (_event, input: { id: string }) => {
    const currentRuntime = getRuntime()
    await cancelLibraryThumbnailRequests(input.id)
    await stopLibraryWriter(currentRuntime, input.id)
    currentRuntime.removeLibrary(input.id)
    const prunedThumbnails = await getThumbnailService().pruneOrphanCaches()
    return { ok: true as const, prunedThumbnails }
  })

  ipcMain.handle('dialog.pickDirectory', async () => {
    const parent = appState.mainWindow
    // Windows：托盘启动/后台唤起时父窗口可能不在前台，模态对话框会弹到主窗口后面
    // （视觉上"点了没反应"）。先把父窗口带到前台再弹对话框。
    if (parent && !parent.isDestroyed()) {
      if (parent.isMinimized()) parent.restore()
      parent.show()
      parent.focus()
    }
    const result = await dialog.showOpenDialog(parent ?? undefined, {
      properties: ['openDirectory', 'dontAddToRecent'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return { path: result.filePaths[0] }
  })

  ipcMain.handle('system.list-drive-roots', () => ({ roots: listDriveRoots() }))
}

function listDriveRoots(): string[] {
  if (process.platform !== 'win32') return ['/']
  return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
    .filter((root) => existsSync(root))
}

function registerWindowIpc(): void {
  ipcMain.handle('window.minimize-to-tray', () => {
    minimizeToTray()
    return { ok: true as const }
  })

  ipcMain.handle('window.quit', () => {
    appState.quitting = true
    app.quit()
    return { ok: true as const }
  })
  ipcMain.handle('window.open-spotlight', () => {
    showSpotlightWindow()
    return { ok: true as const }
  })
  ipcMain.handle('window.close-spotlight', () => {
    closeSpotlightWindow()
    return { ok: true as const }
  })
  ipcMain.handle('window.resize-spotlight', (_event, input: { height?: number }) => {
    const height = Math.max(120, Math.min(520, Math.round(input.height ?? 120)))
    resizeSpotlightWindow(height)
    return { ok: true as const }
  })

  ipcMain.handle('log.event', (_event, input: { event?: string; details?: unknown }) => {
    const event = input.event?.trim() || 'renderer.event'
    logStartup(event, input.details)
    return { ok: true as const }
  })
}

function registerScanSearchIpc(): void {
  ipcMain.handle('scan.start', async (_event, input: { libraryId: string }) =>
    runExclusiveFileOperation(() => {
      assertNoActiveScan()
      return Promise.resolve(getRuntime().startScan(input.libraryId))
    }),
  )
  ipcMain.handle('scan.progress', async () => {
    const progress = getRuntime().getScanProgress()
    return {
      phase: progress.phase,
      paused: progress.paused,
      filesScanned: progress.filesScanned,
      dirsScanned: progress.dirsScanned,
      bytesScanned: progress.bytesScanned,
      currentPath: progress.currentPath,
      errors: progress.errors,
      filesPerSecond: progress.filesPerSecond,
      jobId: progress.jobId ?? null,
      libraryId: progress.libraryId ?? null,
      jobStatus: progress.jobStatus ?? null,
    }
  })
  ipcMain.handle('scan.pause', async (_event, input: { jobId: string }) => getRuntime().pauseScan(input.jobId))
  ipcMain.handle('scan.resume', async (_event, input: { jobId: string }) => getRuntime().resumeScan(input.jobId))
  ipcMain.handle('scan.cancel', async (_event, input: { jobId: string }) => getRuntime().cancelScan(input.jobId))
  ipcMain.handle('search.cancel', async () => {
    appState.queryWorker?.cancel()
    return { cancelled: true as const }
  })

  ipcMain.handle(
    'search.query',
    async (
      _event,
      input: {
        libraryId: string
        text: string
        textMode?: 'full-text' | 'substring'
        limit?: number
        offset?: number
        cursor?: string
        resultMode?: 'hits-only' | 'hits-and-approximate-count' | 'hits-and-exact-stats'
        kinds?: string[]
        scope?: 'library' | 'directory' | 'selection'
        directory?: string
        directChildren?: boolean
        entryIds?: string[]
        sort?: {
          field: 'relevance' | 'mtime' | 'size' | 'path' | 'name' | 'path_mtime'
          direction?: 'asc' | 'desc'
        }
      },
    ) => {
      const { libraryId, text, ...options } = input
      const startedAt = Date.now()
      logStartup('search.query', { libraryId, text, options })
      try {
        const runtime = getRuntime()
        const isFreshSearch = (options.offset ?? 0) === 0 && options.cursor == null
        if (isFreshSearch && appState.queryWorker?.hasPending('search')) {
          appState.queryWorker.cancel()
        }
        const result = await getQueryWorker(runtime).search<ReturnType<NestifyRuntime['search']>>({
          ...options,
          libraryId,
          text,
        } satisfies Parameters<NestifyRuntime['search']>[2] & { libraryId: string; text: string })
        const response = {
          total: result.total,
          fileCount: result.fileCount,
          directoryCount: result.directoryCount,
          kindCounts: result.kindCounts,
          elapsedMs: result.elapsedMs,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          statsIncluded: result.statsIncluded,
          hits: result.hits.map((hit) => ({
            entryId: hit.entryId,
            libraryId: hit.libraryId,
            name: hit.name,
            path: hit.path,
            ext: hit.ext,
            kind: hit.kind,
            size: hit.size,
            mtime: hit.mtime,
            parent: hit.parent,
          })),
        }
        logStartup('search.result', {
          libraryId,
          text,
          total: response.total,
          hits: response.hits.length,
          elapsedMs: response.elapsedMs,
          ipcElapsedMs: Date.now() - startedAt,
        })
        return { result: response }
      } catch (error) {
        logStartup('search.failed', {
          libraryId,
          text,
          options,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          ipcElapsedMs: Date.now() - startedAt,
        })
        throw error
      }
    },
  )

  ipcMain.handle(
    'directory.children',
    async (
      _event,
      input: {
        libraryId: string
        directory: string
        limit?: number
        offset?: number
        sort?: {
          field: 'relevance' | 'mtime' | 'size' | 'path' | 'name' | 'path_mtime'
          direction?: 'asc' | 'desc'
        }
      },
    ) => {
      const startedAt = Date.now()
      const result = await getQueryWorker(getRuntime()).directory<ReturnType<NestifyRuntime['listDirectoryChildren']>>(
        input.libraryId,
        input.directory,
        input,
      )
      logStartup('directory.children.result', {
        libraryId: input.libraryId,
        directory: input.directory,
        hits: result.hits.length,
        elapsedMs: result.elapsedMs,
        ipcElapsedMs: Date.now() - startedAt,
      })
      return { result }
    },
  )
}

function registerRulesIpc(): void {
  ipcMain.handle('rules.list', async () => ({
    ruleSets: getRuntime().listRuleSets().map(toRuleSetPayload),
  }))
  ipcMain.handle('rules.get', async (_event, input: { id: string }) => {
    const ruleSet = getRuntime().getRuleSet(input.id)
    if (!ruleSet) throw new Error(`ruleset not found: ${input.id}`)
    return { ruleSet: toRuleSetPayload(ruleSet) }
  })
  ipcMain.handle('rules.create', async (_event, input: RuntimeRuleSetCreate) => ({
    ruleSet: toRuleSetPayload(getRuntime().createRuleSet(input)),
  }))
  ipcMain.handle('rules.update', async (_event, input: { id: string; patch: RuntimeRuleSetPatch }) => ({
    ruleSet: toRuleSetPayload(getRuntime().updateRuleSet(input.id, input.patch)),
  }))
  ipcMain.handle('rules.delete', async (_event, input: { id: string }) => {
    getRuntime().deleteRuleSet(input.id)
    return { ok: true as const }
  })
  ipcMain.handle('rules.enable', async (_event, input: { id: string; enabled: boolean }) => ({
    ruleSet: toRuleSetPayload(getRuntime().setRuleSetEnabled(input.id, input.enabled)),
  }))
  ipcMain.handle('rules.priority', async (_event, input: { id: string; priority: number }) => ({
    ruleSet: toRuleSetPayload(getRuntime().setRuleSetPriority(input.id, input.priority)),
  }))
  ipcMain.handle(
    'rules.clone',
    async (_event, input: { sourceId: string; name?: string; priority?: number; enabled?: boolean }) => ({
      ruleSet: toRuleSetPayload(getRuntime().cloneRuleSet(input.sourceId, input)),
    }),
  )
  ipcMain.handle('rules.export', async (_event, input: { id: string }) => {
    const yaml = getRuntime().exportRuleSet(input.id)
    const parent = appState.mainWindow
    if (parent && !parent.isDestroyed()) {
      if (parent.isMinimized()) parent.restore()
      parent.show()
      parent.focus()
    }
    const result = await dialog.showSaveDialog(parent ?? undefined, {
      title: '导出规则集',
      defaultPath: `${getRuntime().getRuleSet(input.id)?.name ?? 'ruleset'}.yaml`,
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    })
    if (result.canceled || !result.filePath) return { yaml, path: null }
    await writeFile(result.filePath, yaml, 'utf8')
    return { yaml, path: result.filePath }
  })
  ipcMain.handle('rules.import', async () => {
    const parent = appState.mainWindow
    if (parent && !parent.isDestroyed()) {
      if (parent.isMinimized()) parent.restore()
      parent.show()
      parent.focus()
    }
    const result = await dialog.showOpenDialog(parent ?? undefined, {
      title: '导入规则集',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const yaml = await readFile(path, 'utf8')
    return { ruleSet: toRuleSetPayload(getRuntime().importRuleSet(yaml)) }
  })
}

function registerPlanIpc(): void {
  ipcMain.handle(
    'rules.preview',
    async (
      _event,
      input: PlanScopeInput & { libraryId: string; ruleSetId: string; collision?: 'suffix' | 'skip' | 'overwrite' },
    ) => ({ plan: getRuntime().previewRules(input) }),
  )
  ipcMain.handle(
    'rename.preview',
    async (
      _event,
      input: PlanScopeInput & { libraryId: string; template: string; collision?: 'suffix' | 'skip' | 'overwrite' },
    ) => ({ plan: getRuntime().previewRename(input) }),
  )
  ipcMain.handle(
    'plan.execute',
    async (
      _event,
      input: { libraryId: string; plan: Parameters<NestifyRuntime['executePlan']>[0]['plan']; selectedOps?: number[] },
    ) => runExclusiveFileOperation(() => {
      assertNoActiveScan()
      return getRuntime().executePlan(input)
    }),
  )
  ipcMain.handle('plan.rollback', async (_event, input: { jobId: string }) =>
    runExclusiveFileOperation(() => {
      assertNoActiveScan()
      return getRuntime().rollbackPlan(input.jobId)
    }),
  )
  ipcMain.handle('jobs.list', async (_event, input?: { libraryId?: string; limit?: number }) => ({
    jobs: getRuntime().listJobs(input),
  }))
  ipcMain.handle('job.ops', async (_event, input: { jobId: string }) => ({
    ops: getRuntime().listJobOps(input.jobId),
  }))
  ipcMain.handle('duplicates.analyze', async (_event, input: Parameters<NestifyRuntime['analyzeDuplicates']>[0]) =>
    getRuntime().analyzeDuplicates(input),
  )
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

function runExclusiveFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  const execution = appState.fileOperationTail.then(operation)
  appState.fileOperationTail = execution.then(
    () => undefined,
    () => undefined,
  )
  return execution
}

function assertNoActiveScan(): void {
  const active = getRuntime().getActiveScanJob()
  if (active && (active.status === 'running' || active.status === 'paused' || active.status === 'cancelling')) {
    throw new Error('扫描正在进行，请先暂停或取消后再修改文件')
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
  if (library.roots.some((root) => source.replaceAll('\\', '/').toLowerCase() === root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase())) {
    throw new Error('不能删除资料库根目录')
  }
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

function registerPreviewIpc(): void {
  ipcMain.handle('preview.file', async (_event, input: { path: string }) => {
    try {
      const ext = extname(input.path).toLowerCase()
      if (IMAGE_EXT.has(ext)) {
        const info = await stat(input.path)
        if (info.size > MAX_IMAGE_PREVIEW) return { kind: 'too-large' as const }
        const buf = await readFile(input.path)
        return { kind: 'image' as const, dataUrl: `data:${mimeForImage(ext)};base64,${buf.toString('base64')}` }
      }
      if (VIDEO_EXT.has(ext)) return { kind: 'video' as const, src: pathToFileURL(input.path).href }
      return { kind: 'none' as const }
    } catch {
      return { kind: 'none' as const }
    }
  })

  ipcMain.handle(
    'preview.thumbnail',
    async (
      _event,
      input: {
        requestId?: string
        libraryId?: string
        entryId?: string
        kind?: 'image' | 'video'
        width?: number
        height?: number
        size?: number
        priority?: 'selected' | 'visible' | 'background'
      },
    ) => {
      const requestId = input.requestId?.trim()
      if (requestId && appState.thumbnailRequests.has(requestId)) {
        return thumbnailUnavailable(input.entryId?.trim() ?? '', 'invalid_request', 'requestId is already active', false)
      }
      if (!input.libraryId?.trim() || !input.entryId?.trim()) {
        return thumbnailUnavailable(input.entryId?.trim() ?? '', 'invalid_request', 'libraryId and entryId are required', false)
      }

      const entryId = input.entryId.trim()
      const libraryId = input.libraryId.trim()
      const request = requestId ? { controller: new AbortController(), libraryId, entryId } : null
      if (requestId && request) appState.thumbnailRequests.set(requestId, request)

      try {
        const currentRuntime = getRuntime()
        const entry = getEntryById(currentRuntime.db, entryId)
        const membershipLibraryId =
          libraryId === ALL_LIBRARIES_ID
            ? membershipLibraryIdFor(currentRuntime.db, entryId)
            : membershipLibraryIdFor(currentRuntime.db, entryId, libraryId)
        if (!entry || !membershipLibraryId || entry.tombstone) {
          return thumbnailUnavailable(entryId, 'entry_not_found', 'entry not found in library', false)
        }
        if (entry.isDir || entry.kind !== 'image' || entry.protocol !== 'local') {
          return thumbnailUnavailable(entryId, 'unsupported_kind', 'only local image entries are supported', false)
        }
        if (input.kind && input.kind !== 'image') {
          return thumbnailUnavailable(entryId, 'unsupported_kind', 'requested kind is not an image', false)
        }
        if (!IMAGE_EXT.has(extname(entry.path).toLowerCase()) || !isAbsolute(entry.path)) {
          return thumbnailUnavailable(entryId, 'unsupported_kind', 'entry has an unsupported image path', false)
        }

        const library = getLibrary(currentRuntime.db, membershipLibraryId)
        const insideLibraryRoot = library?.roots.some((root) => isInsideDirectory(root, entry.path))
        if (!insideLibraryRoot) {
          return thumbnailUnavailable(entryId, 'entry_not_found', 'entry is outside its library roots', false)
        }

        const info = await stat(entry.path)
        const mtime = Math.trunc(info.mtimeMs)
        if (!info.isFile() || info.size !== entry.size || mtime !== entry.mtime) {
          return thumbnailUnavailable(
            entryId,
            'generation_failed',
            'source file changed since the last scan; rescan the library',
            true,
          )
        }
        if (request?.controller.signal.aborted) {
          return thumbnailUnavailable(entryId, 'cancelled', 'thumbnail generation was cancelled', true)
        }

        const result = await getThumbnailService().getThumbnail(
          {
            entryId,
            sizeBytes: info.size,
            mtime,
            generatorVersion: 2,
            sourcePath: entry.path,
          },
          {
            priority: THUMBNAIL_PRIORITY[input.priority ?? 'visible'],
            signal: request?.controller.signal,
          },
        )

        return {
          entryId,
          kind: 'image',
          cacheKey: result.cacheKey,
          mime: result.mime,
          width: result.width,
          height: result.height,
          url: thumbnailUrl(result.cacheKey, result.mime),
          error: null,
        }
      } catch (error) {
        if (error instanceof ThumbnailCancelledError) {
          return thumbnailUnavailable(entryId, 'cancelled', 'thumbnail generation was cancelled', true)
        }
        return thumbnailUnavailable(
          entryId,
          'generation_failed',
          error instanceof Error ? error.message : 'thumbnail generation failed',
          true,
        )
      } finally {
        if (requestId) appState.thumbnailRequests.delete(requestId)
      }
    },
  )

  ipcMain.handle('preview.thumbnail.cancel', async (_event, input: { requestId?: string }) => {
    const requestId = input.requestId?.trim()
    const request = requestId ? appState.thumbnailRequests.get(requestId) : undefined
    if (!request) return { cancelled: false as const }
    request.controller.abort()
    return { cancelled: true as const }
  })
}
