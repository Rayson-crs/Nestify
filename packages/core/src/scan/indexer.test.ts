import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { asLibraryId } from '@nestify/shared'
import { openDatabase } from '../db/open.ts'
import { countEntries, createLibrary, getEntryByPath } from '../db/repos/index.ts'
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
