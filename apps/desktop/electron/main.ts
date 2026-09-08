import { app, globalShortcut, protocol } from 'electron'
import { logStartup } from './log'
import { registerIpc } from './ipc'
import { rendererFailureUrl } from './paths'
import { getRuntime } from './runtime-host'
import { appState } from './state'
import { registerThumbnailProtocol } from './thumbnails'
import { createWindow, registerSpotlightShortcuts, showMainWindow } from './window'

if (!app.requestSingleInstanceLock()) {
  logStartup('single-instance.lock-denied')
  app.quit()
} else {
  logStartup('single-instance.lock-acquired')
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

  protocol.registerSchemesAsPrivileged?.([
    { scheme: 'file', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    {
      scheme: 'nestify-thumbnail',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])

  app.whenReady().then(() => {
    logStartup('app.ready')
    registerThumbnailProtocol()
    logStartup('thumbnail-protocol.registered')
    registerIpc()
    logStartup('ipc.registered')
    createWindow()
    logStartup('create-window.returned')
    try {
      registerSpotlightShortcuts()
    } catch (error) {
      logStartup('global-shortcut.register.failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    try {
      logStartup('runtime.initialize.start')
      getRuntime(logStartup)
      logStartup('runtime.initialize.finished')
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

  app.on('before-quit', () => {
    logStartup('app.before-quit')
    globalShortcut.unregisterAll()
    appState.tray?.destroy()
    appState.tray = null
    appState.runtime?.close()
    appState.runtime = null
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