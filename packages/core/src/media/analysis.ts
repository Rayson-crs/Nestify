import sharp from 'sharp'
import type { MediaMergePlan } from '@nestify/shared'
import { findFfprobePath, probeVideo, streamCopyMergeReason, type FfmpegProbeResult } from './ffmpeg.ts'
import { calculateImageLayout, validateImageLayout } from './layout.ts'
import {
  streamCopyControlsReason,
  trimmedDuration,
  validateVideoMergeControls,
  videoMergeOutputDuration,
} from './video-command.ts'
import { resolveVideoMergeFrame } from './video-output.ts'
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
        estimatedOutputBytes: estimateImageOutputBytes(
          layout.canvasWidth,
          layout.canvasHeight,
          settings.format,
          plan.items.length,
        ),
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
  let estimatedTrimmedBytes = 0
  const probes: FfmpegProbeResult[] = []
  for (const item of plan.items) {
    const raw = await probeVideo(item.path, { ffprobePath })
    const normalized = normalizeImageClip(item)
    const probe = isImageClip(normalized)
      ? imageClipProbe(raw.width, raw.height, normalized.imageDurationSeconds)
      : raw
    probes.push(probe)
    originalDurationSeconds += probe.durationSeconds
    const effectiveDuration = trimmedDuration(normalized, probe)
    trimmedDurationSeconds += effectiveDuration
    if (!isImageClip(normalized) && probe.durationSeconds > 0) {
      estimatedTrimmedBytes += item.size * (effectiveDuration / probe.durationSeconds)
    }
  }
  const settings = plan.video
  const frame = settings ? resolveVideoMergeFrame(probes, settings) : null
  const requestedMode = settings?.encodingMode ?? 'auto'
  const compatibilityReason = streamCopyMergeReason(probes)
  const controlsReason = settings ? streamCopyControlsReason(plan.items, settings) : '视频合并缺少输出设置'
  const streamCopyReason = compatibilityReason ?? controlsReason
  const streamCopy = requestedMode === 'reencode'
    ? 'not-requested' as const
    : streamCopyReason
      ? 'unavailable' as const
      : 'available' as const
  const outputDurationSeconds = settings
    ? videoMergeOutputDuration(plan.items, probes, settings)
    : trimmedDurationSeconds
  const durationRatio = trimmedDurationSeconds > 0 ? outputDurationSeconds / trimmedDurationSeconds : 1
  const streamCopyBytes = estimatedTrimmedBytes * durationRatio
  const reencodedBytes = outputDurationSeconds * estimatedVideoBitsPerSecond(
    frame?.width ?? 1920,
    frame?.height ?? 1080,
    settings?.quality ?? 'standard',
  ) / 8
  const estimatedOutputBytes = Math.max(1, Math.round(
    streamCopy === 'available' && requestedMode !== 'reencode' ? streamCopyBytes : reencodedBytes,
  ))
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
        outputDurationSeconds,
        width: frame?.width,
        height: frame?.height,
        streamCopy,
        streamCopyReason: requestedMode === 'reencode' ? null : streamCopyReason,
        customTrimCount: plan.items.filter((item) => item.trimSource === 'custom').length,
        batchTrimCount: plan.items.filter((item) => item.trimSource === 'batch').length,
      },
      estimatedOutputBytes,
      warnings,
    },
  }
}

function estimateImageOutputBytes(
  width: number,
  height: number,
  format: NonNullable<MediaMergePlan['image']>['format'],
  itemCount: number,
): number {
  const frames = format === 'gif' ? itemCount : 1
  const bytesPerPixel = format === 'png' ? 1.5 : format === 'gif' ? 0.8 : format === 'webp' ? 0.35 : 0.4
  return Math.max(1, Math.round(width * height * frames * bytesPerPixel))
}

function estimatedVideoBitsPerSecond(
  width: number,
  height: number,
  quality: 'standard' | 'high',
): number {
  const pixels = Math.max(1, width * height)
  const bitsPerPixelPerSecond = quality === 'high' ? 0.12 : 0.075
  return Math.max(800_000, Math.min(30_000_000, pixels * 30 * bitsPerPixelPerSecond))
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
