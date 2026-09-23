import type { MediaMergeItem, MediaMergeVideoSettings } from '@nestify/shared'
import { probeVideo, type FfmpegProbeResult } from './ffmpeg.ts'

export interface VideoProcessingSnapshot {
  percent: number
  current: number
}

export function processingSnapshot(
  completedWork: number,
  totalWork: number,
  current: number,
): VideoProcessingSnapshot {
  const ratio = totalWork > 0
    ? Math.min(1, Math.max(0, completedWork / totalWork))
    : 0
  return {
    percent: 25 + Math.round(ratio * 70),
    current: Math.max(0, Math.round(current)),
  }
}

export function segmentRenderSettings(
  settings: MediaMergeVideoSettings,
): MediaMergeVideoSettings {
  return {
    ...settings,
    format: 'mp4',
    transition: { type: 'none', durationSeconds: 0 },
    outputVolume: 1,
    loudnessNormalize: false,
  }
}

export async function probeRenderedSegments(
  paths: readonly string[],
  options: { ffprobePath: string; signal?: AbortSignal; concurrency?: number },
): Promise<FfmpegProbeResult[]> {
  const results = new Array<FfmpegProbeResult>(paths.length)
  const concurrency = Math.max(1, Math.min(4, Math.trunc(options.concurrency ?? 4), paths.length))
  let nextIndex = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < paths.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await probeVideo(paths[index]!, {
        ffprobePath: options.ffprobePath,
        signal: options.signal,
      })
    }
  })
  await Promise.all(workers)
  return results
}

export function renderedSegmentMatchesExpectedDuration(
  probe: FfmpegProbeResult,
  expectedDuration: number,
): boolean {
  if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) return false
  const frameTolerance = 2 / Math.max(1, probe.fps)
  return Math.abs(probe.durationSeconds - expectedDuration) <= Math.max(0.12, frameTolerance)
}

export function renderedSegmentInputs(
  items: readonly MediaMergeItem[],
  segmentPaths: readonly string[],
  segmentDurations: readonly number[],
  segmentProbes: readonly FfmpegProbeResult[],
): { items: MediaMergeItem[]; probes: FfmpegProbeResult[] } {
  if (items.length !== segmentPaths.length
    || items.length !== segmentDurations.length
    || items.length !== segmentProbes.length) {
    throw new Error('中间视频片段信息数量不一致')
  }

  return {
    items: items.map((item, index) => ({
      id: item.id,
      path: segmentPaths[index]!,
      kind: 'video',
      size: item.size,
      mtime: item.mtime,
      trimStart: 0,
      trimEndOffset: null,
      trimSource: item.trimSource,
      orderIndex: item.orderIndex,
      manualOrder: item.manualOrder,
      volume: 1,
      muted: !segmentProbes[index]!.hasAudio,
      audioFadeInSeconds: 0,
      audioFadeOutSeconds: 0,
      frameFit: 'contain',
      rotation: 'none',
      frameScalePercent: 100,
      frameFocusX: 50,
      frameFocusY: 50,
    })),
    probes: segmentProbes.map((probe) => {
      const hasAudio = probe.hasAudio
      return {
        ...probe,
        hasAudio,
        audioCodec: hasAudio ? probe.audioCodec : null,
        audioProfile: hasAudio ? probe.audioProfile : null,
        sampleRate: hasAudio ? probe.sampleRate : null,
        audioChannels: hasAudio ? probe.audioChannels : null,
      }
    }),
  }
}
