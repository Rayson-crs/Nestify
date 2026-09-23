import { app, ipcMain } from 'electron'
import { appState } from './state'
import { closeSpotlightWindow, minimizeToTray, resizeSpotlightWindow, showSpotlightWindow } from './window'
import { logStartup } from './log'

export function registerWindowIpc(): void {
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

  ipcMain.handle('app.info', () => ({
    name: app.getName() || 'Nestify',
    version: app.getVersion() || __APP_VERSION__,
  }))

  ipcMain.handle('log.event', (_event, input: { event?: string; details?: unknown }) => {
    const event = input.event?.trim() || 'renderer.event'
    logStartup(event, input.details)
    return { ok: true as const }
  })
}
