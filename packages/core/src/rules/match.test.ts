import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Entry } from '@nestify/shared'
import { asEntryId, asLibraryId } from '@nestify/shared'
import { buildContextIndex, buildRuleContext } from './context.ts'
import { matches } from './match.ts'

function makeEntry(
  partial: Partial<Omit<Entry, 'id'>> & Pick<Entry, 'name' | 'path' | 'isDir' | 'kind'> & { id: string },
): Entry {
  const lastDot = partial.name.lastIndexOf('.')
  const stem = partial.stem ?? (partial.isDir || lastDot <= 0 ? partial.name : partial.name.slice(0, lastDot))
  const ext = partial.ext ?? (partial.isDir || lastDot <= 0 ? '' : partial.name.slice(lastDot).toLowerCase())
  return {
    libraryId: asLibraryId('lib'),
    parentId: partial.parentId ?? null,
    stem,
    ext,
    size: partial.size ?? 1,
    mtime: 0,
    ctime: 0,
    atime: 0,
    ino: null,
    dev: null,
    depth: partial.depth ?? 1,
    protocol: 'local',
    mime: null,
    parentPath: partial.parentPath ?? null,
    relPath: partial.relPath ?? partial.name,
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: 0,
    indexedAt: 0,
    ...partial,
    id: asEntryId(partial.id),
  }
}

test('sidecar jpg/nfo do not inflate useful file count for a unique video folder', () => {
  const dir = makeEntry({
    id: 'dir1',
    name: 'Movie',
    path: 'D:/inbox/Movie',
    parentPath: 'D:/inbox',
    isDir: true,
    kind: 'dir',
    ext: '',
    stem: 'Movie',
    depth: 1,
  })
  const video = makeEntry({
    id: 'vid',
    parentId: asEntryId('dir1'),
    name: 'Movie.mkv',
    path: 'D:/inbox/Movie/Movie.mkv',
    parentPath: 'D:/inbox/Movie',
    isDir: false,
    kind: 'video',
    depth: 2,
  })
  const cover = makeEntry({
    id: 'jpg',
    parentId: asEntryId('dir1'),
    name: 'Movie.jpg',
    path: 'D:/inbox/Movie/Movie.jpg',
    parentPath: 'D:/inbox/Movie',
    isDir: false,
    kind: 'image',
    depth: 2,
  })
  const nfo = makeEntry({
    id: 'nfo',
    parentId: asEntryId('dir1'),
    name: 'Movie.nfo',
    path: 'D:/inbox/Movie/Movie.nfo',
    parentPath: 'D:/inbox/Movie',
    isDir: false,
    kind: 'document',
    depth: 2,
  })
  const ctx = buildRuleContext(dir, buildContextIndex([dir, video, cover, nfo]))
  assert.equal(ctx.children.video_count, 1)
  assert.equal(ctx.children.useful_file_count, 1)
  assert.equal(ctx.children.main_video?.stem, 'Movie')
  assert.equal(
    matches(
      {
        all: [
          { field: 'is_dir', eq: true },
          { field: 'children.video_count', eq: 1 },
          { field: 'name', ne_field: 'children.main_video.stem' },
        ],
      },
      ctx,
    ),
    false,
  )
})

test('generic string sources expose folder and file names to the same rule chains', () => {
  const dir = makeEntry({
    id: 'dir',
    name: 'AB资料',
    path: 'D:/库/AB资料',
    parentPath: 'D:/库',
    isDir: true,
    kind: 'dir',
  })
  const file = makeEntry({
    id: 'file',
    name: 'AB资料-01.mkv',
    path: 'D:/库/AB资料/AB资料-01.mkv',
    parentPath: 'D:/库/AB资料',
    isDir: false,
    kind: 'video',
  })
  const index = buildContextIndex([dir, file])
  assert.equal(
    matches(
      { field: 'folder_name', transform: [{ name: 'slice', args: ['0', '2'] }], eq: 'AB' },
      buildRuleContext(dir, index),
    ),
    true,
  )
  assert.equal(
    matches(
      { field: 'file_name', transform: [{ name: 'slice', args: ['-3'] }], eq: 'mkv' },
      buildRuleContext(file, index),
    ),
    true,
  )
  assert.equal(
    matches({ field: 'folder_name', eq: 'AB资料' }, buildRuleContext(file, index)),
    false,
  )
})
