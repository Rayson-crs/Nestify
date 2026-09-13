import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { asEntryId, asLibraryId, type Entry } from '@nestify/shared'
import { openDatabase } from '../db/open.ts'
import {
  countEntries,
  createLibrary,
  deleteLibrary,
  getEntryByPath,
  upsertEntriesBatch,
} from '../db/repos/index.ts'
import { listDirectoryChildren, searchEntries } from '../search/index.ts'
import { runScan } from './indexer.ts'

test('runScan indexes nested files, skips node_modules, and leaves hashes empty', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nestify-scan-'))
  mkdirSync(join(root, 'keep'))
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'keep', 'Avatar.mkv'), 'video')
  writeFileSync(join(root, 'node_modules', 'pkg', 'hidden.js'), 'skip')

  const db = openDatabase(':memory:')
  const library = createLibrary(db, {
    id: 'lib1',
    name: 'Inbox',
    roots: [root],
  })

  const result = await runScan(
    db,
    { roots: [root], incremental: true, hashStrategy: 'duplicate-candidate-only' },
    { libraryId: library.id },
  )

  assert.equal(result.errors, 0)
  assert.ok(result.filesScanned >= 1)
  assert.ok(result.dirsScanned >= 1)

  const counts = countEntries(db, library.id)
  assert.equal(counts.files, 1)
  assert.ok(counts.dirs >= 2)

  const video = getEntryByPath(db, library.id, join(root, 'keep', 'Avatar.mkv'))
  assert.ok(video)
  assert.equal(video?.ext, '.mkv')
  assert.equal(video?.kind, 'video')
  assert.equal(video?.hashQuick, null)
  assert.equal(video?.hashFull, null)
  assert.equal(video?.tombstone, false)

  const skipped = getEntryByPath(db, library.id, join(root, 'node_modules', 'pkg', 'hidden.js'))
  assert.equal(skipped, undefined)

  const hits = searchEntries(db, { libraryId: library.id, text: 'Avatar ext:mkv' })
  assert.equal(hits.total, 1)
  assert.equal(hits.hits[0]?.name, 'Avatar.mkv')

  const short = searchEntries(db, { libraryId: asLibraryId(library.id), text: 'Av' })
  assert.ok(short.hits.some((hit) => hit.name === 'Avatar.mkv'))
  db.close()
})

test('runScan writes batches larger than SQLite variable limits without dropping entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nestify-scan-large-batch-'))
  for (let index = 0; index < 520; index += 1) {
    writeFileSync(join(root, `file-${index}.txt`), String(index))
  }

  const db = openDatabase(':memory:')
  const library = createLibrary(db, {
    id: 'large-batch-lib',
    name: 'Large batch',
    roots: [root],
  })

  const result = await runScan(
    db,
    { roots: [root], incremental: true, hashStrategy: 'duplicate-candidate-only' },
    { libraryId: library.id, concurrency: 1 },
  )

  assert.equal(result.errors, 0)
  assert.equal(countEntries(db, library.id).files, 520)

  const secondResult = await runScan(
    db,
    { roots: [root], incremental: true, hashStrategy: 'duplicate-candidate-only' },
    { libraryId: library.id, concurrency: 1 },
  )

  assert.equal(secondResult.errors, 0)
  assert.equal(countEntries(db, library.id).files, 520)
  db.close()
})

