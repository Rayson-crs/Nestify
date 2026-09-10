import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULT_SETTINGS = {
  scanConcurrency: 4,
  thumbnailConcurrency: 4,
  searchDebounceMs: 300,
  spotlightShortcut: 'Control+Space',
  minimizeToTrayOnClose: true,
}

export type DesktopSettings = typeof DEFAULT_SETTINGS

export function settingsPath(): string {
  return join(app.getPath('userData'), 'config', 'settings.json')
}

export async function readSettings(): Promise<DesktopSettings> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8')) as Record<string, unknown>
    const merged = { ...DEFAULT_SETTINGS, ...parsed } as DesktopSettings
    const storedShortcut = merged.spotlightShortcut === 'Control+Shift+Space'
      ? DEFAULT_SETTINGS.spotlightShortcut
      : merged.spotlightShortcut
    return { ...merged, spotlightShortcut: normalizeAccelerator(storedShortcut) ?? DEFAULT_SETTINGS.spotlightShortcut }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function writeSettings(next: DesktopSettings): Promise<void> {
  await mkdir(join(app.getPath('userData'), 'config'), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
}

const NAMED_KEYS = new Set([
  'Space', 'Tab', 'CapsLock', 'Numlock', 'ScrollLock', 'Pause', 'PrintScreen',
  'Plus', 'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Backquote',
  'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Escape',
])

export function normalizeAccelerator(input: string): string | null {
  const parts = input.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return null

  const modifiers = new Set<string>()
  let key: string | null = null
  for (const part of parts) {
    const normalized = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    if (['Control', 'Ctrl'].includes(part)) {
      modifiers.add('Control')
      continue
    }
    if (['Alt', 'Option'].includes(normalized)) {
      modifiers.add('Alt')
      continue
    }
    if (normalized === 'Shift') {
      modifiers.add('Shift')
      continue
    }
    if (['Meta', 'Win', 'Windows', 'Super', 'Command'].includes(normalized)) {
      modifiers.add('Meta')
      continue
    }
    if (key != null) return null
    const upper = part.toUpperCase()
    if (/^[A-Z0-9]$/.test(upper)) key = upper
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(upper)) key = upper
    else if (NAMED_KEYS.has(normalized)) key = normalized
    else return null
  }
  if (!key) return null
  if (!modifiers.has('Control') && !modifiers.has('Alt') && !modifiers.has('Meta')) return null

  return [
    modifiers.has('Control') ? 'Control' : null,
    modifiers.has('Alt') ? 'Alt' : null,
    modifiers.has('Shift') ? 'Shift' : null,
    modifiers.has('Meta') ? 'Meta' : null,
    key,
  ].filter(Boolean).join('+')
}
