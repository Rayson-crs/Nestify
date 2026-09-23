import { extname } from 'node:path'
import type { MediaMergeImageMotion, MediaMergeItem } from '@nestify/shared'
import type { FfmpegProbeResult } from './ffmpeg.ts'

export const IMAGE_CLIP_DURATION_SECONDS = 3
export const IMAGE_CLIP_MIN_SECONDS = 0.1
export const IMAGE_CLIP_MAX_SECONDS = 120
export const IMAGE_MOTIONS = ['still', 'fade', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right'] as const

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.avif',
])

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase())
}

export function isImageClip(item: Pick<MediaMergeItem, 'kind' | 'path'>): boolean {
  return item.kind === 'image' || isImagePath(item.path)
}

export function clampImageDuration(value: number | undefined): number {
  const next = Number.isFinite(value) ? Number(value) : IMAGE_CLIP_DURATION_SECONDS
  const clamped = Math.min(IMAGE_CLIP_MAX_SECONDS, Math.max(IMAGE_CLIP_MIN_SECONDS, next))
  return Math.round(clamped * 100) / 100
}

export function normalizeImageMotion(value: string | undefined): MediaMergeImageMotion {
  return IMAGE_MOTIONS.includes(value as MediaMergeImageMotion) ? value as MediaMergeImageMotion : 'still'
}

export function normalizeImageClip(item: MediaMergeItem): MediaMergeItem {
  if (!isImageClip(item)) return item
  return {
    ...item,
    kind: 'image',
    trimStart: 0,
    trimEndOffset: null,
    imageDurationSeconds: clampImageDuration(item.imageDurationSeconds),
    imageMotion: normalizeImageMotion(item.imageMotion),
  }
}

export function imageClipProbe(width: number, height: number, duration = IMAGE_CLIP_DURATION_SECONDS): FfmpegProbeResult {
  return {
    durationSeconds: clampImageDuration(duration),
    width: Math.max(2, width),
    height: Math.max(2, height),
    fps: 30,
    hasAudio: false,
    videoCodec: 'image',
    audioCodec: null,
    videoProfile: null,
    audioProfile: null,
    pixelFormat: null,
    sampleRate: null,
    audioChannels: null,
    videoTimeBase: null,
  }
}

export function imageClipInputArgs(item: MediaMergeItem, duration: number, fps = 30): string[] {
  const frameRate = Math.min(60, Math.max(1, Math.round(fps)))
  return [
    '-loop', '1',
    '-framerate', String(frameRate),
    '-t', duration.toFixed(3),
    '-i', item.path,
  ]
}

export function imageMotionFilter(
  motion: MediaMergeImageMotion | undefined,
  duration: number,
  width: number,
  height: number,
  fps: number,
): string {
  const frames = Math.max(2, Math.round(Math.max(duration, 0.2) * fps))
  const zoomWidth = evenDimension(width * 1.18)
  const zoomHeight = evenDimension(height * 1.18)
  if (motion === 'zoom-in') {
    return `,zoompan=z='min(1.18,1+0.18*on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`
  }
  if (motion === 'zoom-out') {
    return `,zoompan=z='max(1,1.18-0.18*on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`
  }
  if (motion === 'pan-left' || motion === 'pan-right') {
    const direction = motion === 'pan-left'
      ? `'(iw-ow)*min(1,n/${frames})'`
      : `'(iw-ow)*(1-min(1,n/${frames}))'`
    return `,scale=${zoomWidth}:${zoomHeight}:force_original_aspect_ratio=increase,crop=${width}:${height}:${direction}:(ih-oh)/2`
  }
  if (motion === 'fade') {
    const fade = Math.min(0.6, Math.max(0.1, duration / 5))
    return `,fade=t=in:st=0:d=${fade.toFixed(2)},fade=t=out:st=${Math.max(0, duration - fade).toFixed(2)}:d=${fade.toFixed(2)}`
  }
  return ''
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}
