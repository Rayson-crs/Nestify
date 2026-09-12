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

test('template supports current time formatting and character dedupe', () => {
  const entry = file('/a/aabb.txt')
  const ctx = buildRuleContext(entry, buildContextIndex([entry]), { seq: 1 })
  assert.equal(renderTemplate('{name.dedupe}', ctx), 'ab')
  assert.match(renderTemplate('{now:yyyy}', ctx), /^\d{4}$/)
})

test('template supports character formatting and length functions', () => {
  const entry = file('/a/Ab-12.txt')
  const ctx = buildRuleContext(entry, buildContextIndex([entry]), { seq: 1 })
  assert.equal(renderTemplate('{name.length}', ctx), '5')
  assert.equal(renderTemplate('{name.keep_digits}', ctx), '12')
  assert.equal(renderTemplate('{name.reverse}', ctx), '21-bA')
  assert.equal(renderTemplate('{name.truncate(3)}', ctx), 'Ab-…')
})

test('template supports prefix, extract and catch-empty helpers', () => {
  const entry = file('/a/Movie (2024) [4K].mkv')
  const ctx = buildRuleContext(entry, buildContextIndex([entry]), { seq: 1 })
  assert.equal(renderTemplate("{name.extract_year()}", ctx), '2024')
  assert.equal(renderTemplate("{name.between('(', ')')}", ctx), '2024')
  assert.equal(renderTemplate("{name.first_word()}", ctx), 'Movie')
  assert.equal(renderTemplate("{name.if_empty('未命名')}", ctx), 'Movie (2024) [4K]')
  assert.equal(renderTemplate("{name.regex_replace('.*', '').if_empty('未命名')}", ctx), '未命名')
  assert.equal(renderTemplate("{name.ensure_prefix('Title_')}", ctx), 'Title_Movie (2024) [4K]')
})

test('template supports case conversion and wrap helpers', () => {
  const entry = file('/a/Hello World.txt')
  const ctx = buildRuleContext(entry, buildContextIndex([entry]), { seq: 1 })
  assert.equal(renderTemplate('{name.snake_case()}', ctx), 'hello_world')
  assert.equal(renderTemplate('{name.kebab_case()}', ctx), 'hello-world')
  assert.equal(renderTemplate("{name.prefix('pre_').suffix('_end')}", ctx), 'pre_Hello World_end')
  assert.equal(renderTemplate("{name.remove_brackets()}", ctx), 'Hello World')
})

test('template supports download-name cleanup chains', () => {
  const entry = file('/电影库/阿凡达/[4K]阿凡达.2009.副本.mp4')
  const ctx = buildRuleContext(entry, buildContextIndex([entry]), { seq: 1 })
  assert.equal(renderTemplate('{name.remove_bracket_content()}', ctx), '阿凡达.2009.副本')
  assert.equal(renderTemplate('{name.collapse_dots()}', ctx), '[4K]阿凡达 2009 副本')
  assert.equal(renderTemplate('{name.extract_year()}', ctx), '2009')
  assert.equal(renderTemplate('{name.remove_year()}', ctx), '[4K]阿凡达 副本')
  assert.equal(renderTemplate('{name.extract_resolution()}', ctx), '2160p')
  assert.equal(renderTemplate("{name.pad_number(3, '0')}", ctx), '[004K]阿凡达.2009.副本')
  assert.equal(renderTemplate('{mtime:yyyy}', ctx), '1970')
})


test('pad_number pads the first digit run and can be used on numeric stems', () => {
  const numeric = file('/a/2.mp4')
  const numericCtx = buildRuleContext(numeric, buildContextIndex([numeric]), { seq: 1 })
  assert.equal(renderTemplate("{name.pad_number(3, '0')}", numericCtx), '002')
})

test('template supports parent/CD/ext condition chains', () => {
  const numeric = file('/电影库/阿凡达/1.mp4')
  const numericCtx = buildRuleContext(numeric, buildContextIndex([numeric]), { seq: 1 })
  assert.equal(renderTemplate('{name.take_parent_if_numeric()}{ext}', numericCtx), '阿凡达.mp4')
  assert.equal(renderTemplate("{name.if_contains('4K', '[4K]')}{ext}", numericCtx), '1.mp4')
  assert.equal(renderTemplate('{name.ensure_ext()}', numericCtx), '1.mp4')
  assert.equal(renderTemplate('{name.max_len(1)}{ext}', numericCtx), '1.mp4')

  const tagged = file('/电影库/阿凡达/Avatar 4K.mkv')
  const taggedCtx = buildRuleContext(tagged, buildContextIndex([tagged]), { seq: 1 })
  assert.equal(renderTemplate("{name.if_contains('4K', '[4K]')}{ext}", taggedCtx), '[4K].mkv')

  const disc = file('/电影库/阿凡达/CD1/1.mp4')
  const discCtx = buildRuleContext(disc, buildContextIndex([disc]), { seq: 1 })
  assert.equal(renderTemplate('{parent.take_grandparent_if_cd()}', discCtx), '阿凡达')
  assert.equal(renderTemplate('{name.take_parent_if_numeric()}{ext}', discCtx), 'CD1.mp4')
})
