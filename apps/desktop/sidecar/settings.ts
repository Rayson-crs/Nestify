import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { configureBundledMediaTools, resolveBundledTool } from './media-tools.ts'
import type { HostState } from './state.ts'

export const DEFAULT_SETTINGS = {
  scanConcurrency: 4,
  thumbnailConcurrency: 4,
  searchDebounceMs: 300,
  spotlightShortcut: 'Control+Space',
  minimizeToTrayOnClose: true,
  ffmpegDirectory: null as string | null,
  auditLogDirectory: null as string | null,
  auditLogMaxFileMb: 30,
  auditLogRetentionDays: 60,
  auditLogCleanupIntervalHours: 24,
}

export type DesktopSettings = typeof DEFAULT_SETTINGS

export async function readSettings(appDataRoot: string): Promise<DesktopSettings> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(appDataRoot), 'utf8')) as Partial<DesktopSettings>
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...parsed })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function writeSettings(appDataRoot: string, next: DesktopSettings): Promise<void> {
  await mkdir(join(appDataRoot, 'config'), { recursive: true })
  await writeFile(settingsPath(appDataRoot), JSON.stringify(next, null, 2), 'utf8')
}

export function applyFfmpegDirectory(directory: string | null, state: HostState): void {
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  if (directory) {
    const ffmpegPath = resolveTool(directory, ffmpegName)
    const ffprobePath = resolveTool(directory, ffprobeName)
    if (ffmpegPath && ffprobePath) {
      process.env.NESTIFY_FFMPEG_PATH = ffmpegPath
      process.env.NESTIFY_FFPROBE_PATH = ffprobePath
      state.runtime?.resetMediaMergeWorker()
      return
    }
  }
  configureBundledMediaTools()
  state.runtime?.resetMediaMergeWorker()
}

export async function applySystemLogSettings(settings: DesktopSettings, state: HostState): Promise<void> {
  const configuration = systemLogConfiguration(settings, state.appDataRoot)
  await state.systemLog.configure(configuration)
  state.systemLog.log('systemLog.settings.applied', {
    directory: configuration.logsDir,
    maxFileMb: settings.auditLogMaxFileMb,
    retentionDays: settings.auditLogRetentionDays,
    cleanupIntervalHours: settings.auditLogCleanupIntervalHours,
  })
}

export function systemLogConfiguration(
  settings: DesktopSettings,
  appDataRoot: string,
): {
  logsDir: string
  maxBytes: number
  retentionMs: number
  cleanupIntervalMs: number
} {
  return {
    logsDir: resolveSystemLogsDirectory(settings.auditLogDirectory, appDataRoot),
    maxBytes: settings.auditLogMaxFileMb * 1024 * 1024,
    retentionMs: settings.auditLogRetentionDays * 24 * 60 * 60 * 1000,
    cleanupIntervalMs: settings.auditLogCleanupIntervalHours * 60 * 60 * 1000,
  }
}

export function resolveSystemLogsDirectory(directory: string | null | undefined, appDataRoot: string): string {
  if (typeof directory === 'string' && directory.trim() && isAbsolute(directory)) return directory.trim()
  return join(appDataRoot, 'logs')
}

export async function testFfmpegDirectory(directory: string | null): Promise<{
  ok: boolean
  message: string
  ffmpegVersion: string | null
  ffprobeVersion: string | null
}> {
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const ffmpegPath = directory ? resolveTool(directory, ffmpegName) : resolveBundledTool(ffmpegName)
  const ffprobePath = directory ? resolveTool(directory, ffprobeName) : resolveBundledTool(ffprobeName)
  if (!ffmpegPath || !ffprobePath) {
    return {
      ok: false,
      message: directory ? '所选目录里没有同时找到 ffmpeg 和 ffprobe' : '内置 FFmpeg 不可用',
      ffmpegVersion: null,
      ffprobeVersion: null,
    }
  }
  try {
    const [ffmpegVersion, ffprobeVersion] = await Promise.all([readVersion(ffmpegPath), readVersion(ffprobePath)])
    return { ok: true, message: `连接成功：FFmpeg ${ffmpegVersion}，FFprobe ${ffprobeVersion}`, ffmpegVersion, ffprobeVersion }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'FFmpeg 测试失败', ffmpegVersion: null, ffprobeVersion: null }
  }
}

function settingsPath(appDataRoot: string): string {
  return join(appDataRoot, 'config', 'settings.json')
}

function normalizeDirectory(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const directory = value.trim()
  return directory && directory.length <= 1024 ? directory : null
}

function normalizeLogDirectory(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const directory = value.trim()
  return directory && directory.length <= 1024 && isAbsolute(directory) ? directory : null
}

export function normalizeSettings(value: Partial<DesktopSettings>): DesktopSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    ffmpegDirectory: normalizeDirectory(value.ffmpegDirectory),
    auditLogDirectory: normalizeLogDirectory(value.auditLogDirectory),
    auditLogMaxFileMb: normalizeBoundedInteger(value.auditLogMaxFileMb, 30, 1, 2048),
    auditLogRetentionDays: normalizeBoundedInteger(value.auditLogRetentionDays, 60, 1, 3650),
    auditLogCleanupIntervalHours: normalizeBoundedInteger(
      value.auditLogCleanupIntervalHours,
      24,
      1,
      2160,
    ),
  }
}

function normalizeBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
}

function resolveTool(directory: string, name: string): string | null {
  const direct = join(directory, name)
  const nested = join(directory, 'bin', name)
  if (isUsable(direct)) return direct
  if (isUsable(nested)) return nested
  return null
}

function isUsable(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
  } catch {
    return false
  }
}

function readVersion(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(path, ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${path} exited ${code}`))
      else resolvePromise(output.split('\n')[0]?.trim() || 'unknown')
    })
  })
}
