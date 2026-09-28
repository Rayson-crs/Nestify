import test from 'node:test'
import assert from 'node:assert/strict'
import { accumulatePlanPage, carryPlanSelection } from './plan-state.ts'
import type { ChangePlan, PlanOp } from './plan-state.ts'

function op(from: string, to: string | null, extra?: Partial<PlanOp>): PlanOp {
  return {
    op: 'rename',
    from,
    to,
    entryId: extra?.entryId ?? `id:${from}`,
    ruleId: extra?.ruleId ?? null,
    reason: extra?.reason ?? 'test',
    risk: extra?.risk ?? 'none',
    confidence: extra?.confidence ?? 1,
    selected: extra?.selected ?? true,
    ...extra,
  }
}

function plan(ops: PlanOp[], page: {
  offset: number
  count?: number
  hasMore?: boolean
}): ChangePlan {
  return {
    id: `plan:${page.offset}`,
    libraryId: 'library-1',
    createdAt: 1,
    status: 'draft',
    dryRun: true,
    collision: 'suffix',
    seqCursor: { seq: page.offset + 1, parentSeq: [] },
    sourceOffset: page.offset,
    sourceCount: page.count ?? ops.length,
    sourceHasMore: page.hasMore ?? false,
    summary: {
      selected: ops.filter((item) => item.selected).length,
      rename: ops.filter((item) => item.op === 'rename').length,
      move: ops.filter((item) => item.op === 'move').length,
      mkdir: ops.filter((item) => item.op === 'mkdir').length,
      quarantine: 0,
      delete: 0,
      flatten: 0,
      conflicts: 0,
    },
    ops,
  }
}

test('accumulates visited pages and keeps earlier pages when a later page refreshes', () => {
  const first = plan([op('a', 'a-1'), op('b', 'b-1')], { offset: 0, hasMore: true })
  const second = plan([op('c', 'c-1')], { offset: 2, hasMore: false })
  const state = accumulatePlanPage({ current: null, next: first, source: 'rename', fingerprint: 'v1' })
  const paged = accumulatePlanPage({ current: state, next: second, source: 'rename', fingerprint: 'v1', offset: 2 })
  const replacement = plan([op('c', 'c-2')], { offset: 2, hasMore: false })
  const refreshed = accumulatePlanPage({
    current: paged,
    next: replacement,
    source: 'rename',
    fingerprint: 'v1',
    offset: 2,
  })

  assert.deepEqual(refreshed.plan.ops.map((item) => item.from), ['a', 'b', 'c'])
  assert.deepEqual(refreshed.plan.ops.map((item) => item.to), ['a-1', 'b-1', 'c-2'])
  assert.deepEqual(refreshed.pages[0]?.opIndexes, [0, 1])
  assert.deepEqual(refreshed.pages[1]?.opIndexes, [2])
  assert.equal(refreshed.currentPage, replacement)
  assert.equal(refreshed.sourceTotal, 3)

  const refreshedFirst = plan([op('a', 'a-2'), op('b', 'b-1')], { offset: 0, hasMore: true })
  const firstRefreshed = accumulatePlanPage({
    current: refreshed,
    next: refreshedFirst,
    source: 'rename',
    fingerprint: 'v1',
  })
  assert.deepEqual(firstRefreshed.plan.ops.map((item) => item.to), ['a-2', 'b-1', 'c-2'])
  assert.deepEqual(firstRefreshed.pages.map((page) => page.offset), [0, 2])
})

test('discards all visited pages when source or fingerprint changes', () => {
  const first = plan([op('a', 'a-1')], { offset: 0, hasMore: true })
  const state = accumulatePlanPage({ current: null, next: first, source: 'rename', fingerprint: 'v1' })
  const second = plan([op('z', 'z-1')], { offset: 1 })
  const next = accumulatePlanPage({ current: state, next: second, source: 'rename', fingerprint: 'v2', offset: 1 })

  assert.deepEqual(next.plan.ops.map((item) => item.from), ['z'])
  assert.deepEqual(next.pages.map((page) => page.offset), [1])
})

test('carries selections by operation identity when a refreshed page shifts indexes', () => {
  const first = plan([op('a', 'a-1'), op('b', 'b-1')], { offset: 0, hasMore: true })
  const state = accumulatePlanPage({ current: null, next: first, source: 'rename', fingerprint: 'v1' })
  const second = plan([op('c', 'c-1')], { offset: 2, hasMore: false })
  const paged = accumulatePlanPage({ current: state, next: second, source: 'rename', fingerprint: 'v1', offset: 2 })

  const refreshedFirst = plan([op('a', 'a-1'), op('replacement', 'replacement-1')], {
    offset: 0,
    hasMore: true,
  })
  const refreshed = accumulatePlanPage({
    current: paged,
    next: refreshedFirst,
    source: 'rename',
    fingerprint: 'v1',
  })

  const carried = carryPlanSelection(paged, { 0: true, 1: false, 2: true }, refreshed)
  assert.deepEqual(carried, { 0: true, 2: true })
})

test('deduplicates path-level operations across pages while keeping repeated entry operations', () => {
  const mkdirA: PlanOp = {
    ...op('/target', null, { entryId: undefined }),
    op: 'mkdir',
  }
  const first = plan([mkdirA, op('/a', '/target/a')], { offset: 0, hasMore: true })
  const state = accumulatePlanPage({ current: null, next: first, source: 'organize', fingerprint: 'v1' })
  const repeatedMkdir: PlanOp = {
    ...op('/target', null, { entryId: undefined }),
    op: 'mkdir',
  }
  const identical = op('/same', '/same-1')
  const second = plan([repeatedMkdir, identical, { ...identical }], { offset: 2, hasMore: false })
  const next = accumulatePlanPage({ current: state, next: second, source: 'organize', fingerprint: 'v1', offset: 2 })

  assert.equal(next.plan.ops.filter((item) => item.op === 'mkdir').length, 1)
  assert.equal(next.plan.ops.filter((item) => item.from === '/same').length, 2)
  assert.equal(next.plan.summary.mkdir, 1)
  assert.equal(next.plan.summary.rename, 3)
})
