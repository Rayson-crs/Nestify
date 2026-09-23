import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  applySegmentVolume,
  assignVideoSource,
  clipSource,
  crossfadeOpacity,
  nextPlayableSegment,
  putKnown,
  type PlaybackScope,
  type SequenceSegment,
} from './video-sequence'

export function loadPrimaryVideo(
  video: HTMLVideoElement,
  segment: SequenceSegment,
  src: string,
  localTime: number,
  autoplay: boolean,
  pendingSeek: MutableRefObject<number | null>,
  resumeWhenReady: MutableRefObject<boolean>,
): boolean {
  video.dataset.path = segment.item.path
  pendingSeek.current = localTime
  resumeWhenReady.current = autoplay
  const swapped = assignVideoSource(video, src)
  if (swapped) video.load()
  return swapped
}

export function seekLoadedVideo(video: HTMLVideoElement, localTime: number): void {
  if (!Number.isFinite(localTime)) return
  const duration = video.duration
  video.currentTime = Number.isFinite(duration) && duration > 0
    ? Math.min(Math.max(0, localTime), Math.max(0, duration - 0.001))
    : Math.max(0, localTime)
}

export function requestVideoPlayback(video: HTMLVideoElement, onBlocked: () => void): void {
  void video.play().catch((error: unknown) => {
    if (isInterruptedPlayback(error)) return
    onBlocked()
  })
}

function isInterruptedPlayback(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false
  return error.name === 'AbortError'
}

export function rememberPathDuration(
  video: HTMLVideoElement,
  segment: SequenceSegment | null,
  setDurations: Dispatch<SetStateAction<Map<string, number>>>,
): void {
  const path = video.dataset.path || (segment?.item.kind === 'video' ? segment.item.path : undefined)
  if (!path || !Number.isFinite(video.duration) || video.duration <= 0) return
  setDurations((current) => putKnown(current, path, video.duration))
}

export function syncCrossfade(
  segments: readonly SequenceSegment[],
  active: SequenceSegment,
  local: number,
  overlap: number,
  sources: ReadonlyMap<string, string>,
  failed: ReadonlySet<string>,
  secondary: HTMLVideoElement | null,
  rate: number,
  muted: boolean,
  outputVolume: number,
  outputAudio: 'keep' | 'mute' | undefined,
  playing: boolean,
  scope: PlaybackScope,
  setFade: Dispatch<SetStateAction<number>>,
): void {
  const fade = crossfadeOpacity({ active, segments, local, overlap, scope, failed })
  setFade((current) => Math.abs(current - fade.opacity) < 0.01 ? current : fade.opacity)
  if (!fade.next || !secondary) return
  const src = clipSource(sources, fade.next.item)
  if (!src) return
  if (secondary.dataset.itemId !== fade.next.item.id) {
    secondary.dataset.itemId = fade.next.item.id
    secondary.dataset.path = fade.next.item.path
    assignVideoSource(secondary, src)
    seekLoadedVideo(secondary, fade.next.sourceStart)
    if (playing) requestVideoPlayback(secondary, () => undefined)
  }
  applySegmentVolume(secondary, fade.next, muted, outputVolume, outputAudio, fade.next.timelineStart, rate)
}

export function finishSegment(
  segment: SequenceSegment,
  segments: readonly SequenceSegment[],
  scope: PlaybackScope,
  failed: ReadonlySet<string>,
  seek: (time: number, autoplay?: boolean) => void,
  playing: MutableRefObject<boolean>,
  setPlaying: Dispatch<SetStateAction<boolean>>,
  setPlayhead: Dispatch<SetStateAction<number>>,
  setFade: Dispatch<SetStateAction<number>>,
  primary: HTMLVideoElement | null,
  secondary: HTMLVideoElement | null,
): void {
  if (scope === 'clip') {
    playing.current = false
    primary?.pause()
    secondary?.pause()
    setPlaying(false)
    setPlayhead(segment.timelineEnd)
    setFade(0)
    return
  }
  const index = segments.findIndex((entry) => entry.item.id === segment.item.id)
  const next = nextPlayableSegment(segments, index, 1, failed)
  if (!next) {
    playing.current = false
    primary?.pause()
    secondary?.pause()
    setPlaying(false)
    setPlayhead(segments.at(-1)?.timelineEnd ?? segment.timelineEnd)
    setFade(0)
    return
  }
  playing.current = true
  setPlaying(true)
  seek(next.timelineStart, true)
}

export function clearSecondary(video: HTMLVideoElement | null): void {
  if (!video) return
  video.pause()
  video.dataset.itemId = ''
}

export function previewAspectRatio(
  _segment: SequenceSegment | null,
  canvasWidth: number,
  canvasHeight: number,
): string {
  return `${canvasWidth} / ${canvasHeight}`
}

export function sourceTimeForSegment(segment: SequenceSegment, playhead: number): number {
  return Math.min(
    segment.sourceEnd,
    segment.sourceStart + Math.max(0, playhead - segment.timelineStart),
  )
}
