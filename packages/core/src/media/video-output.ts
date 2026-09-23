import { basename, extname } from 'node:path'
import type { MediaMergePlan } from '@nestify/shared'
import type { FfmpegProbeResult } from './ffmpeg.ts'

type MediaMergeItem = MediaMergePlan['items'][number]
type VideoMergeSettings = NonNullable<MediaMergePlan['video']>

const CHAPTER_TIMEBASE = 1000
const FULL_HD_LONG_EDGE = 1920
const FULL_HD_SHORT_EDGE = 1080
const MIN_CANVAS_EDGE = 16
const MAX_CANVAS_EDGE = 7680

export interface VideoMergeFrame {
  width: number
  height: number
  fps: number
}

export function resolveCanvasSize(settings: VideoMergeSettings): { width: number; height: number } | null {
  const width = settings.canvasWidth
  const height = settings.canvasHeight
  if (width == null && height == null) return null
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('固定分辨率需要同时填写宽度和高度')
  }
  if (width! < MIN_CANVAS_EDGE || height! < MIN_CANVAS_EDGE || width! > MAX_CANVAS_EDGE || height! > MAX_CANVAS_EDGE) {
    throw new Error(`固定分辨率每边必须在 ${MIN_CANVAS_EDGE} 到 ${MAX_CANVAS_EDGE} 之间`)
  }
  return { width: evenNumber(width!), height: evenNumber(height!) }
}

export function resolveVideoMergeFrame(
  probes: readonly FfmpegProbeResult[],
  settings: VideoMergeSettings,
): VideoMergeFrame {
  const fixed = resolveCanvasSize(settings)
  if (fixed) {
    return {
      ...fixed,
      fps: Math.min(60, Math.max(24, Math.round(Math.max(...probes.map((probe) => probe.fps))))),
    }
  }
  const oriented = probes.map((probe) => ({
    width: evenNumber(probe.width),
    height: evenNumber(probe.height),
  }))
  const fit = settings.fit ?? 'largest'
  const largest = {
    width: Math.max(...oriented.map((item) => item.width)),
    height: Math.max(...oriented.map((item) => item.height)),
  }
  const source = fit === 'first' ? oriented[0]! : largest
  // limit-1080p only scales down: each source is capped, then the canvas uses that smaller fit.
  const limited = fit === 'limit-1080p'
    ? boundedFrame(oriented.map((item) => limitTo1080p(item.width, item.height)))
    : source
  return {
    width: evenNumber(limited.width),
    height: evenNumber(limited.height),
    fps: Math.min(60, Math.max(24, Math.round(Math.max(...probes.map((probe) => probe.fps))))),
  }
}

export function supportsChapterMetadata(settings: VideoMergeSettings): boolean {
  const format = settings.format ?? 'mp4'
  return format === 'mp4' || format === 'mov' || format === 'mkv'
}

export function buildChapterMetadata(
  items: readonly MediaMergeItem[],
  durations: readonly number[],
  crossfadeDuration: number,
): string {
  const boundaries = chapterBoundaries(durations, crossfadeDuration)
  const chapters = items.map((item, index) => {
    const start = Math.round(boundaries[index]! * CHAPTER_TIMEBASE)
    const end = Math.max(start + 1, Math.round(boundaries[index + 1]! * CHAPTER_TIMEBASE))
    return [
      '[CHAPTER]',
      `TIMEBASE=1/${CHAPTER_TIMEBASE}`,
      `START=${start}`,
      `END=${end}`,
      `title=${chapterTitle(item.path)}`,
    ].join('\n')
  })
  return `;FFMETADATA1\n${chapters.join('\n')}\n`
}

export function loudnessFilter(settings: VideoMergeSettings, audible: boolean): string | null {
  if (settings.loudnessNormalize !== true || settings.audio !== 'keep' || !audible) return null
  return 'loudnorm'
}

function limitTo1080p(width: number, height: number): { width: number; height: number } {
  const landscape = width >= height
  const longEdge = landscape ? width : height
  const shortEdge = landscape ? height : width
  const scale = Math.min(1, FULL_HD_LONG_EDGE / longEdge, FULL_HD_SHORT_EDGE / shortEdge)
  return landscape
    ? { width: longEdge * scale, height: shortEdge * scale }
    : { width: shortEdge * scale, height: longEdge * scale }
}

function boundedFrame(
  frames: readonly { width: number; height: number }[],
): { width: number; height: number } {
  return {
    width: Math.max(...frames.map((frame) => frame.width)),
    height: Math.max(...frames.map((frame) => frame.height)),
  }
}

function chapterBoundaries(durations: readonly number[], crossfadeDuration: number): number[] {
  const boundaries = [0]
  let cursor = 0
  for (let index = 0; index < durations.length; index += 1) {
    cursor += durations[index]!
    if (index < durations.length - 1) cursor -= crossfadeDuration
    boundaries.push(Math.max(boundaries[index]!, cursor))
  }
  return boundaries
}

function chapterTitle(path: string): string {
  const name = basename(path, extname(path))
  return name
    .replaceAll('\\', '\\\\')
    .replaceAll('=', '\\=')
    .replaceAll(';', '\\;')
    .replaceAll('#', '\\#')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
}

function evenNumber(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2)
}
