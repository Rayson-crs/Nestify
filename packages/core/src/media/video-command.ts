import { normalize } from 'node:path'
import type { MediaMergePlan } from '@nestify/shared'
import { streamCopyMergeReason, type FfmpegProbeResult } from './ffmpeg.ts'
import { imageClipInputArgs, imageMotionFilter, isImageClip, normalizeImageClip } from './image-clip.ts'
import {
  buildChapterMetadata,
  loudnessFilter,
  resolveVideoMergeFrame,
  supportsChapterMetadata,
} from './video-output.ts'

type MediaMergeItem = MediaMergePlan['items'][number]
type VideoMergeSettings = NonNullable<MediaMergePlan['video']>

export const VIDEO_CHAPTER_METADATA_PLACEHOLDER = '{chapterMetadata}'

export interface VideoMergeCommand {
  args: string[]
  totalDuration: number
  chapterMetadata: string | null
}

export function buildVideoMergeCommand(
  items: MediaMergeItem[],
  probes: FfmpegProbeResult[],
  outputPath: string,
  settings: VideoMergeSettings,
  options: { chapters?: boolean } = {},
): VideoMergeCommand {
  if (items.length !== probes.length) throw new Error('视频输入与探测结果数量不匹配')
  const normalizedItems = items.map((item) => normalizeImageClip(item))
  const frameProbes = probes.map((probe, index) => rotatedFrameProbe(normalizedItems[index]!, probe))
  const { width, height, fps } = resolveVideoMergeFrame(frameProbes, settings)
  const durations = normalizedItems.map((item, index) => clipDuration(item, probes[index]!))
  const effectiveProbes = probes.map((probe, index) => isImageClip(normalizedItems[index]!)
    ? { ...probe, durationSeconds: durations[index]!, hasAudio: false }
    : probe)
  validateVideoMergeControls(normalizedItems, effectiveProbes, settings)
  const useCrossfadeTransition = useCrossfade(settings, items.length)
  const crossfade = useCrossfadeTransition
    ? settings.transition?.durationSeconds ?? 0
    : false
  const mediaInputArgs: string[] = []
  const silentInputArgs: string[] = []
  const filters: string[] = []
  const outputVolume = settings.outputVolume ?? 1
  const hasAudibleOutput = settings.audio === 'keep'
    && outputVolume > 0
    && normalizedItems.some((item, index) => (
      probes[index]!.hasAudio
      && isAudible(item)
      && !isImageClip(item)
    ))
  let silentInputCount = 0

  for (const [index, item] of normalizedItems.entries()) {
    const probe = probes[index]!
    const duration = durations[index]!
    const frameFit = item.frameFit ?? 'contain'
    mediaInputArgs.push(...(isImageClip(item)
      ? imageClipInputArgs(item, duration, fps)
      : ['-ss', item.trimStart.toFixed(3), '-t', duration.toFixed(3), '-i', item.path]))
    filters.push(
      `[${index}:v]${frameOrientationFilter(item, probe)}`
        + `${frameScaleFilter(item, frameFit, width, height)},fps=${fps}`
        + imageMotionFilter(item.imageMotion, duration, width, height, fps)
        + `,setsar=1,format=yuv420p[v${index}]`,
    )

    if (hasAudibleOutput) {
      const useOriginalAudio = probe.hasAudio && isAudible(item) && !isImageClip(item)
      let sourceLabel: string
      if (useOriginalAudio) {
        sourceLabel = `[${index}:a]`
      } else {
        const inputIndex = items.length + silentInputCount
        silentInputArgs.push(
          '-f', 'lavfi', '-t', durations[index]!.toFixed(3), '-i',
          'anullsrc=r=48000:cl=stereo',
        )
        sourceLabel = `[${inputIndex}:a]`
        silentInputCount += 1
      }
      filters.push(`${sourceLabel}${audioFilter(item, durations[index]!)}[a${index}]`)
    }
  }

  appendVideoCombineFilter(filters, durations, crossfade)
  if (hasAudibleOutput) appendAudioCombineFilter(
    filters,
    items.map((item) => isAudible(item)),
    crossfade,
    outputVolume,
    loudnessFilter(settings, hasAudibleOutput),
  )
  const chapterMetadata = supportsChapterMetadata(settings)
    && options.chapters !== false
    ? buildChapterMetadata(normalizedItems, durations, crossfade === false ? 0 : crossfade)
    : null

  const args = [
    ...mediaInputArgs,
    ...silentInputArgs,
    ...(chapterMetadata ? ['-i', VIDEO_CHAPTER_METADATA_PLACEHOLDER] : []),
    '-filter_complex', filters.join(';'),
    '-map', '[outv]',
    ...(hasAudibleOutput ? ['-map', '[outa]'] : []),
    ...(chapterMetadata ? ['-map_chapters', String(items.length + silentInputCount)] : []),
    ...videoEncoderArgs(settings),
    ...(hasAudibleOutput ? audioEncoderArgs(settings) : ['-an']),
    ...containerArgs(settings),
    '-progress', 'pipe:1',
    '-nostats',
    outputPath,
  ]
  return {
    args,
    totalDuration: videoMergeOutputDuration(items, probes, settings),
    chapterMetadata,
  }
}

