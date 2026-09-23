import { applyMediaMergeOrder } from '@nestify/media-order'
import type { MediaMergeItem, MediaMergeKind, MediaMergeOrderProfile, MediaMergeOrderRule, MediaMergeSelectedFile } from '@/lib/ipc'

export function clampNumber(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum
}

export function parentDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return index > 0 ? path.slice(0, index) : ''
}

export function replaceExtension(name: string, extension: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? `${name.slice(0, index)}${extension}` : `${name}${extension}`
}

export function mediaMergeKind(items: readonly Pick<MediaMergeItem, 'kind'>[]): MediaMergeKind | null {
  if (items.some((item) => item.kind === 'video')) return 'video'
  if (items.some((item) => item.kind === 'image')) return 'image'
  return null
}

export function defaultMediaMergeOutputName(kind: MediaMergeKind): string {
  return kind === 'image' ? 'nestify-merge.jpg' : 'nestify-merge.mp4'
}

export function samePathKey(path: string): string {
  return path.replaceAll('\\', '/').toLowerCase()
}

export function createMediaMergeItem(
  file: MediaMergeSelectedFile,
  batchTrimStart: number,
  batchTrimEnd: number | null,
): MediaMergeItem {
  const isImage = file.kind === 'image'
  return {
    id: file.path,
    path: file.path,
    kind: file.kind,
    size: file.size,
    mtime: file.mtime,
    trimStart: isImage ? 0 : batchTrimStart,
    trimEndOffset: isImage ? null : batchTrimEnd,
    trimSource: 'batch',
    orderIndex: 0,
    manualOrder: false,
    volume: 1,
    muted: false,
    audioFadeInSeconds: 0,
    audioFadeOutSeconds: 0,
    ...(isImage ? { imageDurationSeconds: 3, imageMotion: 'still' as const } : {}),
  }
}

export function applyLocalOrder(
  items: MediaMergeItem[],
  rule: MediaMergeOrderRule,
  profile?: MediaMergeOrderProfile,
): MediaMergeItem[] {
  return applyMediaMergeOrder(items, rule, profile)
}
