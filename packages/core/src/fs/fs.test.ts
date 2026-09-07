import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { rm } from 'node:fs/promises'
import { classifyKind } from './kind.ts'
import { createExcluder } from './exclude.ts'
import { normalizeScanPath, splitName, toLongPath } from './path.ts'
import { walkRoot } from './walk.ts'

const tempDirs: string[] = []

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'nestify-fs-'))
  tempDirs.push(root)
  return root
}

describe('fs helpers', () => {
  it('classifies media kinds', () => {
    assert.equal(classifyKind('Avatar.mkv', false), 'video')
    assert.equal(classifyKind('cover.JPG', false), 'image')
    assert.equal(classifyKind('pack.zip', false), 'archive')
    assert.equal(classifyKind('Movies', true), 'dir')
    assert.equal(classifyKind('notes.txt', false), 'document')
    assert.equal(classifyKind('setup.exe', false), 'installer')
    assert.equal(classifyKind('readme', false), 'file')
    assert.equal(classifyKind('', false), 'unknown')
  })

  it('splits names', () => {
    assert.deepEqual(splitName('Avatar.2009.mkv'), { stem: 'Avatar.2009', ext: '.mkv' })
    assert.deepEqual(splitName('.gitignore'), { stem: '.gitignore', ext: '' })
    assert.deepEqual(splitName('README'), { stem: 'README', ext: '' })
    assert.deepEqual(splitName('Photo.JPEG'), { stem: 'Photo', ext: '.jpeg' })
  })

  it('normalizes windows scan paths without long-path prefix', () => {
    if (process.platform === 'win32') {
      assert.equal(normalizeScanPath('D:/Movies/'), 'D:\\Movies')
      assert.equal(normalizeScanPath('D:\\'), 'D:\\')
      assert.equal(normalizeScanPath('\\\\NAS\\share\\'), '\\\\NAS\\share')
      assert.equal(toLongPath('C:\\short').startsWith('\\\\?\\'), false)
      const longLocal = `C:\\${'a'.repeat(250)}`
      assert.equal(toLongPath(longLocal), `\\\\?\\${longLocal}`)
      assert.equal(toLongPath('\\\\NAS\\share\\folder').startsWith('\\\\?\\'), false)
    } else {
      assert.equal(normalizeScanPath('/tmp/movies/'), '/tmp/movies')
      assert.equal(normalizeScanPath('/'), '/')
    }
  })

  it('skips excluded names case-insensitively on win32', () => {
    const excluder = createExcluder()
    assert.equal(excluder.shouldSkip(join('D:', 'inbox', 'node_modules'), 'node_modules', true), true)
    assert.equal(excluder.shouldSkip(join('D:', 'inbox', 'keep'), 'keep', true), false)
    if (process.platform === 'win32') {
      assert.equal(excluder.shouldSkip('D:\\inbox\\Node_Modules', 'Node_Modules', true), true)
    }
  })

  it('walks nested folders and skips node_modules', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'keep'))
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'keep', 'a.mp4'), 'x')
    writeFileSync(join(root, 'node_modules', 'pkg', 'hidden.js'), 'x')

    const entries = []
    for await (const entry of walkRoot(root)) {
      entries.push(entry)
    }

    assert.equal(entries[0]?.path, root)
    assert.equal(entries[0]?.isDir, true)
    assert.equal(entries[0]?.depth, 0)
    assert.equal(entries[0]?.size, 0)
    assert.equal(entries[0]?.protocol, 'local')

    const rels = entries.map((entry) => entry.relPath.replaceAll('\\', '/'))
    assert.ok(rels.includes('keep/a.mp4'))
    assert.equal(rels.some((rel) => rel.includes('node_modules')), false)
    assert.equal(rels.some((rel) => rel.includes('hidden.js')), false)

    const video = entries.find((entry) => entry.name === 'a.mp4')
    assert.equal(video?.kind, 'video')
    assert.equal(video?.ext, '.mp4')
    assert.equal(video?.stem, 'a')
    assert.equal(video?.isDir, false)
  })

  it('stops when aborted', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'a'))
    writeFileSync(join(root, 'a', 'b.txt'), 'x')
    const controller = new AbortController()
    controller.abort()
    const names: string[] = []
    for await (const entry of walkRoot(root, { signal: controller.signal })) {
      names.push(entry.path)
    }
    assert.equal(names.length, 0)
  })
})