export function validateVideoMergeControls(
  items: readonly MediaMergeItem[],
  probes: readonly FfmpegProbeResult[],
  settings: VideoMergeSettings,
): void {
  if (items.length !== probes.length) throw new Error('视频输入与探测结果数量不匹配')
  const transitionDuration = useCrossfade(settings, items.length)
    ? settings.transition?.durationSeconds ?? 0
    : 0
  for (let index = 1; index < items.length; index += 1) {
    const left = trimmedDuration(items[index - 1]!, probes[index - 1]!)
    const right = trimmedDuration(items[index]!, probes[index]!)
    if (transitionDuration > Math.min(left, right)) {
      throw new Error(`转场时长不能超过相邻两个裁剪后片段中较短的那个：${items[index]!.path}`)
    }
  }
  for (const [index, item] of items.entries()) {
    const duration = trimmedDuration(item, probes[index]!)
    const fadeIn = item.audioFadeInSeconds ?? 0
    const fadeOut = item.audioFadeOutSeconds ?? 0
    if (!audioControlsUsed(item, settings)) continue
    if (fadeIn + fadeOut > duration) {
      throw new Error(`音频淡入和淡出总时长不能超过裁剪后时长：${item.path}`)
    }
  }
}

export function videoMergeOutputDuration(
  items: readonly MediaMergeItem[],
  probes: readonly FfmpegProbeResult[],
  settings: VideoMergeSettings,
): number {
  const total = items.reduce(
    (sum, item, index) => sum + trimmedDuration(item, probes[index]!),
    0,
  )
  const overlap = useCrossfade(settings, items.length)
    ? (items.length - 1) * (settings.transition?.durationSeconds ?? 0)
    : 0
  return Math.max(0, total - overlap)
}

export function streamCopyControlsReason(
  items: MediaMergeItem[],
  settings: VideoMergeSettings,
): string | null {
  if (items.length < 2) return '单个素材请使用重新编码'
  if ((settings.format ?? 'mp4') !== 'mp4') return '快速流复制只支持 MP4 输出，其他格式请使用重新编码'
  if (items.some((item) => isImageClip(item))) return '包含图片时必须重新编码'
  if (settings.audio !== 'keep') return '快速流复制仅支持保留原音频，静音输出请使用重新编码'
  if ((settings.outputVolume ?? 1) !== 1) return '快速流复制不能调整输出音量'
  if (settings.loudnessNormalize === true) return '快速流复制不支持响度归一，请使用重新编码'
  const transition = settings.transition
  if (transition?.type === 'crossfade' && (transition.durationSeconds ?? 0) > 0) {
    return '快速流复制不支持转场'
  }
  if (items.some((item) =>
    (item.volume ?? 1) !== 1
    || item.muted === true
    || (item.audioFadeInSeconds ?? 0) > 0
    || (item.audioFadeOutSeconds ?? 0) > 0,
  )) {
    return '快速流复制不支持单个素材的音量、静音或淡入淡出'
  }
  if (settings.canvasWidth != null || settings.canvasHeight != null) return '固定分辨率必须重新编码'
  if (items.some((item) => item.rotation != null && item.rotation !== 'none')) return '单个素材的画面旋转必须重新编码'
  if (items.some((item) => item.frameFit != null)) return '单个素材的画面填充必须重新编码'
  if (items.some((item) => (item.frameScalePercent ?? 100) !== 100)) return '单个素材的画面大小必须重新编码'
  if (items.some((item) => (item.frameFocusX ?? 50) !== 50 || (item.frameFocusY ?? 50) !== 50)) {
    return '单个素材的画面焦点必须重新编码'
  }
  if (items.some((item) => item.imageMotion != null && item.imageMotion !== 'still')) {
    return '单个素材的画面动效必须重新编码'
  }
  return null
}

export interface StreamCopyMergeCommand {
  args: string[]
  totalDuration: number
  concatContent: string
}

