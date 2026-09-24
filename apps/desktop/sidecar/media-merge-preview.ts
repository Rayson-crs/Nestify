import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import type { MediaMergeImageSettings, MediaMergeItem, MediaMergePreviewProxy } from '@nestify/shared'
import { findFfmpegPath } from '../../../packages/core/src/media/ffmpeg.ts'
import { imageItemDimensions, renderImageFrame } from '../../../packages/core/src/media/image-frame.ts'
import { calculateImageLayout, validateImageLayout } from '../../../packages/core/src/media/layout.ts'
import { IMAGE_EXT, VIDEO_EXT } from '../runtime/media-extensions.ts'

const PREVIEW_EDGE = 480
const MAX_PROXY_JOBS = 2
const PROXY_WIDTH = 1280
const MISSING_FFMPEG = '未找到可用 FFmpeg，无法准备预览'

type ProxyResult = MediaMergePreviewProxy
type ImagePreviewResult = { src: string; width: number; height: number; error: string | null }

interface ProxyJob {
  promise: Promise<ProxyResult>
}

const proxyJobs = new Map<string, ProxyJob>()
const proxyWaiters: Array<() => void> = []
let activeProxyJobs = 0

export async function previewSelectedVideoProxy(input: {
  path: string
  selectedPaths: string[]
}): Promise<ProxyResult> {
  try {
    const path = assertSelectedVideo(input.path, input.selectedPaths)
    const info = await stat(path)
    if (!info.isFile()) return failed('只能为当前合并列表中的视频准备预览')
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return failed(MISSING_FFMPEG)
    const key = proxyKey(path, info.mtimeMs, info.size)
    const ready = await existingProxy(key)
    if (ready) return ready
    const cached = proxyJobs.get(key)
    if (cached) return { src: '', status: 'preparing', error: null }
    const promise = enqueueProxy(async () => renderProxy(ffmpegPath, path, key))
    proxyJobs.set(key, { promise })
    promise.then((result) => {
      if (result.status === 'failed') proxyJobs.delete(key)
    }).catch(() => {
      proxyJobs.delete(key)
    })
    void promise
    return { src: '', status: 'preparing', error: null }
  } catch (error) {
    return failed(errorText(error))
  }
}

export async function renderImageMergePreview(input: {
  items: MediaMergeItem[]
  settings: MediaMergeImageSettings
}): Promise<ImagePreviewResult> {
  try {
    const items = uniqueItems(input.items)
    if (items.length === 0) return imageError('没有可预览的图片')
    for (const item of items) {
      const path = item.path
      if (!isAbsolute(path) || !IMAGE_EXT.has(extname(path).toLowerCase())) {
        return imageError('只能合成当前列表中的本地图片')
      }
    }
    const sharp = await loadSharp()
    if (!sharp) return imageError('图片预览组件不可用')
    const animated = input.settings.format === 'gif'
    const dimensions: Array<{ width: number; height: number }> = []
    for (const item of items) {
      const path = item.path
      const info = await stat(path)
      if (!info.isFile()) return imageError(`无法读取图片：${path}`)
      if (!animated) {
        const metadata = await sharp(path, { pages: 1 }).metadata()
        const oriented = imageItemDimensions(metadata, item.rotation)
        if (!oriented.width || !oriented.height) return imageError(`无法读取图片尺寸：${path}`)
        dimensions.push(oriented)
      }
    }
    const layout = animated
      ? fixedPreviewLayout(items.length, input.settings.gifWidth ?? 1080, input.settings.gifHeight ?? 1080)
      : calculateImageLayout(dimensions, input.settings)
    if (!animated) {
      try {
        validateImageLayout(layout as ReturnType<typeof calculateImageLayout>)
      } catch (error) {
        return imageError(errorText(error))
      }
    }
    const longest = Math.max(layout.canvasWidth, layout.canvasHeight, 1)
    const scale = Math.min(1, PREVIEW_EDGE / longest)
    const width = Math.max(1, Math.round(layout.canvasWidth * scale))
    const height = Math.max(1, Math.round(layout.canvasHeight * scale))
    const background = input.settings.background === 'transparent'
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 }
    const layers = []
    for (const [index, item] of items.entries()) {
      const placement = layout.placements[index]
      if (!placement) return imageError('图片布局不完整')
      const layerWidth = Math.max(1, Math.round(placement.width * scale))
      const layerHeight = Math.max(1, Math.round(placement.height * scale))
      const rendered = await renderImageFrame(
        sharp,
        item,
        { width: layerWidth, height: layerHeight },
        input.settings.background,
      )
      layers.push({
        input: rendered,
        left: animated ? 0 : Math.round(placement.left * scale),
        top: animated ? index * height : Math.round(placement.top * scale),
      })
    }
    const canvas = sharp({
      create: {
        width,
        height: animated ? height * items.length : height,
        channels: 4,
        background,
        ...(animated ? { pageHeight: height } : {}),
      },
    }).composite(layers)
    const fallback = input.settings.gifFrameDurationSeconds ?? 3
    const output = animated
      ? await canvas.gif({
        loop: input.settings.gifLoopCount ?? 0,
        delay: items.map((item) => Math.max(100, Math.round(gifItemDuration(item, fallback) * 1000))),
      }).toBuffer()
      : await canvas.png().toBuffer()
    const extension = animated ? 'gif' : 'png'
    const filePath = join(await previewDirectory(), `${previewDigest(output)}.${extension}`)
    await writeFile(filePath, output)
    return { src: previewUrl(filePath), width, height, error: null }
  } catch (error) {
    return imageError(errorText(error))
  }
}

