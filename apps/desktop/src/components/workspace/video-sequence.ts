import type { MediaMergeItem } from '@/lib/ipc'
import { mediaFileUrl } from './merge-pane-shared'

export type SequenceSegment = {
  item: MediaMergeItem
  sourceStart: number
  sourceEnd: number
  length: number
  timelineStart: number
  timelineEnd: number
}

export type PlaybackScope = 'sequence' | 'clip'

export type ClipPreviewStatus = 'ready' | 'preparing' | 'failed'

export type ClipReadResult = {
  id: string
  path: string
  src: string
  duration: number
  status: ClipPreviewStatus
  error?: string
}

export type PreviewProxyResult = {
  src: string
  status: ClipPreviewStatus
  error?: string | null
}

export const PLAYBACK_RATES = [0.5, 1, 1.5, 2, 4, 10, 20, 50, 100] as const
export const TIMELINE_WINDOW = 24
export const NATIVE_PLAYBACK_RATE_LIMIT = 16
const DIRECT_VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".webm", ".mov", ".f4v"])

export function needsPreviewProxy(path: string): boolean {
  const dot = path.lastIndexOf(".")
  const extension = dot >= 0 ? path.slice(dot).toLowerCase() : ""
  return !DIRECT_VIDEO_EXTENSIONS.has(extension)
}

export function imageDwellSeconds(item: MediaMergeItem): number {
  return Math.min(120, Math.max(0.2, item.imageDurationSeconds ?? 3))
}

export function missingDurationItems(
  items: readonly MediaMergeItem[],
  durations: ReadonlyMap<string, number>,
): MediaMergeItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (item.kind !== 'video' || durations.has(item.path) || seen.has(item.path)) return false
    seen.add(item.path)
    return true
  })
}

export function nativePlaybackRate(rate: number): number {
  return Math.min(Math.max(rate, 0.25), NATIVE_PLAYBACK_RATE_LIMIT)
}

export function buildSegments(
  items: readonly MediaMergeItem[],
  durations: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
  overlap: number,
): SequenceSegment[] {
  let cursor = 0
  return items.map((item, index) => {
    const isImage = item.kind === 'image'
    const duration = isImage
      ? imageDwellSeconds(item)
      : readDuration(durations, item.path) ?? 0
    const sourceStart = isImage ? 0 : Math.max(0, item.trimStart)
    const sourceEnd = duration > 0
      ? Math.max(sourceStart + 0.1, duration - (isImage ? 0 : Math.max(0, item.trimEndOffset ?? 0)))
      : sourceStart + 1
    const length = Math.max(0.1, sourceEnd - sourceStart)
    const timelineStart = cursor
    const timelineEnd = timelineStart + length
    const nextOverlap = index < items.length - 1 ? Math.min(overlap, length / 2) : 0
    cursor = timelineEnd - nextOverlap
    return { item, sourceStart, sourceEnd, length, timelineStart, timelineEnd }
  })
}

function readDuration(
  durations: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
  path: string,
): number | undefined {
  if (durations instanceof Map) return durations.get(path)
  const record = durations as Readonly<Record<string, number>>
  return record[path]
}

export function segmentAt(segments: readonly SequenceSegment[], time: number): SequenceSegment | undefined {
  return segments.find((segment, index) =>
    time >= segment.timelineStart && (time < segment.timelineEnd || index === segments.length - 1),
  )
}

export function playableSegmentAt(
  segments: readonly SequenceSegment[],
  time: number,
  failed: ReadonlySet<string>,
  direction: 1 | -1 = 1,
): SequenceSegment | undefined {
  const index = segments.findIndex((segment, entryIndex) =>
    time >= segment.timelineStart && (time < segment.timelineEnd || entryIndex === segments.length - 1),
  )
  if (index < 0) return undefined
  const current = segments[index]
  if (!current || !failed.has(current.item.path)) return current
  return nextPlayableSegment(segments, index, direction, failed)
    ?? nextPlayableSegment(segments, index, direction === 1 ? -1 : 1, failed)
}

export function nextPlayableSegment(
  segments: readonly SequenceSegment[],
  index: number,
  direction: 1 | -1,
  failed: ReadonlySet<string>,
): SequenceSegment | undefined {
  for (let cursor = index + direction; cursor >= 0 && cursor < segments.length; cursor += direction) {
    const segment = segments[cursor]
    if (segment && !failed.has(segment.item.path)) return segment
  }
  return undefined
}

export function effectivePreviewVolume(
  item: MediaMergeItem,
  outputVolume: number | undefined,
  previewMuted: boolean,
  audio: 'keep' | 'mute' | undefined,
  localSeconds: number,
  clipLength: number,
): number {
  if (item.kind === 'image' || previewMuted || item.muted === true || audio === 'mute') return 0
  const itemVolume = item.volume ?? 1
  if (itemVolume <= 0) return 0
  return clampUnit(itemVolume * (outputVolume ?? 1) * fadeGain(item, clipLength, localSeconds))
}

