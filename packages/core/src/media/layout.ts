import type { MediaMergeImageSettings } from '@nestify/shared'

export const MAX_IMAGE_DIMENSION = 32_767
export const MAX_IMAGE_CANVAS_PIXELS = 100_000_000

export interface NormalizedImageSettings extends MediaMergeImageSettings {
  layout: 'vertical' | 'horizontal' | 'grid'
  height: number
  columns: number
}

export interface ImagePlacement {
  left: number
  top: number
  width: number
  height: number
}

export interface ImageLayout {
  settings: NormalizedImageSettings
  canvasWidth: number
  canvasHeight: number
  placements: ImagePlacement[]
}

export function normalizeImageSettings(settings: MediaMergeImageSettings): NormalizedImageSettings {
  return {
    ...settings,
    layout: settings.layout ?? 'vertical',
    width: roundedSetting(settings.width, 16, 8192, 1080),
    height: roundedSetting(settings.height ?? 1080, 16, 8192, 1080),
    columns: roundedSetting(settings.columns ?? 2, 1, 8, 2),
    gap: roundedSetting(settings.gap, 0, 128, 8),
  }
}

function roundedSetting(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function calculateImageLayout(
  dimensions: Array<{ width: number; height: number }>,
  inputSettings: MediaMergeImageSettings,
): ImageLayout {
  const settings = normalizeImageSettings(inputSettings)
  if (dimensions.length === 0) {
    return { settings, canvasWidth: 0, canvasHeight: 0, placements: [] }
  }

  if (settings.layout === 'horizontal') {
    const placements = dimensions.map((dimension) => ({
      width: Math.max(1, Math.round((dimension.width / dimension.height) * settings.height)),
      height: settings.height,
    }))
    const canvasWidth = placements.reduce((total, placement) => total + placement.width, 0)
      + settings.gap * (dimensions.length - 1)
    return {
      settings,
      canvasWidth,
      canvasHeight: settings.height,
      placements: placements.map((placement, index) => ({
        ...placement,
        left: placements.slice(0, index).reduce((total, item) => total + item.width + settings.gap, 0),
        top: 0,
      })),
    }
  }

  if (settings.layout === 'grid') {
    const columns = Math.min(settings.columns, dimensions.length)
    const cellWidth = Math.max(
      1,
      Math.floor((settings.width - settings.gap * (columns - 1)) / columns),
    )
    const scaled = dimensions.map((dimension) => ({
      width: cellWidth,
      height: Math.max(1, Math.round((dimension.height / dimension.width) * cellWidth)),
    }))
    const placements: ImagePlacement[] = []
    let top = 0
    for (let offset = 0; offset < scaled.length; offset += columns) {
      const row = scaled.slice(offset, offset + columns)
      const rowHeight = Math.max(...row.map((item) => item.height))
      row.forEach((item, column) => {
        placements.push({
          left: column * (cellWidth + settings.gap),
          top: top + Math.round((rowHeight - item.height) / 2),
          width: item.width,
          height: item.height,
        })
      })
      top += rowHeight + settings.gap
    }
    const canvasWidth = columns * cellWidth + settings.gap * (columns - 1)
    const canvasHeight = Math.max(0, top - settings.gap)
    return { settings, canvasWidth, canvasHeight, placements }
  }

  const placements = dimensions.map((dimension) => ({
    width: settings.width,
    height: Math.max(1, Math.round((dimension.height / dimension.width) * settings.width)),
  }))
  const canvasHeight = placements.reduce((total, placement) => total + placement.height, 0)
    + settings.gap * (dimensions.length - 1)
  return {
    settings,
    canvasWidth: settings.width,
    canvasHeight,
    placements: placements.map((placement, index) => ({
      ...placement,
      left: 0,
      top: placements.slice(0, index).reduce((total, item) => total + item.height + settings.gap, 0),
    })),
  }
}

export function validateImageLayout(layout: ImageLayout): void {
  if (layout.canvasWidth > MAX_IMAGE_DIMENSION || layout.canvasHeight > MAX_IMAGE_DIMENSION) {
    throw new Error(
      `输出图片尺寸 ${layout.canvasWidth}x${layout.canvasHeight} 超过单边 ${MAX_IMAGE_DIMENSION}px 限制，请降低尺寸或分批合并`,
    )
  }
  if (layout.canvasWidth * layout.canvasHeight > MAX_IMAGE_CANVAS_PIXELS) {
    throw new Error(
      `输出图片共 ${layout.canvasWidth * layout.canvasHeight} 像素，超过 1 亿像素安全限制，请降低尺寸或分批合并`,
    )
  }
}