export function buildStreamCopyMergeCommand(
  items: MediaMergeItem[],
  probes: FfmpegProbeResult[],
  outputPath: string,
  concatListPath: string,
): StreamCopyMergeCommand {
  const reason = streamCopyMergeReason(probes)
  if (reason) throw new Error(`无法使用快速流复制：${reason}`)
  const controlsReason = streamCopyControlsReason(items, {
    quality: 'standard',
    audio: 'keep',
    encodingMode: 'stream-copy',
    transition: { type: 'none', durationSeconds: 0 },
    outputVolume: 1,
  })
  if (controlsReason) throw new Error(`无法使用快速流复制：${controlsReason}`)
  const totalDuration = items.reduce((total, item, index) =>
    total + trimmedDuration(items[index]!, probes[index]!), 0)
  const hasAudio = probes.every((probe) => probe.hasAudio)
  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0'] : []),
    '-c', 'copy',
    '-fflags', '+genpts',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath,
  ]
  return {
    args,
    totalDuration,
    concatContent: buildConcatListContent(items, probes),
  }
}

export function videoMergeChapterMetadata(
  items: readonly MediaMergeItem[],
  probes: readonly FfmpegProbeResult[],
  settings: VideoMergeSettings,
): string | null {
  if (!supportsChapterMetadata(settings)) return null
  const durations = items.map((item, index) => trimmedDuration(item, probes[index]!))
  const crossfade = useCrossfade(settings, items.length)
    ? settings.transition?.durationSeconds ?? 0
    : 0
  return buildChapterMetadata(items, durations, crossfade)
}

export function buildConcatListContent(
  items: MediaMergeItem[],
  probes: FfmpegProbeResult[],
): string {
  return items.map((item, index) => {
    const duration = trimmedDuration(item, probes[index]!)
    return [
      `file '${escapeConcatPath(item.path)}'`,
      `inpoint ${item.trimStart.toFixed(3)}`,
      `duration ${duration.toFixed(3)}`,
    ].join('\n')
  }).join('\n')
}

function escapeConcatPath(path: string): string {
  return normalize(path).replaceAll('\\', '/').replaceAll("'", "'\\''")
}

export function trimmedDuration(
  item: MediaMergeItem,
  probe: FfmpegProbeResult,
): number {
  if (isImageClip(item)) return normalizeImageClip(item).imageDurationSeconds ?? probe.durationSeconds
  return (probe.durationSeconds - (item.trimEndOffset ?? 0)) - item.trimStart
}

function clipDuration(item: MediaMergeItem, probe: FfmpegProbeResult): number {
  return trimmedDuration(item, probe)
}

function frameOrientationFilter(item: MediaMergeItem, probe: FfmpegProbeResult): string {
  switch (item.rotation ?? 'none') {
    case 'clockwise-90': return 'transpose=clock,'
    case 'counterclockwise-90': return 'transpose=cclock,'
    case 'rotate-180': return 'hflip,vflip,'
    default: return ''
  }
}

function rotatedFrameProbe(item: MediaMergeItem, probe: FfmpegProbeResult): FfmpegProbeResult {
  if (item.rotation !== 'clockwise-90' && item.rotation !== 'counterclockwise-90') return probe
  return { ...probe, width: probe.height, height: probe.width }
}

