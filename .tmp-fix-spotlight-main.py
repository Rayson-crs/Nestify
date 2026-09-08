from pathlib import Path

p = Path('apps/desktop/electron/main.ts')
text = p.read_text(encoding='utf-8')

old_vars = '''let spotlightShortcutRegistered = false
let spotlightFallbackShortcutRegistered = false
'''
new_vars = '''let spotlightShortcutRegistered = false
let spotlightFallbackShortcutRegistered = false
let lastSpotlightRequestAt = 0
'''
if old_vars not in text:
    raise SystemExit('spotlight vars missing')
text = text.replace(old_vars, new_vars, 1)

old_input = '''  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return
    const isEscape = input.key.toLowerCase() === 'escape'
    const isSpace = input.key.toLowerCase() === ' ' || input.key.toLowerCase() === 'space'
    if (!isEscape && !isSpace) return
    if (isEscape && spotlightShortcutRegistered) return
    if (isSpace && spotlightFallbackShortcutRegistered) return
    event.preventDefault()
    sendSpotlightToggle('before-input-event', isEscape ? 'Control+Escape' : 'Control+Space')
  })
'''
new_input = '''  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return
    const key = input.key.toLowerCase()
    const isEscape = key === 'escape' || key === 'esc'
    const isSpace = key === ' ' || key === 'space'
    if (!isEscape && !isSpace) return
    event.preventDefault()
    sendSpotlightOpen('before-input-event', isEscape ? 'Control+Escape' : 'Control+Space')
  })
'''
if old_input not in text:
    raise SystemExit('before-input-event missing')
text = text.replace(old_input, new_input, 1)

old_send = '''function sendSpotlightToggle(source: string, accelerator: string): void {
  logStartup('spotlight.toggle', {
    source,
    accelerator,
    windowExists: Boolean(mainWindow && !mainWindow.isDestroyed()),
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    minimized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()),
  })
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    mainWindow?.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('ui:spotlight-toggle')
    })
    return
  }
  if (mainWindow.isMinimized() || !mainWindow.isVisible()) showMainWindow()
  mainWindow.webContents.send('ui:spotlight-toggle')
}

function registerSpotlightShortcuts(): void {
  logStartup('global-shortcut.register.start')
  try {
    globalShortcut.register('Control+Escape', () => sendSpotlightToggle('global-shortcut', 'Control+Escape'))
    spotlightShortcutRegistered = globalShortcut.isRegistered('Control+Escape')
  } catch (error) {
    spotlightShortcutRegistered = false
    logStartup('global-shortcut.register.failed', {
      accelerator: 'Control+Escape',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    globalShortcut.register('Control+Space', () => sendSpotlightToggle('global-shortcut', 'Control+Space'))
    spotlightFallbackShortcutRegistered = globalShortcut.isRegistered('Control+Space')
  } catch (error) {
    spotlightFallbackShortcutRegistered = false
    logStartup('global-shortcut.register.failed', {
      accelerator: 'Control+Space',
      message: error instanceof Error ? error.message : String(error),
    })
  }
'''
new_send = '''function sendSpotlightOpen(source: string, accelerator: string): void {
  const now = Date.now()
  if (now - lastSpotlightRequestAt < 200) {
    logStartup('spotlight.open ignored duplicate', { source, accelerator })
    return
  }
  lastSpotlightRequestAt = now
  logStartup('spotlight.open', {
    source,
    accelerator,
    windowExists: Boolean(mainWindow && !mainWindow.isDestroyed()),
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    minimized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()),
  })
  const dispatch = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('ui:spotlight-open')
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    mainWindow?.webContents.once('did-finish-load', dispatch)
    return
  }
  if (mainWindow.isMinimized() || !mainWindow.isVisible()) showMainWindow()
  dispatch()
}

function registerSpotlightShortcuts(): void {
  logStartup('global-shortcut.register.start')
  try {
    globalShortcut.register('Control+Escape', () => sendSpotlightOpen('global-shortcut', 'Control+Escape'))
    spotlightShortcutRegistered = globalShortcut.isRegistered('Control+Escape')
  } catch (error) {
    spotlightShortcutRegistered = false
    logStartup('global-shortcut.register.failed', {
      accelerator: 'Control+Escape',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    globalShortcut.register('Control+Space', () => sendSpotlightOpen('global-shortcut', 'Control+Space'))
    spotlightFallbackShortcutRegistered = globalShortcut.isRegistered('Control+Space')
  } catch (error) {
    spotlightFallbackShortcutRegistered = false
    logStartup('global-shortcut.register.failed', {
      accelerator: 'Control+Space',
      message: error instanceof Error ? error.message : String(error),
    })
  }
'''
if old_send not in text:
    raise SystemExit('sendSpotlightToggle missing')
text = text.replace(old_send, new_send, 1)
p.write_text(text, encoding='utf-8')
print('main.ts spotlight updated')
