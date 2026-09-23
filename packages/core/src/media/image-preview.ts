import type { MediaMergeImageSettings } from '@nestify/shared'
import { MAX_IMAGE_CANVAS_PIXELS, MAX_IMAGE_DIMENSION, calculateImageLayout } from './layout.ts'

export const MAX_IMAGE_PREVIEW_SOURCE_BYTES = 8 * 1024 * 1024
export const IMAGE_PREVIEW_MAX_EDGE = 480

export interface ImagePreviewSource {
  width: number
  height: number
  tooLarge: boolean
}

export interface ScaledImagePreviewCell {
  left: number
  top: number
  width: number
  height: number
  tooLarge: boolean
}

export interface ScaledImagePreview {
  canvasWidth: number
  canvasHeight: number
  cells: ScaledImagePreviewCell[]
  limitReason: string | null
}

export function imageOutputLimitReason(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return `输出图片尺寸 ${Math.round(width)}x${Math.round(height)} 超过单边 ${MAX_IMAGE_DIMENSION}px 限制，请降低尺寸或分批合并`
  }
  if (width * height > MAX_IMAGE_CANVAS_PIXELS) {
    return `输出图片共 ${Math.round(width * height)} 像素，超过 1 亿像素安全限制，请降低尺寸或分批合并`
  }
  return null
}

export function scaleImagePreview(
  sources: ImagePreviewSource[],
  settings: MediaMergeImageSettings,
  maxEdge = IMAGE_PREVIEW_MAX_EDGE,
): ScaledImagePreview {
  const dimensions = sources.length > 0
    ? sources.map((source) => ({
      width: source.width > 0 ? source.width : 1,
      height: source.height > 0 ? source.height : 1,
    }))
    : [{ width: 1, height: 1 }]
  const layout = calculateImageLayout(dimensions, settings)
  const longest = Math.max(layout.canvasWidth, layout.canvasHeight, 1)
  const scale = Math.min(1, maxEdge / longest)
  return {
    canvasWidth: Math.max(1, Math.round(layout.canvasWidth * scale)),
    canvasHeight: Math.max(1, Math.round(layout.canvasHeight * scale)),
    cells: layout.placements.map((placement, index) => ({
      left: Math.round(placement.left * scale),
      top: Math.round(placement.top * scale),
      width: Math.max(1, Math.round(placement.width * scale)),
      height: Math.max(1, Math.round(placement.height * scale)),
      tooLarge: sources[index]?.tooLarge === true,
    })),
    limitReason: imageOutputLimitReason(layout.canvasWidth, layout.canvasHeight),
  }
}
