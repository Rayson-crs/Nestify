import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SystemLogger } from './system-log.ts'

function todayFileName(sequence = 0): string {
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return sequence === 0 ? `sys_${date}.log` : `sys_${date}_${String(sequence).padStart(3, '0')}.log`
}

test('system log rolls by file size and keeps date-based names', async () => {
  const logsDir = await mkdtemp(join(tmpdir(), 'nestify-audit-roll-'))
  const logger = new SystemLogger(logsDir, { maxBytes: 256 })
  await logger.flush()

  for (let index = 0; index < 3; index += 1) {
    logger.log('audit.test', { index, message: 'a line long enough to exercise the configured size limit' })
  }
  await logger.flush()

  const files = (await readdir(logsDir)).sort()
  assert.deepEqual(files, [todayFileName(), todayFileName(1)])
  const first = await readFile(join(logsDir, files[0]), 'utf8')
  const second = await readFile(join(logsDir, files[1]), 'utf8')
  assert.equal(first.trim().split('\n').length, 2)
  assert.equal(second.trim().split('\n').length, 1)
})

test('system log continues a below-limit file across dates', async () => {
  const logsDir = await mkdtemp(join(tmpdir(), 'nestify-audit-date-'))
  const oldName = 'sys_2000-01-01.log'
  const oldPath = join(logsDir, oldName)
  await writeFile(oldPath, `${JSON.stringify({ event: 'existing' })}\n`, 'utf8')
  await utimes(oldPath, new Date(), new Date())

  const logger = new SystemLogger(logsDir, { maxBytes: 1024 * 1024 })
  await logger.flush()
  logger.log('audit.test', { continued: true })
  await logger.flush()

  assert.deepEqual(await readdir(logsDir), [oldName])
  const contents = await readFile(oldPath, 'utf8')
  assert.match(contents, /"event":"audit.test"/)
})

test('system log cleanup removes expired files but keeps the active file', async () => {
  const logsDir = await mkdtemp(join(tmpdir(), 'nestify-audit-cleanup-'))
  const activeName = 'sys_2020-01-02.log'
  const expiredName = 'sys_2020-01-01_001.log'
  const activePath = join(logsDir, activeName)
  const expiredPath = join(logsDir, expiredName)
  await writeFile(activePath, `${JSON.stringify({ event: 'active' })}\n`, 'utf8')
  await writeFile(expiredPath, `${JSON.stringify({ event: 'expired' })}\n`, 'utf8')
  const now = new Date()
  await utimes(activePath, now, now)
  await utimes(expiredPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))

  const logger = new SystemLogger(logsDir, { retentionMs: 60 * 24 * 60 * 60 * 1000 })
  await logger.flush()

  assert.deepEqual(await readdir(logsDir), [activeName])
})

test('system log configuration can switch the output directory immediately', async () => {
  const firstDir = await mkdtemp(join(tmpdir(), 'nestify-audit-first-'))
  const secondDir = await mkdtemp(join(tmpdir(), 'nestify-audit-second-'))
  const logger = new SystemLogger(firstDir, { maxBytes: 1024 * 1024 })
  await logger.configure({ logsDir: secondDir, maxBytes: 2048 })
  logger.log('audit.test', { directory: 'second' })
  await logger.flush()

  assert.deepEqual(await readdir(firstDir), [])
  assert.deepEqual(await readdir(secondDir), [todayFileName()])
})
