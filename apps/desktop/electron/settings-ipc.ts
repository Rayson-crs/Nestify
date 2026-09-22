import { ipcMain } from 'electron'
import { getRuntime } from './runtime-host'
import { registerSpotlightShortcuts } from './window'
import { logStartup } from './log'
import { normalizeAccelerator, readSettings, writeSettings } from './settings'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings.get', () => readSettings())
  ipcMain.handle('settings.update', async (_event, input: Record<string, unknown>) => {
    const current = await readSettings()
    const next = {
      ...current,
      ...(Number.isFinite(input.scanConcurrency)
        ? { scanConcurrency: Math.max(1, Math.min(32, Number(input.scanConcurrency))) }
        : {}),
      ...(Number.isFinite(input.thumbnailConcurrency)
        ? { thumbnailConcurrency: Math.max(1, Math.min(32, Number(input.thumbnailConcurrency))) }
        : {}),
      ...(Number.isFinite(input.searchDebounceMs)
        ? { searchDebounceMs: Math.max(0, Math.min(2000, Number(input.searchDebounceMs))) }
        : {}),
      ...(typeof input.spotlightShortcut === 'string' && normalizeAccelerator(input.spotlightShortcut)
        ? { spotlightShortcut: normalizeAccelerator(input.spotlightShortcut)! }
        : {}),
      ...(typeof input.minimizeToTrayOnClose === 'boolean'
        ? { minimizeToTrayOnClose: input.minimizeToTrayOnClose }
        : {}),
    }
    await writeSettings(next)
    getRuntime().setScanConcurrency(next.scanConcurrency)
    const shortcutRegistered = await registerSpotlightShortcuts()
    if (!shortcutRegistered) throw new Error('快捷键注册失败，可能已被其他应用占用')
    logStartup('settings.updated', next)
    return next
  })
}