function fadeGain(item: MediaMergeItem, clipLength: number, localSeconds: number): number {
  const fadeIn = Math.max(0, item.audioFadeInSeconds ?? 0)
  const fadeOut = Math.max(0, item.audioFadeOutSeconds ?? 0)
  const length = Math.max(clipLength, 0.1)
  let gain = 1
  if (fadeIn > 0) gain *= clampUnit(localSeconds / fadeIn)
  if (fadeOut > 0) gain *= clampUnit((length - localSeconds) / fadeOut)
  return gain
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function imageMotionStyle(
  motion: MediaMergeItem['imageMotion'],
  progress: number,
  dwellSeconds: number,
): { opacity: number; transform: string } {
  const ratio = clampUnit(progress)
  if (motion === 'fade') {
    const fade = Math.min(0.6, Math.max(0.1, dwellSeconds / 5))
    const span = dwellSeconds > 0 ? Math.min(0.5, fade / dwellSeconds) : 1
    const opacity = ratio < span ? ratio / span : ratio > 1 - span ? (1 - ratio) / span : 1
    return { opacity: clampUnit(opacity), transform: 'scale(1)' }
  }
  if (motion === 'zoom-in') return { opacity: 1, transform: `scale(${(1 + 0.18 * ratio).toFixed(4)})` }
  if (motion === 'zoom-out') return { opacity: 1, transform: `scale(${(1.18 - 0.18 * ratio).toFixed(4)})` }
  if (motion === 'pan-left') {
    return { opacity: 1, transform: `scale(1.18) translateX(${(-8 + 16 * ratio).toFixed(2)}%)` }
  }
  if (motion === 'pan-right') {
    return { opacity: 1, transform: `scale(1.18) translateX(${(8 - 16 * ratio).toFixed(2)}%)` }
  }
  return { opacity: 1, transform: 'scale(1)' }
}

export function retainKnown<T>(current: Map<string, T>, keys: ReadonlySet<string>): Map<string, T> {
  let changed = false
  const next = new Map<string, T>()
  for (const [key, value] of current) {
    if (!keys.has(key)) {
      changed = true
      continue
    }
    next.set(key, value)
  }
  return changed ? next : current
}

export function retainKnownSet(current: Set<string>, keys: ReadonlySet<string>): Set<string> {
  let changed = false
  const next = new Set<string>()
  for (const key of current) {
    if (!keys.has(key)) {
      changed = true
      continue
    }
    next.add(key)
  }
  return changed ? next : current
}

export function putKnown<T>(current: Map<string, T>, key: string, value: T): Map<string, T> {
  if (current.get(key) === value) return current
  const next = new Map(current)
  next.set(key, value)
  return next
}

export function toggleKnown(current: Set<string>, key: string, present: boolean): Set<string> {
  if (current.has(key) === present) return current
  const next = new Set(current)
  if (present) next.add(key)
  else next.delete(key)
  return next
}

export function assignVideoSource(video: HTMLVideoElement, src: string): boolean {
  if (!src || video.getAttribute('src') === src) return false
  video.src = src
  return true
}

export function applySegmentVolume(
  video: HTMLVideoElement | null,
  segment: SequenceSegment | null,
  muted: boolean,
  outputVolume: number,
  outputAudio: 'keep' | 'mute' | undefined,
  timelineTime: number,
  rate: number,
): void {
  if (!video) return
  video.playbackRate = nativePlaybackRate(rate)
  if (!segment || segment.item.kind !== 'video') return
  const local = Math.max(0, timelineTime - segment.timelineStart)
  const volume = effectivePreviewVolume(segment.item, outputVolume, muted, outputAudio, local, segment.length)
  video.muted = volume <= 0
  video.volume = volume
}

export function crossfadeOpacity(input: {
  active: SequenceSegment
  segments: readonly SequenceSegment[]
  local: number
  overlap: number
  scope: PlaybackScope
  failed: ReadonlySet<string>
}): { next: SequenceSegment | null; opacity: number } {
  const index = input.segments.findIndex((segment) => segment.item.id === input.active.item.id)
  const next = nextPlayableSegment(input.segments, index, 1, input.failed) ?? null
  const remaining = input.active.sourceEnd - input.local
  if (input.scope !== 'sequence' || input.overlap <= 0 || next?.item.kind !== 'video' || remaining > input.overlap || remaining <= 0) {
    return { next: null, opacity: 0 }
  }
  return { next, opacity: 1 - remaining / input.overlap }
}

export function fastScrubTime(current: number, sourceEnd: number, rate: number, elapsedMs: number): number | null {
  if (rate <= NATIVE_PLAYBACK_RATE_LIMIT || elapsedMs < 80) return null
  const next = Math.min(sourceEnd - 0.05, current + (rate - NATIVE_PLAYBACK_RATE_LIMIT) * 0.08)
  return next > current + 0.02 ? next : null
}

export function previewStatusText(count: number, known: number, failedCount: number, preparingCount: number, totalLabel: string): string {
  if (count === 0) return "没有可预览的视频"
  const notes = [known < count ? "预览已就绪，时长将在播放时校准" : `输出 ${totalLabel}`]
  if (preparingCount > 0) notes.push(`${preparingCount} 个片段正在转预览`)
  if (failedCount > 0) notes.unshift(`${failedCount} 个片段无法预览`)
  return notes.join(" · ")
}

export function recordClipRead(current: {
  sources: Map<string, string>
  durations: Map<string, number>
  unreadable: Set<string>
  failed: Set<string>
  preparing: Set<string>
}, result: ClipReadResult): {
  sources: Map<string, string>
  durations: Map<string, number>
  unreadable: Set<string>
  failed: Set<string>
  preparing: Set<string>
} {
  if (result.status === "preparing") {
    return {
      sources: result.src ? putKnown(current.sources, result.path, result.src) : current.sources,
      durations: result.duration > 0 ? putKnown(current.durations, result.path, result.duration) : current.durations,
      unreadable: result.duration > 0 ? toggleKnown(current.unreadable, result.path, false) : current.unreadable,
      failed: toggleKnown(current.failed, result.path, false),
      preparing: toggleKnown(current.preparing, result.path, true),
    }
  }
  const preparing = toggleKnown(current.preparing, result.path, false)
  if (result.status === 'failed') {
    return {
      sources: current.sources,
      durations: current.durations,
      unreadable: toggleKnown(current.unreadable, result.path, true),
      failed: toggleKnown(current.failed, result.path, true),
      preparing,
    }
  }
  const sources = result.src ? putKnown(current.sources, result.path, result.src) : current.sources
  if (result.duration > 0) {
    return {
      sources,
      durations: putKnown(current.durations, result.path, result.duration),
      unreadable: toggleKnown(current.unreadable, result.path, false),
      failed: toggleKnown(current.failed, result.path, false),
      preparing,
    }
  }
  return { sources, durations: current.durations, unreadable: toggleKnown(current.unreadable, result.path, true), failed: current.failed, preparing }
}

export async function pollPreviewProxy(
  fallback: string,
  requestProxy: () => Promise<PreviewProxyResult | null>,
  cancelled: () => boolean,
  wait: (ms: number) => Promise<void>,
): Promise<{ src: string; status: "ready" | "failed"; error?: string }> {
  while (!cancelled()) {
    const proxy = await requestProxy()
    if (!proxy) return { src: fallback, status: "ready" }
    if (proxy.status === "ready") return { src: proxy.src || fallback, status: "ready" }
    if (proxy.status === "failed") return { src: "", status: "failed", error: proxy.error ?? undefined }
    await wait(800)
  }
  return { src: "", status: "failed" }
}

export function clipSource(sources: ReadonlyMap<string, string>, item: MediaMergeItem): string {
  const known = sources.get(item.path)
  if (known) return known
  if (item.kind === 'image' || !needsPreviewProxy(item.path)) return mediaFileUrl(item.path)
  return ''
}

export async function readClipSource(
  item: MediaMergeItem,
  selectedPaths: string[],
  cancelled: () => boolean,
  _onPreparing: () => void,
  readDuration?: (path: string, selectedPaths: string[]) => Promise<number>,
): Promise<ClipReadResult> {
  if (item.kind === "image") {
    return { id: item.id, path: item.path, src: mediaFileUrl(item.path), duration: imageDwellSeconds(item), status: "ready" }
  }
  if (cancelled()) return { id: item.id, path: item.path, src: "", duration: 0, status: "failed" }
  let duration = 0
  if (readDuration) {
    try {
      duration = await readDuration(item.path, selectedPaths)
    } catch {
      duration = 0
    }
  }
  if (cancelled()) return { id: item.id, path: item.path, src: "", duration: 0, status: "failed" }
  if (needsPreviewProxy(item.path)) {
    return { id: item.id, path: item.path, src: "", duration, status: "preparing" }
  }
  const src = mediaFileUrl(item.path)
  const resolvedDuration = duration > 0 ? duration : await readBrowserMediaDuration(src, cancelled)
  return { id: item.id, path: item.path, src, duration: resolvedDuration, status: "ready" }
}

function readBrowserMediaDuration(src: string, cancelled: () => boolean): Promise<number> {
  return new Promise((resolve) => {
    if (cancelled()) {
      resolve(0)
      return
    }
    const video = document.createElement('video')
    let settled = false
    const finish = (duration: number) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      video.removeAttribute('src')
      video.load()
      resolve(duration)
    }
    const timeout = window.setTimeout(() => finish(0), 8_000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = video.duration
      finish(Number.isFinite(duration) && duration > 0 ? duration : 0)
    }
    video.onerror = () => finish(0)
    video.src = src
    video.load()
  })
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
  let cursor = 0
  const lane = async () => {
    while (!cancelled()) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (!item) return
      const result = await worker(item)
      if (!cancelled()) onResult(result)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()))
}
