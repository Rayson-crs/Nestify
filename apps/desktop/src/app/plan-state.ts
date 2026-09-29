import type { ChangePlan, PlanOp } from '@/lib/ipc'
import type { PlanSource } from '@/lib/workspace'

export type PlanPage = {
  offset: number
  plan: ChangePlan
  opIndexes: number[]
}

export type PlanOpView = {
  op: PlanOp
  index: number
}

export type PlanState = {
  plan: ChangePlan
  source: PlanSource
  fingerprint: string
  pages: PlanPage[]
  currentPage: ChangePlan
  sourceHasMore: boolean
  sourceTotal?: number
}

export type PlanApplyOptions = {
  offset?: number
  fingerprint?: string
  selectionByEntryId?: Record<string, boolean>
}

function operationKey(op: PlanOp): string {
  const identity = op.entryId
    ? `entry:${op.entryId}`
    : `path:${op.op}:${op.from}`
  return [
    identity,
    op.op,
    op.from,
    op.to ?? '',
    op.ruleId ?? '',
    op.reason,
  ].join('\t')
}

function summarize(ops: PlanOp[], conflicts: number): ChangePlan['summary'] {
  return {
    selected: ops.filter((op) => op.selected && op.risk !== 'overwrite').length,
    rename: ops.filter((op) => op.op === 'rename').length,
    move: ops.filter((op) => op.op === 'move').length,
    mkdir: ops.filter((op) => op.op === 'mkdir').length,
    quarantine: ops.filter((op) => op.op === 'quarantine').length,
    delete: ops.filter((op) => op.op === 'delete').length,
    flatten: ops.filter((op) => op.op === 'flatten').length,
    conflicts,
  }
}

export function accumulatePlanPage({
  current,
  next,
  source,
  fingerprint,
  offset = 0,
}: {
  current: PlanState | null
  next: ChangePlan
  source: PlanSource
  fingerprint: string
  offset?: number
}): PlanState {
  const pageOffset = next.sourceOffset ?? offset
  const canReusePages = current?.source === source && current.fingerprint === fingerprint
  const previousPages = canReusePages ? current.pages : []
  const pages = previousPages.filter((page) => page.offset !== pageOffset)
  pages.push({ offset: pageOffset, plan: next, opIndexes: [] })
  pages.sort((a, b) => a.offset - b.offset)
  const visitedPages = pages.map((page) => ({ ...page, opIndexes: [] as number[] }))

  const ops: PlanOp[] = []
  const occurrences = new Map<string, number[]>()
  for (const page of visitedPages) {
    const localOccurrences = new Map<string, number>()
    for (const op of page.plan.ops) {
      const key = operationKey(op)
      const ordinal = localOccurrences.get(key) ?? 0
      localOccurrences.set(key, ordinal + 1)
      const indexes = occurrences.get(key) ?? []
      let index = indexes[ordinal]
      if (index === undefined) {
        index = ops.push(op) - 1
        indexes.push(index)
        occurrences.set(key, indexes)
      }
      page.opIndexes.push(index)
    }
  }

  const currentPage = next
  const sourceHasMore = currentPage.sourceHasMore ?? false
  const sourceCount = currentPage.sourceCount ?? currentPage.ops.length
  const base = pages[0]?.plan ?? next
  const conflicts = pages.reduce((total, page) => total + page.plan.summary.conflicts, 0)
  const plan: ChangePlan = {
    ...base,
    collision: currentPage.collision,
    seqCursor: currentPage.seqCursor,
    ops,
    summary: summarize(ops, conflicts),
  }
  return {
    plan,
    source,
    fingerprint,
    pages: visitedPages,
    currentPage,
    sourceHasMore,
    sourceTotal: sourceHasMore ? undefined : pageOffset + sourceCount,
  }
}

export function carryPlanSelection(
  current: PlanState,
  selectedOps: Record<number, boolean>,
  next: PlanState,
): Record<number, boolean> {
  const previous = new Map<string, boolean>()
  const previousCounts = new Map<string, number>()
  current.plan.ops.forEach((op, index) => {
    const key = operationKey(op)
    const ordinal = previousCounts.get(key) ?? 0
    previousCounts.set(key, ordinal + 1)
    if (Object.prototype.hasOwnProperty.call(selectedOps, index)) {
      previous.set(`${key}\0${ordinal}`, Boolean(selectedOps[index]))
    }
  })

  const result: Record<number, boolean> = {}
  const nextCounts = new Map<string, number>()
  next.plan.ops.forEach((op, index) => {
    const key = operationKey(op)
    const ordinal = nextCounts.get(key) ?? 0
    nextCounts.set(key, ordinal + 1)
    const selection = previous.get(`${key}\0${ordinal}`)
    if (selection !== undefined) result[index] = selection
  })
  return result
}
