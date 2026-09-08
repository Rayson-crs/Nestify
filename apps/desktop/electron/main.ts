import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getEntryById, getLibrary, NestifyRuntime } from '@nestify/core'
import {
  ThumbnailCacheService,
  ThumbnailCancelledError,
  type ThumbnailGenerator,
} from '../../../packages/core/src/preview/thumbnail-service.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

let runtime: NestifyRuntime | null = null
let thumbnailService: ThumbnailCacheService | null = null
let mainWindow: BrowserWindow | null = null
let ipcRegistered = false

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif'])
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'])
const MAX_IMAGE_PREVIEW = 8 * 1024 * 1024
const THUMBNAIL_SIZE = 192
const THUMBNAIL_PRIORITY = {
  selected: 30,
  visible: 20,
  background: 10,
} as const

type PlanPreviewScope = 'library' | 'directory' | 'selection'
type PlanScopeInput = {
  scope?: PlanPreviewScope
  entryIds?: string[]
  directory?: string
}
type RuntimeSearchOptions = Parameters<NestifyRuntime['search']>[2]
type ThumbnailPreviewErrorCode =
  | 'invalid_request'
  | 'not_implemented'
  | 'entry_not_found'
  | 'unsupported_kind'
  | 'generation_failed'
  | 'cancelled'

type RuntimeRuleSet = ReturnType<NestifyRuntime['listRuleSets']>[number]
type RuntimeRuleSetCreate = Parameters<NestifyRuntime['createRuleSet']>[0]
type RuntimeRuleSetPatch = Partial<
  Omit<RuntimeRuleSet, 'id' | 'builtin' | 'enabled' | 'priority' | 'createdAt' | 'updatedAt'>
>

function toRuleSetPayload(set: RuntimeRuleSet) {
  return {
    id: set.id,
    name: set.name,
    description: set.description,
    dryRunDefault: set.dryRunDefault,
    collision: set.collision,
    builtin: set.builtin,
    enabled: set.enabled,
    priority: set.priority,
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
    rules: set.rules.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      priority: rule.priority,
      action: rule.action,
      match: rule.match,
      template: rule.template,
      extract: rule.extract,
      reason: rule.reason,
    })),
  }
}

function thumbnailUnavailable(
  entryId: string,
  code: ThumbnailPreviewErrorCode,
  message: string,
  retryable: boolean,
) {
  return {
    entryId,
    kind: null,
    cacheKey: '',
    mime: null,
    width: null,
    height: null,
    url: null,
    error: { code, message, retryable },
  }
}

function resolvePreload(): string {
  return join(__dirname, 'preload.cjs')
}

function resolveRendererIndex(): string {
  return join(__dirname, '..', 'dist', 'index.html')
}

