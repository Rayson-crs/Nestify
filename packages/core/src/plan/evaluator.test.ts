import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Entry, PlanOp } from '@nestify/shared'
import { asEntryId, asLibraryId } from '@nestify/shared'
import type { RuleDefinition } from '@nestify/rules'
import { evaluateRuleSteps, type EvaluateEnv, type SeqState } from './evaluator.ts'
import { buildContextIndex } from '../rules/context.ts'
import { VirtualFs } from './vfs.ts'

function minimalEntry(partial: {
  id: string
  name: string
  path: string
  parentPath?: string | null
  isDir: boolean
  kind: Entry['kind']
}): Entry {
  const lastDot = partial.name.lastIndexOf('.')
  const stem = partial.isDir || lastDot <= 0 ? partial.name : partial.name.slice(0, lastDot)
  const ext = partial.isDir || lastDot <= 0 ? '' : partial.name.slice(lastDot)
  return {
    id: asEntryId(partial.id),
    libraryId: asLibraryId('lib1'),
    parentId: null,
    parentPath: partial.parentPath ?? null,
    depth: 1,
    size: 8,
    mtime: 1,
    ctime: 1,
    atime: 1,
    ino: null,
    dev: null,
    protocol: 'local',
    mime: null,
    relPath: partial.name,
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: 1,
    indexedAt: 1,
    stem,
    ext,
    name: partial.name,
    path: partial.path,
    isDir: partial.isDir,
    kind: partial.kind,
  }
}

function makeEnv(rule: RuleDefinition, entry: Entry): EvaluateEnv {
  const entries = [entry]
  const index = buildContextIndex(entries)
  const vfs = new VirtualFs(entries)
  const ops: PlanOp[] = []
  const seqState: SeqState = { seq: 0, parentSeq: new Map<string, number>() }
  return {
    collision: 'suffix',
    index,
    vfs,
    ops,
    seqState,
    libraryRoot: 'D:/lib',
    quarantineDir: 'D:/lib/.quarantine',
    rule,
  }
}

test('evaluator executes a complete download-inbox stepped ruleset on a tagging file', () => {
  const file = minimalEntry({
    id: 'tagged',
    name: 'Movie.Name.[1080P].mkv',
    path: 'D:/lib/Movie.Name.[1080P].mkv',
    parentPath: 'D:/lib',
    isDir: false,
    kind: 'video',
  })
  const env = makeEnv(
    {
      id: 'strip-release-tags',
      enabled: true,
      priority: 3,
      action: 'rename_file',
      steps: [
        {
          id: 'strip:filter',
          kind: 'filter',
          when: {
            all: [
              { field: 'is_dir', eq: false },
              { field: 'name', regex: '(?i)(\\[.*?\\]|1080P|2160P|4K|WEB-DL|BluRay)' },
            ],
          },
          target: { kind: 'self' },
        },
        {
          id: 'strip:clean-stem',
          kind: 'transform',
          from: { kind: 'self' },
          as: 'cleanStem',
          expr: "{name.regex_replace('\\\\[.*?\\\\]', '').regex_replace('(?i)(1080P|2160P|4K|WEB-DL|BluRay)', '').trim()}",
        },
        {
          id: 'strip:action',
          kind: 'action',
          action: 'rename_file',
          target: { kind: 'self' },
          template: '{scope.last.cleanStem}{ext}',
          reason: 'tag stripped',
        },
      ],
    },
    file,
  )

  const trace = evaluateRuleSteps(env, file)

  assert.equal(trace.hit, true)
  assert.equal(env.ops.length, 1)
  const op = env.ops[0] as { to: string | null }
  assert.equal(op.to?.endsWith('Movie.Name..mkv'), true, `got op=${JSON.stringify(env.ops[0])}`)
  assert.equal(trace.producedOps, 1)
  const kinds = trace.steps.map((entry) => entry.kind)
  assert.deepEqual(kinds, ['filter', 'transform', 'action'])
})

test('evaluator skips a file that does not match the filter (no ops pushed)', () => {
  const file = minimalEntry({
    id: 'clean',
    name: 'Holiday.mp4',
    path: 'D:/lib/Holiday.mp4',
    parentPath: 'D:/lib',
    isDir: false,
    kind: 'video',
  })
  const env = makeEnv(
    {
      id: 'strip-release-tags',
      enabled: true,
      priority: 3,
      action: 'rename_file',
      steps: [
        {
          id: 'strip:filter',
          kind: 'filter',
          when: {
            all: [
              { field: 'is_dir', eq: false },
              { field: 'name', regex: '(?i)(\\[.*?\\]|1080P|2160P|4K|WEB-DL|BluRay)' },
            ],
          },
          target: { kind: 'self' },
        },
        {
          id: 'strip:action',
          kind: 'action',
          action: 'rename_file',
          target: { kind: 'self' },
          template: '{name}{ext}',
        },
      ],
    },
    file,
  )

  const trace = evaluateRuleSteps(env, file)
  assert.equal(env.ops.length, 0)
  assert.equal(trace.producedOps, 0)
  assert.equal(trace.steps[0]?.matched, false)
})

