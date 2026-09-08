import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Entry } from '@nestify/shared'
import { asEntryId, asLibraryId } from '@nestify/shared'
import { getBuiltinProfile } from '@nestify/rules'
import { planRename, planRuleset } from './planner.ts'

function entry(
  partial: Partial<Omit<Entry, 'id'>> & Pick<Entry, 'name' | 'path' | 'isDir' | 'kind'> & { id: string },
): Entry {
  const lastDot = partial.name.lastIndexOf('.')
  const stem = partial.stem ?? (partial.isDir || lastDot <= 0 ? partial.name : partial.name.slice(0, lastDot))
  const ext = partial.ext ?? (partial.isDir || lastDot <= 0 ? '' : partial.name.slice(lastDot))
  return {
    libraryId: asLibraryId('lib1'),
    parentId: partial.parentId ?? null,
    stem,
    ext,
    size: partial.size ?? 8,
    mtime: 1,
    ctime: 1,
    atime: 1,
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
    seenAt: 1,
    indexedAt: 1,
    ...partial,
    id: asEntryId(partial.id),
  }
}

test('download-inbox dry-run plans rename, flatten, tag strip, and quarantine', () => {
  const root = entry({
    id: 'root',
    name: 'inbox',
    path: 'D:/inbox',
    isDir: true,
    kind: 'dir',
    ext: '',
    depth: 0,
    parentPath: 'D:/',
  })
  const messy = entry({
    id: 'messy',
    parentId: asEntryId('root'),
    name: '乱码目录',
    path: 'D:/inbox/乱码目录',
    parentPath: 'D:/inbox',
    isDir: true,
    kind: 'dir',
    ext: '',
    depth: 1,
  })
  const nested = entry({
    id: 'nested',
    parentId: asEntryId('messy'),
    name: 'Avatar',
    path: 'D:/inbox/乱码目录/Avatar',
    parentPath: 'D:/inbox/乱码目录',
    isDir: true,
    kind: 'dir',
    ext: '',
    depth: 2,
  })
  const video = entry({
    id: 'video',
    parentId: asEntryId('nested'),
    name: '[4K]Avatar.2009.mkv',
    path: 'D:/inbox/乱码目录/Avatar/[4K]Avatar.2009.mkv',
    parentPath: 'D:/inbox/乱码目录/Avatar',
    isDir: false,
    kind: 'video',
    depth: 3,
  })
  const archive = entry({
    id: 'zip',
    parentId: asEntryId('root'),
    name: 'Show.zip',
    path: 'D:/inbox/Show.zip',
    parentPath: 'D:/inbox',
    isDir: false,
    kind: 'archive',
    depth: 1,
  })
  const peerDir = entry({
    id: 'showdir',
    parentId: asEntryId('root'),
    name: 'Show',
    path: 'D:/inbox/Show',
    parentPath: 'D:/inbox',
    isDir: true,
    kind: 'dir',
    ext: '',
    depth: 1,
  })

  const profile = getBuiltinProfile('download-inbox')
  assert.ok(profile)
  const plan = planRuleset({
    libraryId: 'lib1',
    entries: [root, messy, nested, video, archive, peerDir],
    ruleSet: profile,
    collision: 'suffix',
    libraryRoot: 'D:/inbox',
    quarantineDir: 'D:/inbox/.nestify-quarantine',
    now: 1,
  })

  assert.equal(plan.dryRun, true)
  assert.ok(plan.ops.some((op) => op.op === 'flatten'))
  assert.ok(plan.ops.some((op) => op.op === 'rename' && op.ruleId === 'strip-release-tags'))
  assert.ok(plan.ops.some((op) => op.op === 'quarantine' && op.from.endsWith('Show.zip')))
  assert.equal(plan.ops.some((op) => op.to?.includes('\\Videos\\') || op.to?.includes('/Videos/')), false)
})

test('rename preview can take parent or grandparent as the new filename', () => {
  const file = entry({
    id: 'file',
    name: 'a.txt',
    path: 'D:/a/b/c/a.txt',
    parentPath: 'D:/a/b/c',
    isDir: false,
    kind: 'document',
    depth: 3,
  })
  const parentPlan = planRename({
    libraryId: 'lib1',
    entries: [file],
    template: '{parent}{ext}',
    now: 1,
  })
  assert.equal(parentPlan.ops[0]?.to?.endsWith('c.txt'), true)

  const gp = planRename({
    libraryId: 'lib1',
    entries: [file],
    template: '{grandparent}{ext}',
    now: 1,
  })
  assert.equal(gp.ops[0]?.to?.endsWith('b.txt'), true)
})

test('scoped planning still detects collisions with unselected entries', () => {
  const source = entry({
    id: 'source',
    name: 'a.txt',
    path: 'D:/lib/a.txt',
    parentPath: 'D:/lib',
    isDir: false,
    kind: 'document',
    depth: 1,
  })
  const occupied = entry({
    id: 'occupied',
    name: 'a-renamed.txt',
    path: 'D:/lib/a-renamed.txt',
    parentPath: 'D:/lib',
    isDir: false,
    kind: 'document',
    depth: 1,
  })

  const plan = planRename({
    libraryId: 'lib1',
    entries: [source, occupied],
    candidateEntryIds: [source.id],
    template: '{stem}-renamed{ext}',
    now: 1,
  })

  assert.equal(plan.ops.length, 1)
  assert.equal(plan.ops[0]?.entryId, source.id)
  assert.equal(plan.ops[0]?.to?.endsWith('a-renamed (1).txt'), true)
})
