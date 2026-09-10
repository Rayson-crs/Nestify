import { app, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logStartup } from './log'

export function ensureWindowsStartupShortcut(): void {
  if (process.platform !== 'win32') {
    logStartup('startup-shortcut.skipped', { reason: 'not-windows' })
    return
  }
  if (!app.isPackaged) {
    logStartup('startup-shortcut.skipped', { reason: 'development' })
    return
  }

  const startupDirectory = join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
  )
  const shortcutPath = join(startupDirectory, 'Nestify.lnk')
  const portableExecutableFile = process.env.PORTABLE_EXECUTABLE_FILE
  const target = portableExecutableFile && existsSync(portableExecutableFile)
    ? portableExecutableFile
    : process.execPath
  try {
    mkdirSync(startupDirectory, { recursive: true })
    const created = shell.writeShortcutLink(shortcutPath, {
      target,
      args: '',
      cwd: dirname(target),
      description: 'Nestify',
      appUserModelId: 'app.nestify.desktop',
    })
    if (!created) {
      logStartup('startup-shortcut.write.failed', { shortcutPath, target })
      return
    }
    logStartup('startup-shortcut.write.finished', { shortcutPath, target })
  } catch (error) {
    logStartup('startup-shortcut.write.failed', {
      shortcutPath,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
