import { ipcMain } from 'electron'
import { getRuntime } from './runtime-host'
import { registerSpotlightShortcuts } from './window'
import { logStartup } from './log'
import { applyFfmpegDirectory, testFfmpegDirectory } from './ffmpeg-settings'
import { normalizeAccelerator, normalizeFfmpegDirectory, readSettings, writeSettings } from './settings'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings.get', () => readSettings())
  ipcMain.handle('settings.testFfmpeg', async (_event, input: { directory?: unknown }) => {
    const directory = input?.directory == null || input.directory === ''
      ? null
      : normalizeFfmpegDirectory(input.directory)
    if (input?.directory != null && input.directory !== '' && !directory) {
      return { ok: false, message: 'FFmpeg 目录无效', ffmpegVersion: null, ffprobeVersion: null }
    }
    return testFfmpegDirectory(directory)
  })
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
      ...('ffmpegDirectory' in input
        ? { ffmpegDirectory: normalizeFfmpegDirectory(input.ffmpegDirectory) }
        : {}),
    }
    await writeSettings(next)
    applyFfmpegDirectory(next.ffmpegDirectory)
    getRuntime().setScanConcurrency(next.scanConcurrency)
    const shortcutRegistered = await registerSpotlightShortcuts()
    if (!shortcutRegistered) throw new Error('快捷键注册失败，可能已被其他应用占用')
    logStartup('settings.updated', next)
    return next
  })
}
