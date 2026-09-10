import { app, BrowserWindow, globalShortcut, Menu, nativeImage, screen, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { logStartup } from './log'
import { rendererFailureUrl, renderErrorPage, resolveAppIcon, resolvePreload, resolveRendererIndex, resolveSpotlightRendererIndex } from './paths'
import { appState } from './state'
import { readSettings } from './settings'

export interface CreateWindowOptions {
  visible?: boolean
}

export function createWindow(options: CreateWindowOptions = {}): void {
  const visible = options.visible !== false
  const preloadPath = resolvePreload()
  const rendererIndex = resolveRendererIndex()
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const iconPath = resolveAppIcon()

  logStartup('window.paths', {
    isPackaged: app.isPackaged,
    preloadPath,
    preloadExists: existsSync(preloadPath),
    rendererIndex,
    rendererIndexExists: existsSync(rendererIndex),
    rendererUrl: rendererUrl ?? null,
    iconPath,
    iconExists: existsSync(iconPath),
  })

  logStartup('window.create.start', { rendererUrl: rendererUrl ?? null })
  appState.mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#ffffff',
    icon: iconPath,
    autoHideMenuBar: true,
    show: visible,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  logStartup('window.create.finished', {
    id: appState.mainWindow.id,
    visible: appState.mainWindow.isVisible(),
    requestedVisible: visible,
    bounds: appState.mainWindow.getBounds(),
  })

  const window = appState.mainWindow
  const showWindow = () => {
    if (!visible) return
    logStartup('window.show', {
      destroyed: window.isDestroyed(),
      visible: window.isVisible(),
    })
    if (!window.isDestroyed()) window.show()
  }

  const showTimer = visible ? setTimeout(showWindow, 2500) : undefined
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
    if (showTimer) clearTimeout(showTimer)
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
    if (showTimer) clearTimeout(showTimer)
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
    if (showTimer) clearTimeout(showTimer)
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
    if (showTimer) clearTimeout(showTimer)
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
  const icon = nativeImage.createFromPath(resolveAppIcon())
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
  showSpotlightWindow()
}

export async function registerSpotlightShortcuts(): Promise<boolean> {
  logStartup('global-shortcut.register.start')
  const settings = await readSettings()
  globalShortcut.unregisterAll()
  appState.spotlightShortcutRegistered = false
  appState.spotlightFallbackShortcutRegistered = false
  appState.spotlightReliableShortcutRegistered = false
  const selected = settings.spotlightShortcut
  let selectedRegistered = false
  const register = (accelerator: string) => {
    try {
      const registered = globalShortcut.register(accelerator, () => sendSpotlightOpen('global-shortcut', accelerator))
      if (!registered) logStartup('global-shortcut.register.failed', { accelerator, message: 'accelerator is already registered' })
      return registered
    } catch (error) {
      logStartup('global-shortcut.register.failed', { accelerator, message: error instanceof Error ? error.message : String(error) })
      return false
    }
  }
  selectedRegistered = register(selected)
  if (selected === 'Control+Escape') appState.spotlightShortcutRegistered = selectedRegistered
  if (selected === 'Control+Space') appState.spotlightFallbackShortcutRegistered = selectedRegistered
  if (selected === 'Control+Shift+Space') appState.spotlightReliableShortcutRegistered = selectedRegistered
  if (!selectedRegistered && selected !== 'Control+Shift+Space') {
    appState.spotlightReliableShortcutRegistered = register('Control+Shift+Space')
  }
  logStartup('global-shortcut.register.finished', {
    selected,
    selectedRegistered,
    controlEscape: appState.spotlightShortcutRegistered,
    controlSpace: appState.spotlightFallbackShortcutRegistered,
    controlShiftSpace: appState.spotlightReliableShortcutRegistered,
    note: selectedRegistered ? 'configured shortcut registered' : 'configured shortcut unavailable; fallback may be active',
  })
  return selectedRegistered
}

export function minimizeToTray(): void {
  if (!appState.mainWindow || appState.mainWindow.isDestroyed()) return
  createTray()
  appState.mainWindow.hide()
}

export function createSpotlightWindow(): void {
  if (appState.spotlightWindow && !appState.spotlightWindow.isDestroyed()) return
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const spotlight = new BrowserWindow({
    width: 720,
    // Spotlight 尺寸固定：创建时即达到最终高度，避免打开后再放大。
    height: 520,
    minWidth: 560,
    minHeight: 520,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  appState.spotlightWindow = spotlight
  spotlight.setBackgroundColor('#00000000')
  spotlight.on('blur', () => {
    if (!spotlight.isDestroyed()) spotlight.hide()
  })
  spotlight.on('closed', () => {
    appState.spotlightWindow = null
  })
  spotlight.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logStartup('spotlight.did-fail-load', { errorCode, errorDescription, validatedURL })
  })
  spotlight.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logStartup('spotlight.console', { level, message, line, sourceId })
  })
  spotlight.webContents.on('did-finish-load', () => {
    logStartup('spotlight.did-finish-load')
    void spotlight.webContents
      .executeJavaScript(`(() => {
        const read = (selector) => {
          const element = document.querySelector(selector)
          if (!element) return null
          const style = getComputedStyle(element)
          return { selector, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage }
        }
        return [read('html'), read('body'), read('#root'), read('main')]
      })()`)
      .then((backgrounds) => logStartup('spotlight.background-check', { backgrounds }))
      .catch((error: unknown) => logStartup('spotlight.background-check.failed', {
        message: error instanceof Error ? error.message : String(error),
      }))
  })
  const url = rendererUrl ? `${rendererUrl.replace(/\/$/, '')}/spotlight.html` : null
  void (url ? spotlight.loadURL(url) : spotlight.loadFile(resolveSpotlightRendererIndex())).catch((error: unknown) => {
    logStartup('spotlight.load.failed', { message: error instanceof Error ? error.message : String(error) })
  })
}

export function showSpotlightWindow(): void {
  if (!appState.spotlightWindow || appState.spotlightWindow.isDestroyed()) createSpotlightWindow()
  const spotlight = appState.spotlightWindow
  if (!spotlight) return
  if (spotlight.webContents.isLoading()) {
    positionSpotlightWindow(spotlight)
    spotlight.webContents.once('did-finish-load', () => {
      if (spotlight.isDestroyed()) return
      spotlight.show()
      spotlight.focus()
    })
    return
  }
  positionSpotlightWindow(spotlight)
  spotlight.show()
  spotlight.focus()
}

function positionSpotlightWindow(spotlight: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = spotlight.getBounds()
  const { x, y, width: workAreaWidth, height: workAreaHeight } = display.workArea
  const left = Math.round(x + (workAreaWidth - width) / 2)
  // 固定高度后窗口较高，需保证不超出工作区底部。
  const maxTop = y + workAreaHeight - height - 16
  const top = Math.round(Math.min(y + workAreaHeight * 0.3, Math.max(y + 16, maxTop)))
  spotlight.setPosition(left, top, false)
  logStartup('spotlight.position', {
    displayId: display.id,
    x: left,
    y: top,
    width,
    height,
    workArea: display.workArea,
  })
}

export function closeSpotlightWindow(): void {
  if (!appState.spotlightWindow || appState.spotlightWindow.isDestroyed()) return
  appState.spotlightWindow.hide()
}

export function resizeSpotlightWindow(height: number): void {
  const spotlight = appState.spotlightWindow
  if (!spotlight || spotlight.isDestroyed()) return
  const bounds = spotlight.getBounds()
  spotlight.setBounds({ ...bounds, height }, false)
}
