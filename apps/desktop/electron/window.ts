import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { logStartup } from './log'
import { rendererFailureUrl, renderErrorPage, resolvePreload, resolveRendererIndex } from './paths'
import { appState } from './state'

export function createWindow(): void {
  const preloadPath = resolvePreload()
  const rendererIndex = resolveRendererIndex()
  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  logStartup('window.paths', {
    isPackaged: app.isPackaged,
    preloadPath,
    preloadExists: existsSync(preloadPath),
    rendererIndex,
    rendererIndexExists: existsSync(rendererIndex),
    rendererUrl: rendererUrl ?? null,
  })

  logStartup('window.create.start', { rendererUrl: rendererUrl ?? null })
  appState.mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#ffffff',
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
  logStartup('window.create.finished', {
    id: appState.mainWindow.id,
    visible: appState.mainWindow.isVisible(),
    bounds: appState.mainWindow.getBounds(),
  })

  const window = appState.mainWindow
  const showWindow = () => {
    logStartup('window.show', {
      destroyed: window.isDestroyed(),
      visible: window.isVisible(),
    })
    if (!window.isDestroyed()) window.show()
  }

  const showTimer = setTimeout(showWindow, 2500)
  window.on('close', (event) => {
    if (appState.quitting) return
    event.preventDefault()
    window.webContents.send('window:close-requested')
  })
  window.webContents.on('preload-error', (_event, errorPreloadPath, error) => {
    logStartup('renderer.preload-error', {
      preloadPath: errorPreloadPath,
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
  })
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return
    const key = input.key.toLowerCase()
    const isEscape = key === 'escape' || key === 'esc'
    const isSpace = key === ' ' || key === 'space'
    if (!isEscape && !isSpace) return
    event.preventDefault()
    sendSpotlightOpen('before-input-event', isEscape ? 'Control+Escape' : 'Control+Space')
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('[Nestify renderer]', { level, message, line, sourceId })
    if (level >= 2) logStartup('renderer.console-error', { level, message, line, sourceId })
  })
  window.on('unresponsive', () => logStartup('window.unresponsive'))
  window.on('responsive', () => logStartup('window.responsive'))
  window.webContents.on('did-start-loading', () => logStartup('renderer.did-start-loading'))
  window.webContents.on('did-stop-loading', () => logStartup('renderer.did-stop-loading'))
  window.webContents.on('dom-ready', () => logStartup('renderer.dom-ready'))
  window.once('ready-to-show', showWindow)
  window.webContents.on('did-finish-load', () => {
    logStartup('renderer.did-finish-load')
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
        .then((health) => logStartup('renderer.health', health))
        .catch((error: unknown) => logStartup('renderer.health-check.failed', {
          message: error instanceof Error ? error.message : String(error),
        }))
    }, 1000)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    clearTimeout(showTimer)
    logStartup('renderer.did-fail-load', {
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
    logStartup('renderer.process-gone', details)
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

  logStartup('renderer.load.start', {
    rendererUrl: rendererUrl ?? null,
    rendererIndex,
  })

  void loadPromise.catch((error: unknown) => {
    clearTimeout(showTimer)
    logStartup('renderer.load.failed', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    showWindow()
    return window.loadURL(rendererFailureUrl(
      'Nestify 无法加载界面',
      error instanceof Error ? error.stack ?? error.message : String(error),
    ))
  })
}

export function createTray(): void {
  if (appState.tray || process.platform !== 'win32') return
  const icon = nativeImage.createFromPath(process.execPath)
  appState.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  appState.tray.setToolTip('Nestify')
  appState.tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 Nestify', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          appState.quitting = true
          app.quit()
        },
      },
    ]),
  )
  appState.tray.on('click', () => showMainWindow())
}

export function showMainWindow(): void {
  if (!appState.mainWindow || appState.mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (appState.mainWindow.isMinimized()) appState.mainWindow.restore()
  appState.mainWindow.show()
  appState.mainWindow.focus()
}

export function sendSpotlightOpen(source: string, accelerator: string): void {
  const now = Date.now()
  if (now - appState.lastSpotlightRequestAt < 200) {
    logStartup('spotlight.open ignored duplicate', { source, accelerator })
    return
  }
  appState.lastSpotlightRequestAt = now
  logStartup('spotlight.open', {
    source,
    accelerator,
    windowExists: Boolean(appState.mainWindow && !appState.mainWindow.isDestroyed()),
    visible: Boolean(appState.mainWindow && !appState.mainWindow.isDestroyed() && appState.mainWindow.isVisible()),
    minimized: Boolean(appState.mainWindow && !appState.mainWindow.isDestroyed() && appState.mainWindow.isMinimized()),
  })
  const dispatch = () => {
    if (!appState.mainWindow || appState.mainWindow.isDestroyed()) return
    appState.mainWindow.webContents.send('ui:spotlight-open')
  }
  if (!appState.mainWindow || appState.mainWindow.isDestroyed()) {
    createWindow()
    appState.mainWindow?.webContents.once('did-finish-load', dispatch)
    return
  }
  if (appState.mainWindow.isMinimized() || !appState.mainWindow.isVisible()) showMainWindow()
  dispatch()
}

export function registerSpotlightShortcuts(): void {
  logStartup('global-shortcut.register.start')
  try {
    globalShortcut.register('Control+Escape', () => sendSpotlightOpen('global-shortcut', 'Control+Escape'))
    appState.spotlightShortcutRegistered = globalShortcut.isRegistered('Control+Escape')
  } catch (error) {
    appState.spotlightShortcutRegistered = false
    logStartup('global-shortcut.register.failed', {
      accelerator: 'Control+Escape',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    globalShortcut.register('Control+Space', () => sendSpotlightOpen('global-shortcut', 'Control+Space'))
    appState.spotlightFallbackShortcutRegistered = globalShortcut.isRegistered('Control+Space')
  } catch (error) {
    appState.spotlightFallbackShortcutRegistered = false
    logStartup('global-shortcut.register.failed', {
      accelerator: 'Control+Space',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  logStartup('global-shortcut.register.finished', {
    controlEscape: appState.spotlightShortcutRegistered,
    controlSpace: appState.spotlightFallbackShortcutRegistered,
    note: appState.spotlightShortcutRegistered
      ? 'Control+Escape registered'
      : 'Windows usually reserves Control+Escape for the Start menu; use Control+Space or the header button as fallback',
  })
}

export function minimizeToTray(): void {
  if (!appState.mainWindow || appState.mainWindow.isDestroyed()) return
  createTray()
  appState.mainWindow.hide()
}