function frameScaleFilter(
  item: MediaMergeItem,
  fit: 'contain' | 'cover',
  width: number,
  height: number,
): string {
  const scale = (item.frameScalePercent ?? 100) / 100
  const focusX = (item.frameFocusX ?? 50) / 100
  const focusY = (item.frameFocusY ?? 50) / 100
  const fitMode = fit === 'cover' ? 'increase' : 'decrease'
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=${fitMode}`,
    `scale='max(2,trunc(iw*${formatNumber(scale)}/2)*2)':'max(2,trunc(ih*${formatNumber(scale)}/2)*2)'`,
    `pad=w='max(iw,${width})':h='max(ih,${height})':x='(ow-iw)/2':y='(oh-ih)/2':color=black`,
    `crop=${width}:${height}:'(iw-ow)*${formatNumber(focusX)}':'(ih-oh)*${formatNumber(focusY)}'`,
  ].join(',')
}

function useCrossfade(settings: VideoMergeSettings, itemCount: number): boolean {
  return itemCount > 1
    && settings.transition?.type === 'crossfade'
    && (settings.transition.durationSeconds ?? 0) > 0
}

function audioControlsUsed(item: MediaMergeItem, settings: VideoMergeSettings): boolean {
  return settings.audio === 'keep'
    && (settings.outputVolume ?? 1) > 0
    && isAudible(item)
}

function isAudible(item: MediaMergeItem): boolean {
  return item.muted !== true && (item.volume ?? 1) > 0
}

function audioFilter(item: MediaMergeItem, duration: number): string {
  if (!isAudible(item)) return 'aformat=sample_fmts=fltp:channel_layouts=stereo'
  const fadeIn = item.audioFadeInSeconds ?? 0
  const fadeOut = item.audioFadeOutSeconds ?? 0
  const fadeOutStart = Math.max(0, duration - fadeOut)
  return [
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `volume=${formatNumber(item.volume ?? 1)}`,
    ...(fadeIn > 0 ? [`afade=t=in:st=0:d=${formatNumber(fadeIn)}`] : []),
    ...(fadeOut > 0 ? [`afade=t=out:st=${formatNumber(fadeOutStart)}:d=${formatNumber(fadeOut)}`] : []),
  ].join(',')
}

function appendVideoCombineFilter(
  filters: string[],
  durations: readonly number[],
  crossfadeDuration: number | false,
): void {
  if (durations.length === 1) {
    filters.push('[v0]null[outv]')
    return
  }
  if (!crossfadeDuration) {
    const itemCount = durations.length
    filters.push(
      `${Array.from({ length: itemCount }, (_, index) => `[v${index}]`).join('')}`
        + `concat=n=${itemCount}:v=1:a=0[outv]`,
    )
    return
  }
  let outputDuration = durations[0] ?? 0
  for (let index = 1; index < durations.length; index += 1) {
    const previous = index === 1 ? 'v0' : `xv${index - 1}`
    const output = index === durations.length - 1 ? 'outv' : `xv${index}`
    const offset = Math.max(0, outputDuration - crossfadeDuration)
    filters.push(
      `[${previous}][v${index}]xfade=transition=fade`
        + `:duration=${formatNumber(crossfadeDuration)}:offset=${formatNumber(offset)}`
        + `[${output}]`,
    )
    outputDuration += durations[index]! - crossfadeDuration
  }
}

function appendAudioCombineFilter(
  filters: string[],
  audibleItems: boolean[],
  crossfadeDuration: number | false,
  outputVolume: number,
  loudness: string | null,
): void {
  let finalLabel: string
  if (audibleItems.length === 1) {
    finalLabel = 'single-audio'
    filters.push(`[a0]anull[${finalLabel}]`)
  } else if (!crossfadeDuration) {
    finalLabel = 'concat-audio'
    filters.push(
      `${audibleItems.map((_, index) => `[a${index}]`).join('')}`
        + `concat=n=${audibleItems.length}:v=0:a=1[${finalLabel}]`,
    )
  } else {
    for (let index = 1; index < audibleItems.length; index += 1) {
      const previous = index === 1 ? 'a0' : `xa${index - 1}`
      const output = index === audibleItems.length - 1 ? 'pre-output-audio' : `xa${index}`
      filters.push(
        `[${previous}][a${index}]acrossfade=d=${formatNumber(crossfadeDuration)}:c1=tri:c2=tri[${output}]`,
      )
    }
    finalLabel = 'pre-output-audio'
  }
  const tail = [
    ...(loudness ? [loudness] : []),
    ...(outputVolume !== 1 ? [`volume=${formatNumber(outputVolume)}`] : []),
  ]
  filters.push(tail.length > 0
    ? `[${finalLabel}]${tail.join(',')}[outa]`
    : `[${finalLabel}]anull[outa]`)
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function videoEncoderArgs(settings: VideoMergeSettings): string[] {
  const format = settings.format ?? 'mp4'
  if (format === 'webm') {
    return [
      '-c:v', 'libvpx-vp9',
      '-deadline', 'realtime',
      '-cpu-used', settings.quality === 'high' ? '2' : '5',
      '-b:v', '0',
      '-crf', settings.quality === 'high' ? '28' : '34',
      '-pix_fmt', 'yuv420p',
    ]
  }
  if (format === 'avi') {
    return [
      '-c:v', 'mpeg4',
      '-q:v', settings.quality === 'high' ? '3' : '5',
      '-pix_fmt', 'yuv420p',
    ]
  }
  return [
    '-c:v', 'libx264',
    '-preset', settings.quality === 'high' ? 'medium' : 'veryfast',
    '-crf', settings.quality === 'high' ? '18' : '23',
    '-pix_fmt', 'yuv420p',
  ]
}

function audioEncoderArgs(settings: VideoMergeSettings): string[] {
  const format = settings.format ?? 'mp4'
  if (format === 'webm') return ['-c:a', 'libopus', '-b:a', '128k']
  if (format === 'avi') return ['-c:a', 'libmp3lame', '-b:a', '192k']
  return ['-c:a', 'aac', '-b:a', '128k']
}

function containerArgs(settings: VideoMergeSettings): string[] {
  const format = settings.format ?? 'mp4'
  if (format === 'mp4' || format === 'mov') return ['-movflags', '+faststart']
  if (format === 'ts') return ['-f', 'mpegts']
  return []
}
