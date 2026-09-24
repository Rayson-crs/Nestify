import { stat } from 'node:fs/promises'
import { isAbsolute, join, parse, sep } from 'node:path'
import sharp from 'sharp'
import type { MediaMergeItem, MediaMergePlan, MediaMergePlanInput, MediaMergeVideoFormat } from '@nestify/shared'
import { classifyKind } from '../fs/kind.ts'
import { isIllegalName } from '../plan/paths.ts'
import { applyMediaMergeOrder } from './order.ts'
import { findFfmpegPath } from './ffmpeg.ts'
import { calculateImageLayout, normalizeImageSettings } from './layout.ts'
import { isAnimatedImage, isImageClip, normalizeImageClip, normalizeImageMotion } from './image-clip.ts'
import { imageItemDimensions } from './image-frame.ts'
import { allocateOutputPath } from './execution-shared.ts'

const IMAGE_EXTENSIONS: Record<'jpg' | 'png' | 'webp' | 'gif', string> = {
  jpg: '.jpg',
  png: '.png',
  webp: '.webp',
  gif: '.gif',
}

const VIDEO_EXTENSIONS: Record<MediaMergeVideoFormat, string> = {
  mp4: '.mp4',
  mov: '.mov',
  mkv: '.mkv',
  webm: '.webm',
  avi: '.avi',
  ts: '.ts',
}

export async function buildMediaMergePlan(input: MediaMergePlanInput): Promise<MediaMergePlan> {
  const outputDirectory = input.outputDirectory.trim()
  const outputName = input.outputName.trim()
  if (!outputDirectory || !isAbsolute(outputDirectory)) throw new Error('输出目录必须是绝对路径')
  if (isIllegalName(outputName) || outputName.includes('/') || outputName.includes(sep)) {
    throw new Error('输出文件名不能为空，也不能包含路径分隔符或非法字符')
  }
  const directoryStat = await stat(outputDirectory)
  if (!directoryStat.isDirectory()) throw new Error('输出路径不是目录')

  if (input.items.length < 1) {
    throw new Error(input.kind === 'image' ? '图片合并至少需要一个图片文件' : '合并至少需要一个媒体文件')
  }
  const seen = new Set<string>()
  const checkedItems: MediaMergeItem[] = []
  for (const item of input.items) {
    if (!isAbsolute(item.path)) throw new Error(`输入路径必须是绝对路径：${item.path}`)
    const key = item.path.replaceAll('\\', '/').toLowerCase()
    if (seen.has(key)) throw new Error(`输入文件重复：${item.path}`)
    seen.add(key)
    const itemStat = await stat(item.path)
    if (!itemStat.isFile()) throw new Error(`输入不是普通文件：${item.path}`)
    const fileKind = classifyKind(item.path, false)
    if (input.kind === 'image' && fileKind !== 'image') {
      throw new Error(`图片合并不能加入视频：${item.path}`)
    }
    if (input.kind === 'video' && fileKind !== 'video' && !isImageClip(item) && !isAnimatedImage(item.path)) {
      throw new Error(`输入类型不是${labelForKind(input.kind)}：${item.path}`)
    }
    if (item.mtime != null && Math.abs(itemStat.mtimeMs - item.mtime) > 1) {
      throw new Error(`输入文件在生成计划前发生变化：${item.path}`)
    }
    checkedItems.push(normalizeImageClip({
      ...item,
      kind: isImageClip(item) ? 'image' : input.kind,
      size: itemStat.size,
      mtime: itemStat.mtimeMs,
    }))
  }

  const imageSettings = input.kind === 'image' && input.image
    ? normalizeImageSettings(input.image)
    : undefined
  const videoSettings = input.kind === 'video'
    ? normalizeVideoSettings(input.video)
    : undefined
  const items = applyMediaMergeOrder(checkedItems, input.orderRule, input.orderProfile).map((item) => ({
    ...item,
    ...normalizeItemAudio(item),
    ...normalizeItemFrame(item),
    ...(item.imageMotion == null ? {} : { imageMotion: normalizeImageMotion(item.imageMotion) }),
  }))
  if (input.kind === 'image') validateImageSettings(input)
  if (input.kind === 'video') {
    for (const item of items) {
      if (item.trimStart < 0 || (item.trimEndOffset != null && item.trimEndOffset < 0)) {
        throw new Error(`裁剪时间不能为负：${item.path}`)
      }
    }
  }

  const extension = input.kind === 'video'
    ? VIDEO_EXTENSIONS[videoSettings?.format ?? 'mp4']
    : IMAGE_EXTENSIONS[input.image?.format ?? 'jpg']
  const parsedName = parse(outputName)
  if (parsedName.ext.toLowerCase() && parsedName.ext.toLowerCase() !== extension) {
    throw new Error(`输出文件扩展名应该是 ${extension}`)
  }
  const preferredOutputName = `${parsedName.name}${extension}`
  const preferredOutputPath = join(outputDirectory, preferredOutputName)
  if (items.some((item) => samePath(item.path, preferredOutputPath))) {
    throw new Error('输出文件不能覆盖任何输入文件')
  }
  const outputPath = allocateOutputPath(preferredOutputPath)
  const normalizedOutputName = parse(outputPath).base

  const warnings: string[] = []
  let imageSummary: MediaMergePlan['summary']['image']
  if (imageSettings) {
    try {
      imageSummary = imageSettings.format === 'gif'
        ? buildGifSummary(items, imageSettings)
        : await buildImageSummary(items, imageSettings)
    } catch {
      imageSummary = undefined
      warnings.push('未能读取图片尺寸，执行摘要暂不显示输出尺寸；执行时会重新校验')
    }
  }
  if (input.kind === 'image') {
    warnings.push('执行前会重新读取图片尺寸；输出过大时将拒绝执行')
  } else if (!findFfmpegPath()) {
    warnings.push('未找到可用 FFmpeg，视频合并将在执行时失败')
  }

  return {
    version: 1,
    kind: input.kind,
    items,
    outputDirectory,
    outputName: normalizedOutputName,
    outputPath,
    image: imageSettings,
    video: videoSettings,
    summary: {
      itemCount: items.length,
      image: imageSummary,
      warnings,
    },
  }
}

