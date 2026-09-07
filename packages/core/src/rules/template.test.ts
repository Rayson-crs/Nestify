import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Entry } from '@nestify/shared'
import { asEntryId, asLibraryId } from '@nestify/shared'
import { buildContextIndex, buildRuleContext } from './context.ts'
import { renderTemplate } from './template.ts'

function file(path: string, extras: Partial<Entry> = {}): Entry {
  const parts = path.split('/').filter(Boolean)
  const name = parts.at(-1) ?? path
  const lastDot = name.lastIndexOf('.')
  const stem = lastDot > 0 ? name.slice(0, lastDot) : name
  const ext = lastDot > 0 ? name.slice(lastDot) : ''
  const joinedParent = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : null
  return {
    id: asEntryId(extras.id ?? path),
    libraryId: asLibraryId('lib'),
    parentId: extras.parentId ?? (joinedParent ? asEntryId(joinedParent) : null),
    name,
    stem,
    ext,
    isDir: false,
    size: 1,
    mtime: 0,
    ctime: 0,
    atime: 0,
    ino: null,
    dev: null,
    depth: Math.max(0, parts.length - 1),
    kind: extras.kind ?? 'video',
    protocol: 'local',
    mime: null,
    path,
    parentPath: extras.parentPath ?? joinedParent,
    relPath: parts.slice(1).join('/'),
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: 0,
    indexedAt: 0,
    ...extras,
  }
}

test('template can lift grandparent and clean release tags', () => {
  const entry = file('/电影库/阿凡达/[4K]阿凡达.2009.mp4')
  const ctx = buildRuleContext(entry, buildContextIndex([entry]), { seq: 1 })
  const out = renderTemplate(
    "{grandparent}_{name.regex_replace('\\[.*?\\]', '').trim()}_{seq}{ext}",
    ctx,
  )
  assert.equal(out, '电影库_阿凡达.2009_1.mp4')
})

test('parent and grandparent templates map a/b/c/a.txt', () => {
  const entry = file('/a/b/c/a.txt', { kind: 'document' })
  const ctx = buildRuleContext(entry, buildContextIndex([entry]), { seq: 1 })
  assert.equal(renderTemplate('{parent}{ext}', ctx), 'c.txt')
  assert.equal(renderTemplate('{grandparent}{ext}', ctx), 'b.txt')
})
