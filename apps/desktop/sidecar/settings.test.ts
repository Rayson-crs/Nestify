import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { test } from 'node:test'
import { DEFAULT_SETTINGS, normalizeSettings, resolveSystemLogsDirectory } from './settings.ts'

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