async function buildImageSummary(
  items: MediaMergeItem[],
  settings: NonNullable<MediaMergePlan['image']>,
): Promise<NonNullable<MediaMergePlan['summary']['image']>> {
  const dimensions: Array<{ width: number; height: number }> = []
  for (const item of items) {
    const metadata = await sharp(item.path, { pages: 1 }).metadata()
    const { width, height } = imageItemDimensions(metadata, item.rotation)
    if (!width || !height) throw new Error(`无法读取图片尺寸：${item.path}`)
    dimensions.push({ width, height })
  }
  const layout = calculateImageLayout(dimensions, settings)
  return {
    width: layout.canvasWidth,
    height: layout.canvasHeight,
    layout: layout.settings.layout,
    columns: layout.settings.columns,
    gap: layout.settings.gap,
  }
}

export function samePath(a: string, b: string): boolean {
  return a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()
}

function validateImageSettings(input: MediaMergePlanInput): void {
  const settings = input.image
  if (!settings) throw new Error('图片合并缺少输出设置')
  const layout = settings.layout ?? 'vertical'
  const width = finiteOr(settings.width, Number.NaN)
  const gap = finiteOr(settings.gap, Number.NaN)
  const height = finiteOr(settings.height ?? 1080, Number.NaN)
  const columns = finiteOr(settings.columns ?? 2, Number.NaN)
  if (settings.format === 'gif') {
    const gifWidth = finiteOr(settings.gifWidth ?? 1080, Number.NaN)
    const gifHeight = finiteOr(settings.gifHeight ?? 1080, Number.NaN)
    const duration = finiteOr(settings.gifFrameDurationSeconds ?? 3, Number.NaN)
    const loopCount = finiteOr(settings.gifLoopCount ?? 0, Number.NaN)
    if (gifWidth < 16 || gifWidth > 8192 || gifHeight < 16 || gifHeight > 8192) {
      throw new Error('GIF 画布宽高必须在 16 到 8192 之间')
    }
    if (gifWidth * gifHeight * input.items.length > 100_000_000) {
      throw new Error('GIF 总帧像素超过 1 亿像素安全限制，请降低画布尺寸或减少图片数量')
    }
    if (duration < 0.1 || duration > 120) throw new Error('GIF 默认停留时间必须在 0.1 到 120 秒之间')
    if (loopCount < 0 || loopCount > 65535) throw new Error('GIF 循环次数必须在 0 到 65535 之间')
    settings.gifWidth = Math.round(gifWidth)
    settings.gifHeight = Math.round(gifHeight)
    settings.gifFrameDurationSeconds = Math.round(duration * 100) / 100
    settings.gifLoopCount = Math.round(loopCount)
    return
  }
  if (layout !== 'horizontal' && (width < 16 || width > 8192)) {
    throw new Error(`图片统一宽度必须在 16 到 8192 之间，当前值为 ${formatSetting(settings.width)}`)
  }
  if (gap < 0 || gap > 128) {
    throw new Error(`图片间距必须在 0 到 128 之间，当前值为 ${formatSetting(settings.gap)}`)
  }
  if (settings.format === 'jpg' && settings.background === 'transparent') {
    throw new Error('JPG 不支持透明背景')
  }
  if (layout === 'horizontal' && (height < 16 || height > 8192)) {
    throw new Error(`图片统一高度必须在 16 到 8192 之间，当前值为 ${formatSetting(settings.height ?? 1080)}`)
  }
  if (layout === 'grid' && (columns < 1 || columns > 8)) {
    throw new Error(`网格列数必须在 1 到 8 之间，当前值为 ${formatSetting(settings.columns ?? 2)}`)
  }
  if (layout !== 'horizontal') settings.width = Math.round(width)
  settings.gap = Math.round(gap)
  if (layout === 'horizontal') settings.height = Math.round(height)
  if (layout === 'grid') settings.columns = Math.round(columns)
}