test('overlapping libraries share canonical entries and keep independent memberships', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nestify-overlap-'))
  const outer = join(root, 'a', 'b')
  const inner = join(root, 'a')
  mkdirSync(outer, { recursive: true })
  writeFileSync(join(outer, 'shared.txt'), 'shared')
  writeFileSync(join(root, 'outer-only.txt'), 'outer')

  const db = openDatabase(':memory:')
  const outerLibrary = createLibrary(db, {
    id: 'overlap-outer',
    name: 'Outer',
    roots: [outer],
  })
  const innerLibrary = createLibrary(db, {
    id: 'overlap-inner',
    name: 'Inner',
    roots: [inner],
  })

  const scan = async (id: string, roots: string[]) =>
    runScan(
      db,
      { roots, incremental: true, hashStrategy: 'duplicate-candidate-only' },
      { libraryId: id },
    )

  await scan(outerLibrary.id, outerLibrary.roots)
  await scan(innerLibrary.id, innerLibrary.roots)

  const canonicalCount = db
    .prepare('SELECT count(*) AS n FROM entries WHERE path = ?')
    .get(join(outer, 'shared.txt')) as { n: number }
  assert.equal(canonicalCount.n, 1)

  const memberships = db
    .prepare(
      `SELECT library_id AS libraryId, tombstone
       FROM library_entries
       WHERE entry_id = (SELECT id FROM entries WHERE path = ?)
       ORDER BY library_id`,
    )
    .all(join(outer, 'shared.txt')) as Array<{ libraryId: string; tombstone: number }>
  assert.deepEqual(
    memberships.map((membership) => ({ ...membership })),
    [
      { libraryId: innerLibrary.id, tombstone: 0 },
      { libraryId: outerLibrary.id, tombstone: 0 },
    ],
  )

  for (const libraryId of [outerLibrary.id, innerLibrary.id, '__all__']) {
    const result = searchEntries(db, { libraryId, text: 'shared.txt' })
    assert.equal(result.total, 1, `library ${libraryId}`)
    assert.equal(result.hits.filter((hit) => hit.name === 'shared.txt').length, 1)
  }

  await scan(outerLibrary.id, outerLibrary.roots)
  const innerAfterRescan = db
    .prepare(
      `SELECT tombstone FROM library_entries
       WHERE library_id = ? AND entry_id = (SELECT id FROM entries WHERE path = ?)`,
    )
    .get(innerLibrary.id, join(outer, 'shared.txt')) as { tombstone: number }
  assert.equal(innerAfterRescan.tombstone, 0)

  deleteLibrary(db, outerLibrary.id)
  const afterDelete = searchEntries(db, {
    libraryId: innerLibrary.id,
    text: 'shared.txt',
  })
  assert.equal(afterDelete.total, 1)
  db.close()
})

test('runScan keeps the previous index when one root cannot be read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nestify-scan-readable-'))
  const missingRoot = join(tmpdir(), `nestify-scan-missing-${Date.now()}`)
  const filePath = join(root, 'keep.txt')
  mkdirSync(root, { recursive: true })
  writeFileSync(filePath, 'keep')

  const db = openDatabase(':memory:')
  const library = createLibrary(db, {
    id: 'partial-scan',
    name: 'Partial scan',
    roots: [root, missingRoot],
  })

  await runScan(
    db,
    { roots: library.roots, incremental: true, hashStrategy: 'duplicate-candidate-only' },
    { libraryId: library.id, concurrency: 1 },
  )
  rmSync(filePath)

  const result = await runScan(
    db,
    { roots: library.roots, incremental: true, hashStrategy: 'duplicate-candidate-only' },
    { libraryId: library.id, concurrency: 1 },
  )

  assert.ok(result.errors > 0)
  assert.ok(result.errorDetails?.some((error) => error.path === missingRoot))
  assert.ok(result.errorDetails?.some((error) => error.operation === 'stat'))
  assert.ok(result.errorSummary?.['stat:ENOENT'] ?? result.errorSummary?.['stat:UNKNOWN'])
  const existing = getEntryByPath(db, library.id, filePath)
  assert.ok(existing)
  assert.equal(existing?.tombstone, false)
  db.close()
})

