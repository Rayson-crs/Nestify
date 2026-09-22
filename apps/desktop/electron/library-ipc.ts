import { dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { getRuntime } from './runtime-host'
import { startLibraryWriter, stopLibraryWriter } from './writer-worker-host'
import { removeLibraryInWorker } from './library-removal-worker-client'
import { resolveLibraryRemovalWorker } from './paths'
import { appState } from './state'
import { type RuntimeLibraryPatch, toLibraryPayload } from './payloads'
import { logStartup } from './log'
import { cancelLibraryThumbnailRequests } from './thumbnails'

export function registerLibraryIpc(): void {
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
    const sender = _event.sender
    const library = currentRuntime.listLibraries().find((item) => item.id === input.id)
    if (!library) throw new Error(`library not found: ${input.id}`)
    const task = currentRuntime.startLibraryRemoval({
      libraryId: input.id,
      beforeDelete: async (report) => {
        await cancelLibraryThumbnailRequests(input.id)
        report('已停止缩略图请求', 1)
        await stopLibraryWriter(currentRuntime, input.id)
        await appState.queryWorker?.close()
        appState.queryWorker = null
        report('已停止目录监听和搜索查询', 2)
      },
      removeData: async (report) => {
        await removeLibraryInWorker({
          workerPath: resolveLibraryRemovalWorker(),
          dbPath: currentRuntime.paths.dbPath,
          libraryId: input.id,
          preserveJobId: task.jobId,
          thumbnailsDir: currentRuntime.paths.thumbnailsDir,
          onProgress: (progress) => report(progress.stage, progress.current),
        })
      },
      onProgress: (progress) => {
        if (!sender.isDestroyed()) sender.send('library.removal-progress', progress)
      },
    })
    void task.completion.catch((error) => {
      logStartup('library.remove.failed', {
        libraryId: input.id,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return { ok: true as const, jobId: task.jobId }
  })

  ipcMain.handle('dialog.pickDirectory', async () => {
    const parent = appState.mainWindow
    // Windows：托盘启动/后台唤起时父窗口可能不在前台，模态对话框会弹到主窗口后面。
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