function buildGifSummary(
  items: MediaMergeItem[],
  settings: NonNullable<MediaMergePlan['image']>,
): NonNullable<MediaMergePlan['summary']['image']> {
  const fallback = settings.gifFrameDurationSeconds ?? 3
  const durationSeconds = Math.round(
    items.reduce((total, item) => total + gifItemDuration(item, fallback), 0) * 100,
  ) / 100
  return {
    width: settings.gifWidth ?? 1080,
    height: settings.gifHeight ?? 1080,
    layout: settings.layout ?? 'vertical',
    columns: 1,
    gap: 0,
    animated: true,
    durationSeconds,
  }
}

function gifItemDuration(item: MediaMergeItem, fallback: number): number {
  return item.imageClipSource === 'custom' && Number.isFinite(item.imageDurationSeconds)
    ? Math.min(120, Math.max(0.1, item.imageDurationSeconds ?? fallback))
    : fallback
}

function formatSetting(value: number): string {
  return Number.isFinite(value) ? String(value) : '空'
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function normalizeVideoSettings(
  settings: MediaMergePlanInput['video'] | undefined,
): NonNullable<MediaMergePlanInput['video']> {
  if (!settings) throw new Error('视频合并缺少输出设置')
  const transition = settings.transition ?? { type: 'none' as const, durationSeconds: 0 }
  if (!['none', 'crossfade'].includes(transition.type)) throw new Error('不支持的转场类型')
  if (!Number.isFinite(transition.durationSeconds) || transition.durationSeconds < 0 || transition.durationSeconds > 5) {
    throw new Error('转场时长必须在 0 到 5 秒之间')
  }
  if (transition.type === 'none' && transition.durationSeconds > 0) {
    throw new Error('无转场时转场时长必须为 0')
  }
  const outputVolume = settings.outputVolume ?? 1
  if (!Number.isFinite(outputVolume) || outputVolume < 0 || outputVolume > 4) {
    throw new Error('输出音量必须在 0 到 4 倍之间')
  }
  return {
    ...settings,
    encodingMode: settings.encodingMode ?? 'auto',
    format: settings.format ?? 'mp4',
    transition,
    outputVolume,
  }
}

function normalizeItemAudio(item: MediaMergeItem): Partial<MediaMergeItem> {
  const volume = item.volume ?? 1
  const fadeIn = item.audioFadeInSeconds ?? 0
  const fadeOut = item.audioFadeOutSeconds ?? 0
  if (!Number.isFinite(volume) || volume < 0 || volume > 4) {
    throw new Error(`音频音量必须在 0 到 4 倍之间：${item.path}`)
  }
  if (!Number.isFinite(fadeIn) || fadeIn < 0 || fadeIn > 30
    || !Number.isFinite(fadeOut) || fadeOut < 0 || fadeOut > 30) {
    throw new Error(`音频淡入淡出时长必须在 0 到 30 秒之间：${item.path}`)
  }
  return { volume, muted: item.muted ?? false, audioFadeInSeconds: fadeIn, audioFadeOutSeconds: fadeOut }
}

function normalizeItemFrame(item: MediaMergeItem): Partial<MediaMergeItem> {
  const scalePercent = item.frameScalePercent ?? 100
  const focusX = item.frameFocusX ?? 50
  const focusY = item.frameFocusY ?? 50
  if (!Number.isFinite(scalePercent) || scalePercent < 25 || scalePercent > 300) {
    throw new Error(`画面大小必须在 25% 到 300% 之间：${item.path}`)
  }
  if (!Number.isFinite(focusX) || focusX < 0 || focusX > 100
    || !Number.isFinite(focusY) || focusY < 0 || focusY > 100) {
    throw new Error(`画面焦点必须在 0% 到 100% 之间：${item.path}`)
  }
  return {
    frameScalePercent: Math.round(scalePercent),
    frameFocusX: Math.round(focusX),
    frameFocusY: Math.round(focusY),
  }
}

function labelForKind(kind: 'image' | 'video'): string {
  return kind === 'image' ? '图片' : '视频'
}
