import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NestifyRuntime } from '@nestify/core'

const __dirname = dirname(fileURLToPath(import.meta.url))

let runtime: NestifyRuntime | null = null
let mainWindow: BrowserWindow | null = null

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif'])
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'])
const MAX_IMAGE_PREVIEW = 8 * 1024 * 1024

function resolvePreload(): string {
  return join(__dirname, 'preload.js')
}

function resolveRendererIndex(): string {
  return join(__dirname, '../dist/index.html')
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
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#161513',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(resolveRendererIndex())
  }
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
      filesScanned: progress.filesScanned,
      dirsScanned: progress.dirsScanned,
      bytesScanned: progress.bytesScanned,
      currentPath: progress.currentPath,
      errors: progress.errors,
      filesPerSecond: progress.filesPerSecond,
    }
  })

  ipcMain.handle(
    'search.query',
    async (_event, input: { libraryId: string; text: string; limit?: number }) => {
      const result = getRuntime().search(input.libraryId, input.text, input.limit)
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
    const ruleSets = getRuntime().listRuleSets().map((set) => ({
      id: set.id,
      name: set.name,
      description: set.description,
      dryRunDefault: set.dryRunDefault,
      collision: set.collision,
      rules: set.rules.map((rule) => ({
        id: rule.id,
        enabled: rule.enabled,
        priority: rule.priority,
        action: rule.action,
        template: rule.template,
      })),
    }))
    return { ruleSets }
  })

  ipcMain.handle(
    'rules.preview',
    async (
      _event,
      input: { libraryId: string; ruleSetId: string; collision?: 'suffix' | 'skip' | 'overwrite' },
    ) => {
      return { plan: getRuntime().previewRules(input) }
    },
  )

  ipcMain.handle(
    'rename.preview',
    async (
      _event,
      input: { libraryId: string; template: string; collision?: 'suffix' | 'skip' | 'overwrite' },
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
      input: { libraryId: string; keepStrategy?: 'newest' | 'oldest' | 'shortest_path' },
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
}

app.setName('Nestify')

protocol.registerSchemesAsPrivileged?.([
  { scheme: 'file', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

app.whenReady().then(() => {
  getRuntime()
  registerIpc()
  createWindow()
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
