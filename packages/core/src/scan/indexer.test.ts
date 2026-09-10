import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
import { searchEntries } from '../search/index.ts'
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