test('batch upsert resolves a child parent from the canonical path when child arrives first', () => {
  const root = mkdtempSync(join(tmpdir(), 'nestify-batch-parent-'))
  const parentPath = join(root, 'parent')
  const childPath = join(parentPath, 'child.txt')
  const db = openDatabase(':memory:')
  const library = createLibrary(db, { id: 'batch-parent', name: 'Batch', roots: [root] })

  const makeEntry = (
    id: string,
    path: string,
    parentPathValue: string | null,
    isDir: boolean,
    depth: number,
  ): Entry => ({
    id: asEntryId(id),
    libraryId: asLibraryId(library.id),
    // Deliberately use an incorrect walker parent id. The repository must
    // resolve it from parentPath when both rows are in the same batch.
    parentId: parentPathValue == null ? null : asEntryId('stale-parent-id'),
    name: path.split(/[\\/]/).pop() ?? path,
    stem: isDir ? path.split(/[\\/]/).pop() ?? path : 'child',
    ext: isDir ? '' : '.txt',
    isDir,
    size: isDir ? 0 : 1,
    mtime: 1,
    ctime: 1,
    atime: 1,
    ino: null,
    dev: null,
    depth,
    kind: isDir ? 'dir' : 'document',
    protocol: 'local',
    mime: null,
    path,
    parentPath: parentPathValue,
    relPath: parentPathValue == null ? '' : 'parent/child.txt',
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: 1,
    indexedAt: 1,
  })

  upsertEntriesBatch(db, [
    makeEntry('walker-child', childPath, parentPath, false, 1),
    makeEntry('walker-parent', parentPath, null, true, 0),
  ])

  const child = getEntryByPath(db, library.id, childPath)
  const parent = getEntryByPath(db, library.id, parentPath)
  assert.ok(child)
  assert.ok(parent)
  assert.equal(child?.parentId, parent?.id)
  db.close()
})

test('directory children remain visible when a drive-root parent is missing from the batch', () => {
  const db = openDatabase(':memory:')
  const library = createLibrary(db, { id: 'drive-root-lib', name: 'Z', roots: ['Z:\\'] })

  upsertEntriesBatch(db, [
    {
      id: asEntryId('z-users'),
      libraryId: asLibraryId(library.id),
      parentId: asEntryId('missing-z-root'),
      name: 'Users',
      stem: 'Users',
      ext: '',
      isDir: true,
      size: 0,
      mtime: 1,
      ctime: 1,
      atime: 1,
      ino: null,
      dev: null,
      depth: 1,
      kind: 'dir',
      protocol: 'local',
      mime: null,
      path: 'Z:\\Users',
      parentPath: 'Z:\\',
      relPath: 'Users',
      hashQuick: null,
      hashFull: null,
      childCount: 0,
      fileCount: 0,
      dirCount: 0,
      tombstone: false,
      seenAt: 1,
      indexedAt: 1,
    },
  ])

  const child = getEntryByPath(db, library.id, 'Z:\\Users')
  assert.ok(child)
  const root = getEntryByPath(db, library.id, 'Z:\\')
  assert.ok(root)
  assert.equal(child?.parentId, root?.id)
  const listed = listDirectoryChildren(db, library.id, 'Z:\\', { limit: 50 })
  assert.deepEqual(listed.hits.map((hit) => hit.name), ['Users'])
  db.close()
})

test('runScan indexes every immediate child even when nested folders remain unread', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nestify-scan-first-level-'))
  mkdirSync(join(root, 'folder-a', 'nested'), { recursive: true })
  mkdirSync(join(root, 'folder-b'))
  writeFileSync(join(root, 'readme.txt'), 'keep')
  writeFileSync(join(root, 'folder-a', 'nested', 'deep.txt'), 'deep')

  const db = openDatabase(':memory:')
  const library = createLibrary(db, {
    id: 'first-level',
    name: 'First level',
    roots: [root],
  })

  await runScan(
    db,
    { roots: [root], incremental: true, hashStrategy: 'duplicate-candidate-only' },
    { libraryId: library.id, concurrency: 2 },
  )

  const listed = listDirectoryChildren(db, library.id, root, { limit: 50 })
  assert.deepEqual(listed.hits.map((hit) => hit.name).sort(), ['folder-a', 'folder-b', 'readme.txt'])
  db.close()
})
