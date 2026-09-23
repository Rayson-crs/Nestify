import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MediaMergeItem } from '@nestify/shared'
import { applyMediaMergeOrder } from './order.ts'

function item(index: number, path: string, overrides: Partial<MediaMergeItem> = {}): MediaMergeItem {
  return {
    id: `item-${index}`,
    path,
    kind: 'image',
    size: 1,
    mtime: index,
    trimStart: 0,
    trimEndOffset: null,
    trimSource: 'batch',
    orderIndex: index,
    manualOrder: false,
    ...overrides,
  }
}

test('natural order keeps a2 before a10', () => {
  const result = applyMediaMergeOrder([
    item(0, 'C:/pictures/a10.png'),
    item(1, 'C:/pictures/a2.png'),
    item(2, 'C:/pictures/a1.png'),
  ], 'name-natural')
  assert.deepEqual(
    result.map((entry) => entry.path.split('/').at(-1)),
    ['a1.png', 'a2.png', 'a10.png'],
  )
  assert.deepEqual(result.map((entry) => entry.orderIndex), [0, 1, 2])
})

test('name number order compares filename numbers before path text', () => {
  const result = applyMediaMergeOrder([
    item(0, 'C:/pictures/episode-10.png'),
    item(1, 'C:/pictures/episode-2.png'),
    item(2, 'C:/other/episode-1.png'),
  ], 'name-number')
  assert.deepEqual(
    result.map((entry) => entry.path.split('/').at(-1)),
    ['episode-1.png', 'episode-2.png', 'episode-10.png'],
  )
})

test('manual order survives rule sorting as an explicit override', () => {
  const result = applyMediaMergeOrder([
    item(0, 'C:/a1.png'),
    item(1, 'C:/a2.png', { manualOrder: true, orderIndex: 2 }),
    item(2, 'C:/a3.png'),
  ], 'name-natural')
  assert.deepEqual(result.map((entry) => entry.path), ['C:/a1.png', 'C:/a3.png', 'C:/a2.png'])
  assert.equal(result[2]?.manualOrder, true)
})

test('multiple criteria apply direction and assistant filters before falling back', () => {
  const profile = {
    criteria: [
      { id: 'ext', field: 'extension' as const, direction: 'asc' as const, textMode: 'natural' as const, pattern: '' },
      { id: 'episode', field: 'number' as const, direction: 'desc' as const, textMode: 'natural' as const, pattern: 'name:第' },
      { id: 'name', field: 'name' as const, direction: 'asc' as const, textMode: 'natural' as const, pattern: '' },
    ],
  }
  const result = applyMediaMergeOrder([
    item(0, 'C:/media/第10集-图片.jpg'),
    item(1, 'C:/media/第2集-视频.mp4'),
    item(2, 'C:/media/第2集-图片.jpg'),
  ], 'rules', profile)
  assert.deepEqual(result.map((entry) => entry.path.split('/').at(-1)), [
    '第10集-图片.jpg',
    '第2集-图片.jpg',
    '第2集-视频.mp4',
  ])
})

test('assistant filters sort matched files and place unmatched files after them', () => {
  const profile = {
    criteria: [
      { id: 'jpg', field: 'name' as const, direction: 'asc' as const, textMode: 'natural' as const, pattern: 'ext:jpg AND name:图片' },
    ],
  }
  const result = applyMediaMergeOrder([
    item(0, 'C:/media/图片-10.jpg'),
    item(1, 'C:/media/clip-2.mp4'),
    item(2, 'C:/media/图片-2.jpg'),
  ], 'rules', profile)
  assert.deepEqual(result.map((entry) => entry.path.split('/').at(-1)), [
    '图片-2.jpg',
    '图片-10.jpg',
    'clip-2.mp4',
  ])
})
