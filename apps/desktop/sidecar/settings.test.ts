import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { test } from 'node:test'
import { resolveBundledTool } from './media-tools.ts'
import type { HostState } from './state.ts'
import { handleRpc } from './handlers.ts'
import {
  applyFfmpegDirectory,
  DEFAULT_SETTINGS,
  normalizeSettings,
  resolveSystemLogsDirectory,
} from './settings.ts'

test('a valid custom ffmpeg directory is not replaced by bundled tools', async () => {
  const directory = resolve(tmpdir(), `nestify-custom-ffmpeg-${process.pid}-${Date.now()}`)
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const previousFfmpegPath = process.env.NESTIFY_FFMPEG_PATH
  const previousFfprobePath = process.env.NESTIFY_FFPROBE_PATH
  let workerResets = 0
  const state = {
    mediaTools: { ffmpegPath: null, ffprobePath: null },
    runtime: {
      resetMediaMergeWorker: () => {
        workerResets += 1
      },
    },
  } as never as HostState

  try {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, ffmpegName), 'test-tool')
    await writeFile(join(directory, ffprobeName), 'test-tool')

    applyFfmpegDirectory(directory, state)

    assert.equal(workerResets, 1)
    assert.equal(state.mediaTools.ffmpegPath, join(directory, ffmpegName))
    assert.equal(state.mediaTools.ffprobePath, join(directory, ffprobeName))
  } finally {
    if (previousFfmpegPath === undefined) delete process.env.NESTIFY_FFMPEG_PATH
    else process.env.NESTIFY_FFMPEG_PATH = previousFfmpegPath
    if (previousFfprobePath === undefined) delete process.env.NESTIFY_FFPROBE_PATH
    else process.env.NESTIFY_FFPROBE_PATH = previousFfprobePath
  }
})

test('system log settings are clamped to safe integer ranges', () => {
  const settings = normalizeSettings({
    auditLogMaxFileMb: 0,
    auditLogRetentionDays: Number.MAX_SAFE_INTEGER,
    auditLogCleanupIntervalHours: 'invalid',
  })

  assert.equal(settings.auditLogMaxFileMb, 1)
  assert.equal(settings.auditLogRetentionDays, 3650)
  assert.equal(settings.auditLogCleanupIntervalHours, DEFAULT_SETTINGS.auditLogCleanupIntervalHours)
})

test('system log directory accepts only a non-empty absolute path', () => {
  const absolute = resolve(tmpdir(), 'nestify-custom-logs')
  const settings = normalizeSettings({
    auditLogDirectory: `  ${absolute}  `,
  })

  assert.equal(settings.auditLogDirectory, absolute)
  assert.equal(normalizeSettings({ auditLogDirectory: 'relative/logs' }).auditLogDirectory, null)
  assert.equal(normalizeSettings({ auditLogDirectory: '   ' }).auditLogDirectory, null)
})

test('system log directory resolves to the app data logs directory by default', () => {
  const appDataRoot = resolve(tmpdir(), 'nestify-appdata')
  const customRoot = resolve(tmpdir(), 'nestify-custom-root')

  assert.equal(resolveSystemLogsDirectory(null, appDataRoot), join(appDataRoot, 'logs'))
  assert.equal(resolveSystemLogsDirectory('relative', appDataRoot), join(appDataRoot, 'logs'))
  assert.equal(resolveSystemLogsDirectory(customRoot, appDataRoot), customRoot)
  assert.ok(isAbsolute(resolveSystemLogsDirectory(null, appDataRoot)))
})

test('successful ffmpeg test applies the verified paths to the running sidecar', {
  skip: !resolveBundledTool(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    || !resolveBundledTool(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
}, async () => {
  const previousFfmpegPath = process.env.NESTIFY_FFMPEG_PATH
  const previousFfprobePath = process.env.NESTIFY_FFPROBE_PATH
  let workerResets = 0
  const state = {
    mediaTools: { ffmpegPath: null, ffprobePath: null },
    runtime: {
      resetMediaMergeWorker: () => {
        workerResets += 1
      },
    },
  } as never as HostState

  try {
    const result = await handleRpc(state, 'settings.testFfmpeg', { directory: null }) as {
      ok: boolean
    }

    assert.equal(result.ok, true)
    assert.equal(workerResets, 1)
    assert.ok(process.env.NESTIFY_FFMPEG_PATH)
    assert.ok(process.env.NESTIFY_FFPROBE_PATH)
    assert.equal(state.mediaTools.ffmpegPath, resolveBundledTool(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))
    assert.equal(state.mediaTools.ffprobePath, resolveBundledTool(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'))
  } finally {
    if (previousFfmpegPath === undefined) delete process.env.NESTIFY_FFMPEG_PATH
    else process.env.NESTIFY_FFMPEG_PATH = previousFfmpegPath
    if (previousFfprobePath === undefined) delete process.env.NESTIFY_FFPROBE_PATH
    else process.env.NESTIFY_FFPROBE_PATH = previousFfprobePath
  }
})
