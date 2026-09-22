import sharp from 'sharp'
import type { MediaMergePlan } from '@nestify/shared'
import { findFfprobePath, probeVideo, type FfmpegProbeResult } from './ffmpeg.ts'
import { calculateImageLayout, validateImageLayout } from './layout.ts'
import {
  validateVideoMergeControls,
  videoMergeOutputDuration,
} from './video-command.ts'
import { imageClipProbe, isImageClip, normalizeImageClip } from './image-clip.ts'

const MAX_OUTPUT_HEIGHT = 32_767

export async function enrichMediaMergePlan(plan: MediaMergePlan): Promise<MediaMergePlan> {
  const warnings = [...plan.summary.warnings]
  if (plan.kind === 'image') {
    const settings = plan.image
    if (!settings) throw new Error('图片合并缺少输出设置')
    const dimensions: Array<{ width: number; height: number }> = []
    for (const item of plan.items) {
      const metadata = await sharp(item.path, { pages: 1 }).metadata()
      const oriented = orientedDimensions(metadata.width, metadata.height, metadata.orientation)
      if (!oriented.width || !oriented.height) throw new Error(`无法读取图片尺寸：${item.path}`)
      dimensions.push({ width: oriented.width, height: oriented.height })
    }
    const layout = calculateImageLayout(dimensions, settings)
    let dimensionWarning: string | null = null
    try {
      validateImageLayout(layout)
    } catch (error) {
      dimensionWarning = error instanceof Error ? error.message : String(error)
      warnings.push(dimensionWarning)
    }
    if (layout.settings.layout === 'vertical' && layout.canvasHeight > MAX_OUTPUT_HEIGHT && !dimensionWarning) {
      warnings.push(`输出图片高度 ${layout.canvasHeight}px 超过 ${MAX_OUTPUT_HEIGHT}px，部分软件可能无法打开，建议降低宽度或分批合并`)
    }
    return {
      ...plan,
      summary: {
        ...plan.summary,
        image: {
          width: layout.canvasWidth,
          height: layout.canvasHeight,
          layout: layout.settings.layout,
          columns: layout.settings.columns,
          gap: settings.gap,
        },
        warnings,
      },
    }
  }

  const ffprobePath = findFfprobePath()
  if (!ffprobePath) {
    return {
      ...plan,
      summary: {
        ...plan.summary,
        video: {
          originalDurationSeconds: 0,
          trimmedDurationSeconds: 0,
          customTrimCount: plan.items.filter((item) => item.trimSource === 'custom').length,
          batchTrimCount: plan.items.filter((item) => item.trimSource === 'batch').length,
        },
        warnings,
      },
    }
  }

  let originalDurationSeconds = 0
  let trimmedDurationSeconds = 0
  const probes: FfmpegProbeResult[] = []
  for (const item of plan.items) {
    const raw = await probeVideo(item.path, { ffprobePath })
    const normalized = normalizeImageClip(item)
    const probe = isImageClip(normalized)
      ? imageClipProbe(raw.width, raw.height, normalized.imageDurationSeconds)
      : raw
    probes.push(probe)
    originalDurationSeconds += probe.durationSeconds
    trimmedDurationSeconds += probe.durationSeconds - (item.trimEndOffset ?? 0) - item.trimStart
  }
  const settings = plan.video
  if (settings) {
    validateVideoMergeControls(plan.items, probes, settings)
    if (
      settings.audio === 'keep'
      && (settings.outputVolume ?? 1) > 0
      && plan.items.some((item) => item.muted !== true && (item.volume ?? 1) > 0)
      && probes.some((probe) => !probe.hasAudio)
    ) {
      warnings.push('部分视频没有音频轨，输出会自动补充静音')
    }
  }
  return {
    ...plan,
    summary: {
      ...plan.summary,
      video: {
        originalDurationSeconds,
        trimmedDurationSeconds,
        outputDurationSeconds: settings
          ? videoMergeOutputDuration(plan.items, probes, settings)
          : undefined,
        customTrimCount: plan.items.filter((item) => item.trimSource === 'custom').length,
        batchTrimCount: plan.items.filter((item) => item.trimSource === 'batch').length,
      },
      warnings,
    },
  }
}

function orientedDimensions(
  width: number | undefined,
  height: number | undefined,
  orientation: number | undefined,
): { width: number; height: number } {
  if (!width || !height) return { width: 0, height: 0 }
  return orientation != null && orientation >= 5
    ? { width: height, height: width }
    : { width, height }
}
