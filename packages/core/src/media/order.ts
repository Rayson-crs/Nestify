import type {
  MediaMergeItem,
  MediaMergeOrderCriterion,
  MediaMergeOrderProfile,
  MediaMergeOrderRule,
} from '@nestify/shared'
import { mediaItemMatchesPattern } from './order-filter.ts'

export function applyMediaMergeOrder(
  items: readonly MediaMergeItem[],
  rule: MediaMergeOrderRule,
  profile?: MediaMergeOrderProfile,
): MediaMergeItem[] {
  const criteria = criteriaFor(rule, profile)
  if (criteria.length === 0) {
    return [...items]
      .sort((a, b) => a.orderIndex - b.orderIndex || compareText(a.path, b.path))
      .map((item, index) => ({ ...item, orderIndex: index }))
  }

  const ordered = items
    .filter((item) => !item.manualOrder)
    .sort((a, b) => compareByCriteria(a, b, criteria))
  const result = new Array<MediaMergeItem | undefined>(items.length)

  for (const item of items) {
    if (!item.manualOrder) continue
    let cursor = Math.min(Math.max(item.orderIndex, 0), result.length - 1)
    while (cursor < result.length && result[cursor] !== undefined) cursor += 1
    if (cursor >= result.length) {
      cursor = Math.min(Math.max(item.orderIndex, 0), result.length - 1)
      while (cursor >= 0 && result[cursor] !== undefined) cursor -= 1
    }
    if (cursor >= 0) result[cursor] = item
  }

  let cursor = 0
  for (const item of ordered) {
    while (cursor < result.length && result[cursor] !== undefined) cursor += 1
    if (cursor >= result.length) break
    result[cursor] = item
    cursor += 1
  }

  return result
    .filter((item): item is MediaMergeItem => item !== undefined)
    .map((item, index) => ({ ...item, orderIndex: index }))
}

function criteriaFor(rule: MediaMergeOrderRule, profile?: MediaMergeOrderProfile): MediaMergeOrderCriterion[] {
  if (rule === 'manual') return []
  if (rule === 'rules') return profile?.criteria ?? []
  if (rule === 'mtime') return [criterion('mtime', 'asc')]
  if (rule === 'path') return [criterion('path', 'asc')]
  if (rule === 'name-number') return [criterion('number', 'asc'), criterion('name', 'asc')]
  return [criterion('name', 'asc')]
}

function criterion(
  field: MediaMergeOrderCriterion['field'],
  direction: MediaMergeOrderCriterion['direction'],
): MediaMergeOrderCriterion {
  return { id: field, field, direction, textMode: 'natural', pattern: '' }
}

function compareByCriteria(a: MediaMergeItem, b: MediaMergeItem, criteria: readonly MediaMergeOrderCriterion[]): number {
  for (const criterion of criteria) {
    const leftMatches = mediaItemMatchesPattern(a, criterion.pattern)
    const rightMatches = mediaItemMatchesPattern(b, criterion.pattern)
    if (!leftMatches && !rightMatches) continue
    if (leftMatches !== rightMatches) return leftMatches ? -1 : 1
    const delta = compareByCriterion(a, b, criterion)
    if (delta !== 0) return criterion.direction === 'desc' ? -delta : delta
  }
  return compareText(a.path, b.path)
}

function compareByCriterion(a: MediaMergeItem, b: MediaMergeItem, criterion: MediaMergeOrderCriterion): number {
  if (criterion.field === 'mtime') return (a.mtime ?? Number.POSITIVE_INFINITY) - (b.mtime ?? Number.POSITIVE_INFINITY)
  if (criterion.field === 'size') return a.size - b.size
  if (criterion.field === 'extension') return compareTextValue(extensionOf(a.path), extensionOf(b.path), criterion)
  if (criterion.field === 'path') return compareTextValue(a.path, b.path, criterion)
  if (criterion.field === 'number') return compareNameNumber(a.path, b.path)
  return compareTextValue(fileName(a.path), fileName(b.path), criterion)
}

function fileName(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index >= 0 ? path.slice(index + 1) : path
}

export function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    || a.localeCompare(b)
}

function compareTextValue(a: string, b: string, criterion: MediaMergeOrderCriterion): number {
  if (criterion.textMode === 'literal') return a.localeCompare(b) || a.localeCompare(b, 'zh-Hans-CN')
  return compareText(a, b)
}

function compareNameNumber(a: string, b: string): number {
  const left = fileName(a).match(/\d+/g) ?? []
  const right = fileName(b).match(/\d+/g) ?? []
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const delta = Number(left[index]) - Number(right[index])
    if (delta !== 0) return delta
  }
  return left.length - right.length
}

function extensionOf(path: string): string {
  const name = fileName(path)
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1).toLowerCase() : ''
}