test('evaluator ifElse picks then-branch when predicate hits and skips else-branch', () => {
  const dir = minimalEntry({
    id: 'dir1',
    name: 'Album',
    path: 'D:/lib/Album',
    parentPath: 'D:/lib',
    isDir: true,
    kind: 'dir',
  })
  const env = makeEnv(
    {
      id: 'demo-ifelse',
      enabled: true,
      priority: 10,
      action: 'rename_dir',
      steps: [
        {
          id: 'demo:if',
          kind: 'ifElse',
          when: { field: 'is_dir', eq: true },
          then: {
            id: 'demo:then',
            kind: 'action',
            action: 'rename_dir',
            template: 'Disk-{name}',
          },
          else: {
            id: 'demo:else',
            kind: 'action',
            action: 'rename_file',
            template: 'File-{name}{ext}',
          },
        },
      ],
    },
    dir,
  )

  const trace = evaluateRuleSteps(env, dir)
  assert.equal(env.ops.length, 1)
  const op = env.ops[0] as { to: string | null }
  assert.equal(op.to?.endsWith('Disk-Album'), true)
  assert.equal(trace.steps[0]?.matched, true)
  const branchChildren = trace.steps[0]?.children ?? []
  assert.equal(branchChildren.length, 1)
  assert.equal(branchChildren[0]?.kind, 'action')
})

test('evaluator forEach runs inner step with as variable in scope', () => {
  const parent = minimalEntry({
    id: 'parent',
    name: 'Series',
    path: 'D:/lib/Series',
    parentPath: 'D:/lib',
    isDir: true,
    kind: 'dir',
  })
  const env = makeEnv(
    {
      id: 'demo-foreach',
      enabled: true,
      priority: 1,
      action: 'rename_file',
      steps: [
        {
          id: 'demo:fe',
          kind: 'forEach',
          of: { kind: 'self' },
          as: 'item',
          steps: [
            {
              id: 'demo:fe-body',
              kind: 'transform',
              as: 'value',
              from: { kind: 'self' },
              expr: '{name}',
            },
          ],
        },
      ],
    },
    parent,
  )

  const trace = evaluateRuleSteps(env, parent)
  assert.equal(trace.hit, true)
  assert.equal(env.ops.length, 0)
  assert.equal(trace.steps[0]?.kind, 'forEach')
})

test('evaluator supports nested forEach → ifElse → action', () => {
  const parent = minimalEntry({
    id: 'parent',
    name: 'Series',
    path: 'D:/lib/Series',
    parentPath: 'D:/lib',
    isDir: true,
    kind: 'dir',
  })
  const childA = minimalEntry({
    id: 'child-a',
    name: 'a.txt',
    path: 'D:/lib/Series/a.txt',
    parentPath: 'D:/lib/Series',
    isDir: false,
    kind: 'document',
  })
  const env = makeEnv(
    {
      id: 'demo-nested',
      enabled: true,
      priority: 1,
      action: 'rename_file',
      steps: [
        {
          id: 'n:fe',
          kind: 'forEach',
          of: { kind: 'children' },
          as: 'item',
          steps: [
            {
              id: 'n:if',
              kind: 'ifElse',
              when: { field: 'is_dir', eq: false },
              then: [
                {
                  id: 'n:t',
                  kind: 'transform',
                  as: 'up',
                  from: { kind: 'self' },
                  expr: '{stem.upper()}_UP',
                },
                {
                  id: 'n:act',
                  kind: 'action',
                  action: 'rename_file',
                  template: '{scope.last.up}{ext}',
                  reason: 'nested rename',
                },
              ],
            },
          ],
        },
      ],
    },
    parent,
  )
  // fixture 默认 parentId=null，children 目标按 parentId 建索引，补上真实父子关系
  const bound = childA as unknown as { parentId: string }
  bound.parentId = parent.id
  env.index = buildContextIndex([parent, childA])
  env.vfs = new VirtualFs([parent, childA])

  const trace = evaluateRuleSteps(env, parent)
  assert.equal(trace.hit, true)
  assert.equal(env.ops.length, 1)
  const op = env.ops[0] as { to: string | null }
  assert.equal(op.to?.endsWith('A_UP.txt'), true)
  // 嵌套 trace 结构：forEach 下挂 ifElse，且条件命中
  const fe = trace.steps[0] as {
    kind?: string
    children?: Array<{ kind?: string; matched?: boolean }>
  }
  assert.equal(fe.kind, 'forEach')
  assert.equal(fe.children?.[0]?.kind, 'ifElse')
  assert.equal(fe.children?.[0]?.matched, true)
})