function rendererFailureUrl(title: string, details: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(renderErrorPage(title, details))}`
}

function resolveBundledConfigDir(): string {
  if (process.env.NESTIFY_CONFIG_DIR) return process.env.NESTIFY_CONFIG_DIR
  const packaged = join(process.resourcesPath, 'config')
  if (app.isPackaged && existsSync(join(packaged, 'app.default.yaml'))) return packaged
  const seeds = [
    join(process.cwd(), 'config'),
    join(process.cwd(), '..', 'config'),
    join(process.cwd(), '..', '..', 'config'),
    join(app.getAppPath(), 'config'),
    join(app.getAppPath(), '..', 'config'),
    join(app.getAppPath(), '..', '..', 'config'),
  ]
  for (const dir of seeds) {
    if (existsSync(join(dir, 'app.default.yaml'))) return dir
  }
  return join(process.cwd(), 'config')
}

function createWindow(): void {
  const preloadPath = resolvePreload()
  const rendererIndex = resolveRendererIndex()
  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  console.info('[Nestify] renderer paths', {
    isPackaged: app.isPackaged,
    preloadPath,
    preloadExists: existsSync(preloadPath),
    rendererIndex,
    rendererIndexExists: existsSync(rendererIndex),
    rendererUrl: rendererUrl ?? null,
  })

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#161513',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })

  const window = mainWindow
  const showWindow = () => {
    if (!window.isDestroyed()) window.show()
  }

  const showTimer = setTimeout(showWindow, 2500)
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('[Nestify renderer]', { level, message, line, sourceId })
  })
  window.once('ready-to-show', showWindow)
  window.webContents.on('did-finish-load', () => {
    clearTimeout(showTimer)
    showWindow()
    setTimeout(() => {
      if (window.isDestroyed()) return
      void window.webContents
        .executeJavaScript(`(() => ({
          title: document.title,
          rootChildren: document.getElementById('root')?.childElementCount ?? -1,
          bodyTextLength: document.body.innerText.trim().length,
          ipcReady: Boolean(window.nestify),
        }))()`)
        .then((health) => console.info('[Nestify] renderer health', health))
        .catch((error: unknown) =>
          console.error('[Nestify] renderer health check failed', error),
        )
    }, 1000)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    clearTimeout(showTimer)
    console.error('[Nestify] renderer failed to load', {
      errorCode,
      errorDescription,
      validatedURL,
    })
    showWindow()
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderErrorPage(
      '渲染页面加载失败',
      `${errorDescription} (${errorCode})\\n${validatedURL}`,
    ))}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    clearTimeout(showTimer)
    console.error('[Nestify] renderer process exited', details)
    showWindow()
    if (!window.isDestroyed()) {
      void window.loadURL(rendererFailureUrl(
        'Nestify 渲染进程已退出',
        JSON.stringify(details, null, 2),
      ))
    }
  })

  const loadPromise = rendererUrl
    ? window.loadURL(rendererUrl)
    : existsSync(rendererIndex)
      ? window.loadFile(rendererIndex)
      : Promise.reject(new Error(`Renderer entry not found: ${rendererIndex}`))

  void loadPromise.catch((error: unknown) => {
    clearTimeout(showTimer)
    console.error('[Nestify] renderer load failed', error)
    showWindow()
    return window.loadURL(rendererFailureUrl(
      'Nestify 无法加载界面',
      error instanceof Error ? error.stack ?? error.message : String(error),
    ))
  })
}

function renderErrorPage(title: string, details: string): string {
  const escapedTitle = escapeHtml(title)
  const escapedDetails = escapeHtml(details)
  return `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><title>${escapedTitle}</title>
    <style>
      body { margin: 0; padding: 32px; color: #f5f5f4; background: #161513; font: 14px/1.5 system-ui, sans-serif; }
      main { max-width: 900px; margin: 0 auto; }
      h1 { font-size: 22px; font-weight: 600; }
      pre { white-space: pre-wrap; color: #fca5a5; background: #292524; padding: 16px; border-radius: 6px; }
    </style>
  </head>
  <body><main><h1>${escapedTitle}</h1><pre>${escapedDetails}</pre></main></body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
}

function getRuntime(): NestifyRuntime {
  if (!runtime) {
    runtime = new NestifyRuntime({
      bundledConfigDir: resolveBundledConfigDir(),
    })
  }
  return runtime
}

function mimeForImage(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('library.list', async () => {
    const libraries = getRuntime().listLibraries().map((library) => ({
      id: library.id,
      name: library.name,
      roots: library.roots,
      updatedAt: library.updatedAt,
    }))
    return { libraries }
  })

  ipcMain.handle('library.add', async (_event, input: { name: string; roots: string[] }) => {
    const library = getRuntime().addLibrary(input)
    return {
      library: {
        id: library.id,
        name: library.name,
        roots: library.roots,
        updatedAt: library.updatedAt,
      },
    }
  })

  ipcMain.handle('library.remove', async (_event, input: { id: string }) => {
    getRuntime().removeLibrary(input.id)
    return { ok: true as const }
  })

  ipcMain.handle('dialog.pickDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      properties: ['openDirectory', 'dontAddToRecent'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return { path: result.filePaths[0] }
  })

  ipcMain.handle('scan.start', async (_event, input: { libraryId: string }) => {
    return getRuntime().startScan(input.libraryId)
  })

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
    }
  })

  ipcMain.handle('scan.pause', async (_event, input: { jobId: string }) => {
    return getRuntime().pauseScan(input.jobId)
  })

  ipcMain.handle('scan.resume', async (_event, input: { jobId: string }) => {
    return getRuntime().resumeScan(input.jobId)
  })

  ipcMain.handle('scan.cancel', async (_event, input: { jobId: string }) => {
    return getRuntime().cancelScan(input.jobId)
  })

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
        entryIds?: string[]
        sort?: { field: 'relevance' | 'mtime' | 'size' | 'path' | 'name'; direction?: 'asc' | 'desc' }
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

  ipcMain.handle('rules.list', async () => {
    const ruleSets = getRuntime().listRuleSets().map(toRuleSetPayload)
    return { ruleSets }
  })

  ipcMain.handle('rules.get', async (_event, input: { id: string }) => {
    const ruleSet = getRuntime().getRuleSet(input.id)
    if (!ruleSet) throw new Error(`ruleset not found: ${input.id}`)
    return { ruleSet: toRuleSetPayload(ruleSet) }
  })

  ipcMain.handle('rules.create', async (_event, input: RuntimeRuleSetCreate) => {
    return { ruleSet: toRuleSetPayload(getRuntime().createRuleSet(input)) }
  })

  ipcMain.handle(
    'rules.update',
    async (_event, input: { id: string; patch: RuntimeRuleSetPatch }) => {
      return { ruleSet: toRuleSetPayload(getRuntime().updateRuleSet(input.id, input.patch)) }
    },
  )

  ipcMain.handle('rules.delete', async (_event, input: { id: string }) => {
    getRuntime().deleteRuleSet(input.id)
    return { ok: true as const }
  })

  ipcMain.handle(
    'rules.enable',
    async (_event, input: { id: string; enabled: boolean }) => {
      return { ruleSet: toRuleSetPayload(getRuntime().setRuleSetEnabled(input.id, input.enabled)) }
    },
  )

  ipcMain.handle(
    'rules.priority',
    async (_event, input: { id: string; priority: number }) => {
      return { ruleSet: toRuleSetPayload(getRuntime().setRuleSetPriority(input.id, input.priority)) }
    },
  )

  ipcMain.handle(
    'rules.clone',
    async (
      _event,
      input: { sourceId: string; name?: string; priority?: number; enabled?: boolean },
    ) => {
      return { ruleSet: toRuleSetPayload(getRuntime().cloneRuleSet(input.sourceId, input)) }
    },
  )

  ipcMain.handle('rules.export', async (_event, input: { id: string }) => {
    const yaml = getRuntime().exportRuleSet(input.id)
    const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
      title: '导出规则集',
      defaultPath: `${getRuntime().getRuleSet(input.id)?.name ?? 'ruleset'}.yaml`,
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    })
    if (result.canceled || !result.filePath) return { yaml, path: null }
    await writeFile(result.filePath, yaml, 'utf8')
    return { yaml, path: result.filePath }
  })

  ipcMain.handle('rules.import', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '导入规则集',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const yaml = await readFile(path, 'utf8')
    return { ruleSet: toRuleSetPayload(getRuntime().importRuleSet(yaml)) }
  })

  ipcMain.handle(
    'rules.preview',
    async (
      _event,
      input: PlanScopeInput & {
        libraryId: string
        ruleSetId: string
        collision?: 'suffix' | 'skip' | 'overwrite'
      },
    ) => {
      return { plan: getRuntime().previewRules(input) }
    },
  )

  ipcMain.handle(
    'rename.preview',
    async (
      _event,
      input: PlanScopeInput & {
        libraryId: string
        template: string
        collision?: 'suffix' | 'skip' | 'overwrite'
      },
    ) => {
      return { plan: getRuntime().previewRename(input) }
    },
  )

  ipcMain.handle(
    'plan.execute',
    async (
      _event,
      input: { libraryId: string; plan: Parameters<NestifyRuntime['executePlan']>[0]['plan']; selectedOps?: number[] },
    ) => getRuntime().executePlan(input),
  )

  ipcMain.handle('plan.rollback', async (_event, input: { jobId: string }) => {
    return getRuntime().rollbackPlan(input.jobId)
  })

  ipcMain.handle(
    'jobs.list',
    async (_event, input?: { libraryId?: string; limit?: number }) => {
      return { jobs: getRuntime().listJobs(input) }
    },
  )

  ipcMain.handle('job.ops', async (_event, input: { jobId: string }) => {
    return { ops: getRuntime().listJobOps(input.jobId) }
  })

  ipcMain.handle(
    'duplicates.analyze',
    async (
      _event,
      input: Parameters<NestifyRuntime['analyzeDuplicates']>[0],
    ) => getRuntime().analyzeDuplicates(input),
  )

  ipcMain.handle('shell.reveal', async (_event, input: { path: string }) => {
    shell.showItemInFolder(input.path)
    return { ok: true as const }
  })

  ipcMain.handle('shell.open', async (_event, input: { path: string }) => {
    await shell.openPath(input.path)
    return { ok: true as const }
  })

  ipcMain.handle('preview.file', async (_event, input: { path: string }) => {
    try {
      const ext = extname(input.path).toLowerCase()
      if (IMAGE_EXT.has(ext)) {
        const info = await stat(input.path)
        if (info.size > MAX_IMAGE_PREVIEW) return { kind: 'too-large' as const }
        const buf = await readFile(input.path)
        return {
          kind: 'image' as const,
          dataUrl: `data:${mimeForImage(ext)};base64,${buf.toString('base64')}`,
        }
      }
      if (VIDEO_EXT.has(ext)) {
        return { kind: 'video' as const, src: pathToFileURL(input.path).href }
      }
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
        libraryId?: string
        entryId?: string
        kind?: 'image' | 'video'
        width?: number
        height?: number
        size?: number
        priority?: 'selected' | 'visible' | 'background'
      },
    ) => {
      if (!input.libraryId?.trim() || !input.entryId?.trim()) {
        return thumbnailUnavailable(
          input.entryId?.trim() ?? '',
          'invalid_request',
          'libraryId and entryId are required',
          false,
        )
      }

      const entryId = input.entryId.trim()
      const libraryId = input.libraryId.trim()
      try {
        const currentRuntime = getRuntime()
        const entry = getEntryById(currentRuntime.db, entryId)
        if (!entry || entry.libraryId !== libraryId || entry.tombstone) {
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

        const library = getLibrary(currentRuntime.db, entry.libraryId)
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

        const result = await getThumbnailService().getThumbnail(
          {
            entryId,
            sizeBytes: info.size,
            mtime,
            generatorVersion: 2,
            sourcePath: entry.path,
          },
          { priority: THUMBNAIL_PRIORITY[input.priority ?? 'visible'] },
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
      }
    },
  )
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const relativePath = relative(resolve(directory), resolve(candidate))
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

const nativeImageThumbnailGenerator: ThumbnailGenerator = async (input) => {
  if (input.signal.aborted) throw new ThumbnailCancelledError()
  const source = nativeImage.createFromPath(input.sourcePath)
  if (source.isEmpty()) throw new Error(`cannot decode image: ${input.sourcePath}`)

  const sourceSize = source.getSize()
  const scale = Math.min(
    input.width / Math.max(1, sourceSize.width),
    input.height / Math.max(1, sourceSize.height),
    1,
  )
  const width = Math.max(1, Math.round(sourceSize.width * scale))
  const height = Math.max(1, Math.round(sourceSize.height * scale))
  const resized = source.resize({ width, height, quality: 'good' })
  const data = resized.toJPEG(82)
  if (data.length === 0) throw new Error(`thumbnail encoder returned no data: ${input.sourcePath}`)
  if (input.signal.aborted) throw new ThumbnailCancelledError()

  return { data: new Uint8Array(data), mime: 'image/jpeg', width, height }
}

function getThumbnailService(): ThumbnailCacheService {
  const currentRuntime = getRuntime()
  if (!thumbnailService) {
    thumbnailService = new ThumbnailCacheService({
      db: currentRuntime.db,
      thumbnailsDir: currentRuntime.paths.thumbnailsDir,
      concurrency: 4,
      generator: nativeImageThumbnailGenerator,
      thumbnailSize: THUMBNAIL_SIZE,
      format: 'jpeg',
    })
  }
  return thumbnailService
}

function thumbnailUrl(cacheKey: string, mime: string): string {
  const extension = mime === 'image/webp' ? 'webp' : 'jpg'
  return `nestify-thumbnail://cache/${cacheKey}.${extension}`
}

function registerThumbnailProtocol(): void {
  protocol.handle('nestify-thumbnail', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 })
    }

    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response(null, { status: 400 })
    }

    const filename = pathname.replace(/^\/+/, '')
    if (!/^[a-f0-9]{64}\.(?:jpg|webp)$/.test(filename)) {
      return new Response(null, { status: 404 })
    }

    const thumbnailsDir = getRuntime().paths.thumbnailsDir
    const cachePath = resolve(thumbnailsDir, filename)
    if (!isInsideDirectory(thumbnailsDir, cachePath)) {
      return new Response(null, { status: 404 })
    }

    try {
      const [info, data] = await Promise.all([stat(cachePath), readFile(cachePath)])
      if (!info.isFile() || data.length === 0) return new Response(null, { status: 404 })
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'content-type': filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
          'content-length': String(data.length),
          'cache-control': 'private, max-age=604800, immutable',
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

app.setName('Nestify')

protocol.registerSchemesAsPrivileged?.([
  { scheme: 'file', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: 'nestify-thumbnail',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

app.whenReady().then(() => {
  registerThumbnailProtocol()
  registerIpc()
  createWindow()
  try {
    getRuntime()
  } catch (error) {
    console.error('[Nestify] runtime initialization failed', error)
    if (mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(rendererFailureUrl(
        'Nestify 数据库初始化失败',
        error instanceof Error ? error.stack ?? error.message : String(error),
      ))
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  runtime?.close()
  runtime = null
})
