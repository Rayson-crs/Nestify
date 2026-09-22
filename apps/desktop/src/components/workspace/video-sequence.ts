import type { MediaMergeItem } from '@/lib/ipc'

export type SequenceSegment = {
  item: MediaMergeItem
  sourceStart: number
  sourceEnd: number
  length: number
  timelineStart: number
  timelineEnd: number
}

export const PLAYBACK_RATES = [0.5, 1, 1.5, 2, 4, 10, 20, 50, 100] as const
export const TIMELINE_WINDOW = 24
export const NATIVE_PLAYBACK_RATE_LIMIT = 16

export function nativePlaybackRate(rate: number): number {
  return Math.min(Math.max(rate, 0.25), NATIVE_PLAYBACK_RATE_LIMIT)
}

export function buildSegments(
  items: readonly MediaMergeItem[],
  durations: Readonly<Record<string, number>>,
  overlap: number,
): SequenceSegment[] {
  let cursor = 0
  return items.map((item, index) => {
    const duration = item.kind === 'image'
      ? Math.min(120, Math.max(0.2, item.imageDurationSeconds ?? 3))
      : durations[item.id] ?? 0
    const sourceStart = Math.max(0, item.trimStart)
    const sourceEnd = duration > 0
      ? Math.max(sourceStart + 0.1, duration - Math.max(0, item.trimEndOffset ?? 0))
      : sourceStart + 1
    const length = Math.max(0.1, sourceEnd - sourceStart)
    const timelineStart = cursor
    const timelineEnd = timelineStart + length
    const nextOverlap = index < items.length - 1 ? Math.min(overlap, length / 2) : 0
    cursor = timelineEnd - nextOverlap
    return { item, sourceStart, sourceEnd, length, timelineStart, timelineEnd }
  })
}

export function segmentAt(segments: readonly SequenceSegment[], time: number): SequenceSegment | undefined {
  return segments.find((segment, index) =>
    time >= segment.timelineStart && (time < segment.timelineEnd || index === segments.length - 1),
  )
}

export function prioritizeByActive<T extends { id: string }>(items: readonly T[], activeId: string | null): T[] {
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId))
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftNear = Math.abs(left.index - activeIndex) < TIMELINE_WINDOW
      const rightNear = Math.abs(right.index - activeIndex) < TIMELINE_WINDOW
      if (leftNear !== rightNear) return leftNear ? -1 : 1
      if (leftNear && rightNear) return Math.abs(left.index - activeIndex) - Math.abs(right.index - activeIndex)
      return left.index - right.index
    })
    .map((entry) => entry.item)
}

export async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  cancelled: () => boolean,
  worker: (item: T) => Promise<R>,
  onResult: (result: R) => void,
): Promise<void> {
  const limit = Math.max(1, size)
  for (let index = 0; index < items.length; index += limit) {
    if (cancelled()) return
    const results = await Promise.all(items.slice(index, index + limit).map((item) => worker(item)))
    if (cancelled()) return
    for (const result of results) onResult(result)
  }
}
