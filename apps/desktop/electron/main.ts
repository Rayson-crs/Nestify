import { app, globalShortcut, protocol } from 'electron'
import { configureSharpRuntime } from './sharp-runtime'
import { logStartup } from './log'
import { registerIpc } from './ipc'
import { configureBundledMediaTools } from './media-tools'
import { applyFfmpegDirectory } from './ffmpeg-settings'
import { rendererFailureUrl } from './paths'
import { readSettings } from './settings'
import { getRuntime } from './runtime-host'
import { prewarmQueryWorkers } from './query-worker-host'
import { appState } from './state'
import { startAllLibraryWriters } from './writer-worker-host'
import { registerMediaProtocol } from './media-protocol'
import { registerThumbnailProtocol } from './thumbnails'
import { createTray, createWindow, registerSpotlightShortcuts, showMainWindow } from './window'
import { ensureWindowsStartupShortcut } from './startup-shortcut'

if (!app.requestSingleInstanceLock()) {
  logStartup('single-instance.lock-denied')
  app.quit()
} else {
  logStartup('single-instance.lock-acquired')
  configureSharpRuntime()
  initialize()
}

function initialize(): void {
  logStartup('main.initializing', {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    cwd: process.cwd(),
  })
  app.on('second-instance', () => showMainWindow())
  app.setName('Nestify')
  app.setAppUserModelId('app.nestify.desktop')
  const bundledMediaTools = configureBundledMediaTools()
  logStartup('media-tools.configured', bundledMediaTools)

  protocol.registerSchemesAsPrivileged?.([
    { scheme: 'file', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    {
      scheme: 'nestify-thumbnail',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: 'nestify-media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ])

  app.whenReady().then(async () => {
    logStartup('app.ready')
    registerThumbnailProtocol()
    logStartup('thumbnail-protocol.registered')
    registerMediaProtocol()
    logStartup('media-protocol.registered')
    registerIpc()
    logStartup('ipc.registered')
    ensureWindowsStartupShortcut()
    const startInTray = process.platform === 'win32'
    createWindow({ visible: !startInTray })
    if (startInTray) createTray()
    logStartup('startup-window-mode.finished', { startInTray })
    logStartup('create-window.returned')
    try {
      void registerSpotlightShortcuts()
    } catch (error) {
      logStartup('global-shortcut.register.failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    try {
      logStartup('runtime.initialize.start')
      let settings: Awaited<ReturnType<typeof readSettings>> | null = null
      try {
        settings = await readSettings()
        applyFfmpegDirectory(settings.ffmpegDirectory)
        logStartup('media-tools.settings-applied', { custom: Boolean(settings.ffmpegDirectory) })
      } catch (error) {
        logStartup('media-tools.settings-failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
      const runtime = getRuntime(logStartup)
      void prewarmQueryWorkers(runtime).finally(() => {
        startAllLibraryWriters(runtime)
        logStartup('runtime.initialize.finished')
      })
      if (settings) {
        runtime.setScanConcurrency(settings.scanConcurrency)
        logStartup('runtime.scan-concurrency.applied', { concurrency: settings.scanConcurrency })
      }
    } catch (error) {
      logStartup('runtime.initialize.failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
        void appState.mainWindow.loadURL(rendererFailureUrl(
          'Nestify 数据库初始化失败',
          error instanceof Error ? error.stack ?? error.message : String(error),
        ))
      }
    }
    app.on('activate', () => {
      if (appState.mainWindow == null || appState.mainWindow.isDestroyed()) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Keep the runtime available through the tray after the window is hidden.
  })

  app.on('before-quit', (event) => {
    if (appState.quitCleanupStarted) return
    event.preventDefault()
    appState.quitCleanupStarted = true
    logStartup('app.before-quit')
    globalShortcut.unregisterAll()
    appState.tray?.destroy()
    appState.tray = null
    if (appState.spotlightWindow && !appState.spotlightWindow.isDestroyed()) appState.spotlightWindow.destroy()
    appState.spotlightWindow = null
    void (async () => {
      await appState.queryWorker?.close()
      appState.queryWorker = null
      await appState.previewWorker?.close()
      appState.previewWorker = null
      await appState.writerWorker?.close()
      appState.writerWorker = null
      await appState.runtime?.shutdown()
      appState.runtime = null
      app.quit()
    })()
  })

  process.on('uncaughtException', (error) => {
    logStartup('process.uncaught-exception', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
  })
  process.on('unhandledRejection', (reason) => {
    logStartup('process.unhandled-rejection', {
      reason: reason instanceof Error
        ? { name: reason.name, message: reason.message, stack: reason.stack }
        : String(reason),
    })
  })
  app.on('child-process-gone', (_event, details) => {
    logStartup('app.child-process-gone', details)
  })
}