function assertSelectedVideo(path: string, selectedPaths: readonly string[]): string {
  if (!isAbsolute(path) || !VIDEO_EXT.has(extname(path).toLowerCase())) {
    throw new Error('只能为当前合并列表中的视频准备预览')
  }
  const normalized = normalizePath(path)
  const selected = selectedPaths.some((candidate) => isAbsolute(candidate) && normalizePath(candidate) === normalized)
  if (!selected) throw new Error('只能为当前合并列表中的视频准备预览')
  return path
}

async function existingProxy(key: string): Promise<ProxyResult | null> {
  const outputPath = join(await previewDirectory(), `${key}.mp4`)
  try {
    const existing = await stat(outputPath)
    if (existing.isFile() && existing.size > 0) {
      return { src: previewUrl(outputPath), status: 'ready', error: null }
    }
  } catch {
    return null
  }
  return null
}

async function renderProxy(ffmpegPath: string, sourcePath: string, key: string): Promise<ProxyResult> {
  const ready = await existingProxy(key)
  if (ready) return ready
  const directory = await previewDirectory()
  const outputPath = join(directory, `${key}.mp4`)
  const partialPath = join(directory, `${key}.partial.mp4`)
  await rm(partialPath, { force: true }).catch(() => undefined)
  await runFfmpeg(ffmpegPath, [
    '-hide_banner',
    '-y',
    '-i', sourcePath,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-vf', `scale=${PROXY_WIDTH}:${PROXY_WIDTH}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-movflags', '+faststart',
    partialPath,
  ])
  await rename(partialPath, outputPath)
  return { src: previewUrl(outputPath), status: 'ready', error: null }
}

function enqueueProxy(task: () => Promise<ProxyResult>): Promise<ProxyResult> {
  return new Promise((resolve) => {
    const start = () => {
      activeProxyJobs += 1
      resolve(task().then(
        (result) => result,
        (error: unknown) => failed(errorText(error)),
      ).finally(() => {
        activeProxyJobs -= 1
        proxyWaiters.shift()?.()
      }))
    }
    if (activeProxyJobs < MAX_PROXY_JOBS) start()
    else proxyWaiters.push(start)
  })
}

function runFfmpeg(ffmpegPath: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim().split(/\r?\n/).slice(-2).join(' ') || '预览代理生成失败'))
    })
  })
}

async function loadSharp(): Promise<typeof import('sharp') | null> {
  try {
    const loaded = await import('sharp')
    return loaded.default
  } catch {
    return null
  }
}

async function previewDirectory(): Promise<string> {
  const directory = join(tmpdir(), 'nestify-media-preview')
  await mkdir(directory, { recursive: true })
  return directory
}

function previewUrl(filePath: string): string {
  return `nestify-media://preview/?path=${encodeURIComponent(filePath)}`
}

function proxyKey(path: string, mtimeMs: number, size: number): string {
  return createHash('sha1')
    .update(`${normalizePath(path)}|${Math.trunc(mtimeMs)}|${size}`)
    .digest('hex')
}

function previewDigest(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex')
}

function uniqueItems(items: MediaMergeItem[]): MediaMergeItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item || typeof item.path !== 'string' || item.path.length === 0) return false
    const key = normalizePath(item.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function fixedPreviewLayout(itemCount: number, width: number, height: number) {
  const frameWidth = Math.max(1, Math.round(width))
  const frameHeight = Math.max(1, Math.round(height))
  return {
    settings: null,
    canvasWidth: frameWidth,
    canvasHeight: frameHeight,
    placements: Array.from({ length: itemCount }, () => ({
      left: 0,
      top: 0,
      width: frameWidth,
      height: frameHeight,
    })),
  }
}

function gifItemDuration(item: MediaMergeItem, fallback: number): number {
  return item.imageClipSource === 'custom' && Number.isFinite(item.imageDurationSeconds)
    ? Math.min(120, Math.max(0.1, item.imageDurationSeconds ?? fallback))
    : fallback
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').toLowerCase()
}

function failed(error: string): ProxyResult {
  return { src: '', status: 'failed', error }
}

function imageError(error: string): ImagePreviewResult {
  return { src: '', width: 0, height: 0, error }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
