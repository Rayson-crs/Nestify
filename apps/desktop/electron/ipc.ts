import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ALL_LIBRARIES_ID, getEntryById, getLibrary, membershipLibraryIdFor, NestifyRuntime } from '@nestify/core'
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
import { getRuntime } from './runtime-host'
import { appState, IMAGE_EXT, MAX_IMAGE_PREVIEW, THUMBNAIL_PRIORITY, VIDEO_EXT } from './state'
import {
  cancelLibraryThumbnailRequests,
  getThumbnailService,
  isInsideDirectory,
  mimeForImage,
  thumbnailUnavailable,
  thumbnailUrl,
} from './thumbnails'
import { minimizeToTray } from './window'

export function registerIpc(): void {
  if (appState.ipcRegistered) return
  appState.ipcRegistered = true
  registerLibraryIpc()
  registerWindowIpc()
  registerScanSearchIpc()
  registerRulesIpc()
  registerPlanIpc()
  registerPreviewIpc()
}

function registerLibraryIpc(): void {
  ipcMain.handle('library.list', async () => ({
    libraries: getRuntime().listLibraries().map(toLibraryPayload),
  }))

  ipcMain.handle('library.add', async (_event, input: { name: string; roots: string[] }) => ({
    library: toLibraryPayload(getRuntime().addLibrary(input)),
  }))

  ipcMain.handle('library.update', async (_event, input: { id: string; patch: RuntimeLibraryPatch }) => ({
    library: toLibraryPayload(getRuntime().updateLibrary(input)),
  }))

  ipcMain.handle('library.remove', async (_event, input: { id: string }) => {
    const currentRuntime = getRuntime()
    await cancelLibraryThumbnailRequests(input.id)
    currentRuntime.removeLibrary(input.id)
    const prunedThumbnails = await getThumbnailService().pruneOrphanCaches()
    return { ok: true as const, prunedThumbnails }
  })

  ipcMain.handle('dialog.pickDirectory', async () => {
    const result = await dialog.showOpenDialog(appState.mainWindow ?? undefined, {
      properties: ['openDirectory', 'dontAddToRecent'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return { path: result.filePaths[0] }
  })
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

  ipcMain.handle('log.event', (_event, input: { event?: string; details?: unknown }) => {
    const event = input.event?.trim() || 'renderer.event'
    logStartup(event, input.details)
    return { ok: true as const }
  })
}

function registerScanSearchIpc(): void {
  ipcMain.handle('scan.start', async (_event, input: { libraryId: string }) => getRuntime().startScan(input.libraryId))
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

  ipcMain.handle(
    'search.query',
    async (
      _event,
      input: {
        libraryId: string
        text: string
        limit?: number
        offset?: number
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
      const result = getRuntime().search(libraryId, text, options as RuntimeSearchOptions)
      return {
        result: {
          total: result.total,
          elapsedMs: result.elapsedMs,
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
        },
      }
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
    const result = await dialog.showSaveDialog(appState.mainWindow ?? undefined, {
      title: '导出规则集',
      defaultPath: `${getRuntime().getRuleSet(input.id)?.name ?? 'ruleset'}.yaml`,
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    })
    if (result.canceled || !result.filePath) return { yaml, path: null }
    await writeFile(result.filePath, yaml, 'utf8')
    return { yaml, path: result.filePath }
  })
  ipcMain.handle('rules.import', async () => {
    const result = await dialog.showOpenDialog(appState.mainWindow ?? undefined, {
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
    ) => getRuntime().executePlan(input),
  )
  ipcMain.handle('plan.rollback', async (_event, input: { jobId: string }) => getRuntime().rollbackPlan(input.jobId))
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