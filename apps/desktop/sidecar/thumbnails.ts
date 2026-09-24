import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { findFfmpegPath } from '../../../packages/core/src/media/ffmpeg.ts'
import {
  ThumbnailCacheService,
  ThumbnailCancelledError,
  type ThumbnailGenerator,
} from '../../../packages/core/src/preview/thumbnail-service.ts'
import { IMAGE_EXT, VIDEO_EXT } from '../runtime/media-extensions.ts'

export const THUMBNAIL_SIZE = 192

const services = new WeakMap<DatabaseSync, ThumbnailCacheService>()

export function thumbnailServiceFor(db: DatabaseSync, thumbnailsDir: string): ThumbnailCacheService {
  const existing = services.get(db)
  if (existing) return existing
  const service = new ThumbnailCacheService({
    db,
    thumbnailsDir,
    concurrency: 4,
    generator: sidecarThumbnailGenerator,
    thumbnailSize: THUMBNAIL_SIZE,
    format: 'jpeg',
  })
  services.set(db, service)
  return service
}

export function thumbnailUrl(cacheKey: string, mime: string): string {
  const extension = mime === 'image/webp' ? 'webp' : 'jpg'
  return `nestify-thumbnail://cache/${cacheKey}.${extension}`
}

const sidecarThumbnailGenerator: ThumbnailGenerator = async (input) => {
  if (input.signal.aborted) throw new ThumbnailCancelledError()
  const extension = extname(input.sourcePath).toLowerCase()
  const data = VIDEO_EXT.has(extension)
    ? await videoThumbnail(input.sourcePath, input.width, input.height, input.signal)
    : await imageThumbnail(input.sourcePath, input.width, input.height, input.signal)
  if (input.signal.aborted) throw new ThumbnailCancelledError()
  const size = jpegSize(data) ?? { width: input.width, height: input.height }
  return { data, mime: 'image/jpeg', width: size.width, height: size.height }
}

async function imageThumbnail(sourcePath: string, width: number, height: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!IMAGE_EXT.has(extname(sourcePath).toLowerCase())) throw new Error(`cannot decode image: ${sourcePath}`)
  const sharp = await import('sharp')
  const data = await sharp.default(sourcePath, { pages: 1 })
    .rotate()
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  if (signal.aborted) throw new ThumbnailCancelledError()
  if (data.length === 0) throw new Error(`thumbnail encoder returned no data: ${sourcePath}`)
  return new Uint8Array(data)
}

async function videoThumbnail(sourcePath: string, width: number, height: number, signal: AbortSignal): Promise<Uint8Array> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('未找到可用 FFmpeg，无法生成视频缩略图')
  const directory = await mkdtemp(join(tmpdir(), 'nestify-thumb-'))
  const output = join(directory, 'thumb.jpg')
  try {
    await runFfmpeg(ffmpegPath, [
      '-hide_banner',
      '-y',
      '-ss', '1',
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      '-q:v', '3',
      output,
    ], signal)
    const data = await readFile(output)
    if (data.length === 0) throw new Error(`thumbnail encoder returned no data: ${sourcePath}`)
    return new Uint8Array(data)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

function runFfmpeg(ffmpegPath: string, args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ThumbnailCancelledError())
      return
    }
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const onAbort = () => child.kill()
    signal.addEventListener('abort', onAbort, { once: true })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.on('error', (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) reject(new ThumbnailCancelledError())
      else if (code === 0) resolve()
      else reject(new Error(stderr.trim().split(/\r?\n/).at(-1) || '视频缩略图生成失败'))
    })
  })
}

function jpegSize(data: Uint8Array): { width: number; height: number } | null {
  let offset = 2
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return null
    const marker = data[offset + 1] ?? 0
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }
    const length = ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0)
    if (length < 2) return null
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      const height = ((data[offset + 5] ?? 0) << 8) | (data[offset + 6] ?? 0)
      const width = ((data[offset + 7] ?? 0) << 8) | (data[offset + 8] ?? 0)
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += 2 + length
  }
  return null
}
