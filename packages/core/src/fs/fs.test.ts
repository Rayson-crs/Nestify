import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { rm } from 'node:fs/promises'
import { classifyKind } from './kind.ts'
import { createExcluder } from './exclude.ts'
import { directoryNameOf, normalizeScanPath, parentPathMatchValues, parentScanPath, pathDepthOf, scanPathAliases, splitName, toLongPath } from './path.ts'
import { mergeDirectoryChildNames, walkRoot } from './walk.ts'
import { walkRootConcurrent } from './walk-concurrent.ts'
import { inspectWalkTask } from './walk-task.ts'

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
    assert.equal(classifyKind('app.tsx', false), 'code')
    assert.equal(classifyKind('settings.json', false), 'config')
    assert.equal(classifyKind('budget.xlsx', false), 'spreadsheet')
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

  it('keeps windows drive-root aliases for directory lookups', () => {
    const aliases = scanPathAliases('Z:\\')
    assert.ok(aliases.includes('Z:\\'))
    assert.ok(aliases.includes('Z:'))
    assert.ok(parentPathMatchValues('Z:\\').includes('Z:'))
    assert.ok(parentPathMatchValues('Z:\\').includes('Z:/'))
    assert.ok(parentPathMatchValues('z:').includes('Z:/'))
  })

  it('derives parent directories from nested windows paths', () => {
    assert.equal(parentScanPath('Z:\\Media\\Album\\P\\a.jpg'), 'Z:\\Media\\Album\\P')
    assert.equal(parentScanPath('Z:\\Media'), 'Z:\\')
    assert.equal(parentScanPath('Z:\\'), null)
    assert.equal(directoryNameOf('Z:\\Media'), 'Media')
    assert.equal(pathDepthOf('Z:\\'), 0)
    assert.equal(pathDepthOf('Z:\\Media\\Album'), 2)
  })

  it('skips excluded names case-insensitively on win32', () => {
    const excluder = createExcluder()
    assert.equal(excluder.shouldSkip(join('D:', 'inbox', 'node_modules'), 'node_modules', true), true)
    assert.equal(excluder.shouldSkip(join('D:', 'inbox', 'keep'), 'keep', true), false)
    if (process.platform === 'win32') {
      assert.equal(excluder.shouldSkip('D:\\inbox\\Node_Modules', 'Node_Modules', true), true)
    }
  })

  it('skips office lock files (~$ owner prefix) as transient', () => {
    const excluder = createExcluder()
    assert.equal(excluder.shouldSkip('D:\\doc\\~$商务文件_正式.docx', '~$商务文件_正式.docx', false), true)
    assert.equal(excluder.shouldSkip('D:\\doc\\~$normal.xlsx', '~$normal.xlsx', false), true)
    assert.equal(excluder.shouldSkip('D:\\doc\\report.docx', 'report.docx', false), false)
    assert.equal(excluder.shouldSkip('D:\\doc\\~backup.txt', '~backup.txt', false), false)
  })

  it('keeps the full directory name list when typed dirents are a subset', () => {
    assert.deepEqual(
      mergeDirectoryChildNames(['keep', 'typed-only'], ['keep', 'names-only', '.', '..']),
      ['keep', 'names-only', 'typed-only'],
    )
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

  it('walks with bounded worker concurrency', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'a', 'nested'), { recursive: true })
    mkdirSync(join(root, 'b'), { recursive: true })
    writeFileSync(join(root, 'a', 'one.mp4'), 'x')
    writeFileSync(join(root, 'a', 'nested', 'two.mp4'), 'x')
    writeFileSync(join(root, 'b', 'three.mp4'), 'x')

    for (const pass of [1, 2]) {
      const entries: string[] = []
      for await (const entry of walkRootConcurrent(root, { concurrency: 4 })) {
        entries.push(entry.relPath.replaceAll('\\', '/'))
      }
      assert.ok(entries.length > 0, `pass ${pass} returned no entries`)
      assert.ok(entries.includes(''))
      assert.ok(entries.includes('a/one.mp4'))
      assert.ok(entries.includes('a/nested/two.mp4'))
      assert.ok(entries.includes('b/three.mp4'))
    }
  })

  it('continues scanning when one directory has more queued children than the scheduler limit', async () => {
    const root = tempRoot()
    const childCount = 4105
    for (let index = 0; index < childCount; index += 1) {
      mkdirSync(join(root, `child-${index}`))
    }

    const seen = new Set<string>()
    for await (const entry of walkRootConcurrent(root, { concurrency: 2 })) {
      if (entry.isDir) seen.add(entry.path)
    }

    assert.equal(seen.size, childCount + 1)
  })

  it('emits every immediate child before waiting on nested directory stats', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'folder-a', 'nested'), { recursive: true })
    mkdirSync(join(root, 'folder-b'))
    writeFileSync(join(root, 'readme.txt'), 'x')
    writeFileSync(join(root, 'folder-a', 'nested', 'deep.txt'), 'x')

    const result = await inspectWalkTask({
      root,
      path: root,
      parentPath: null,
      depth: 0,
    })
    const names = result.nodes.map((node) => node.name).sort()
    assert.ok(names.includes('folder-a'))
    assert.ok(names.includes('folder-b'))
    assert.ok(names.includes('readme.txt'))
    assert.equal(result.nodes.find((node) => node.name === 'folder-a')?.isDir, true)
    assert.equal(result.nodes.find((node) => node.name === 'readme.txt')?.isDir, false)
    assert.equal(result.directories.length, 2)

    const partialNames: string[] = []
    await inspectWalkTask({
      root,
      path: root,
      parentPath: null,
      depth: 0,
    }, {
      onPartial: (partial) => {
        partialNames.push(...partial.nodes.map((node) => node.name))
      },
    })
    assert.ok(partialNames.includes('folder-a'))
    assert.ok(partialNames.includes('folder-b'))
    assert.ok(partialNames.includes('readme.txt'))
  })

  it('reports a concrete error when a walk task path is missing', async () => {
    const root = tempRoot()
    const missing = join(root, 'missing')
    const errors: Array<{ path: string; operation: string; code?: string }> = []
    for await (const _entry of walkRootConcurrent(missing, {
      concurrency: 1,
      onTaskError: (error) => errors.push(error),
    })) {
      // no entries expected
    }
    assert.ok(errors.some((error) => error.path === missing && error.operation === 'stat'))
  })
})
