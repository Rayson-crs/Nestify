import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ensureAppDirs } from './ensure.ts'
import { resolveAppPaths } from './directories.ts'

test('resolveAppPaths and ensureAppDirs create runtime folders but not the sqlite file', () => {
  const root = mkdtempSync(join(tmpdir(), 'nestify-layout-'))
  const paths = resolveAppPaths(root)
  assert.equal(paths.dbPath, join(root, 'nestify.sqlite'))
  assert.equal(paths.thumbnailsDir, join(root, 'cache', 'thumbnails'))
  assert.equal(paths.quarantineDir, join(root, 'quarantine'))

  ensureAppDirs(paths)
  assert.equal(existsSync(paths.configDir), true)
  assert.equal(existsSync(paths.logsDir), true)
  assert.equal(existsSync(paths.cacheDir), true)
  assert.equal(existsSync(paths.thumbnailsDir), true)
  assert.equal(existsSync(paths.quarantineDir), true)
  assert.equal(existsSync(paths.rulesDir), true)
  assert.equal(existsSync(paths.tmpDir), true)
  assert.equal(existsSync(paths.dbPath), false)
})
