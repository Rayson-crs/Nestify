import { nativeImage, protocol } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  ThumbnailCacheService,
  ThumbnailCancelledError,
  type ThumbnailGenerator,
} from '../../../packages/core/src/preview/thumbnail-service.ts'
import { getRuntime } from './runtime-host'
import { appState, THUMBNAIL_SIZE, type ThumbnailPreviewErrorCode } from './state'

export function thumbnailUnavailable(
  entryId: string,
  code: ThumbnailPreviewErrorCode,
  message: string,
  retryable: boolean,
) {
  return {
    entryId,
    kind: null,
    cacheKey: '',
    mime: null,
    width: null,
    height: null,
    url: null,
    error: { code, message, retryable },
  }
}

export async function cancelLibraryThumbnailRequests(libraryId: string): Promise<void> {
  const activeRequests = [...appState.thumbnailRequests.values()].filter((request) => request.libraryId === libraryId)
  const entryIds = new Set(activeRequests.map((request) => request.entryId))
  for (const request of activeRequests) request.controller.abort()
  if (entryIds.size === 0) return
  await Promise.all([...entryIds].map((entryId) => getThumbnailService().cancel(entryId)))
}

export function mimeForImage(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

export function isInsideDirectory(directory: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const relativePath = relative(resolve(directory), resolve(candidate))
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

const nativeImageThumbnailGenerator: ThumbnailGenerator = async (input) => {
  if (input.signal.aborted) throw new ThumbnailCancelledError()
  const source = nativeImage.createFromPath(input.sourcePath)
  if (source.isEmpty()) throw new Error(`cannot decode image: ${input.sourcePath}`)

  const sourceSize = source.getSize()
  const scale = Math.min(
    input.width / Math.max(1, sourceSize.width),
    input.height / Math.max(1, sourceSize.height),
    1,
  )
  const width = Math.max(1, Math.round(sourceSize.width * scale))
  const height = Math.max(1, Math.round(sourceSize.height * scale))
  const resized = source.resize({ width, height, quality: 'good' })
  const data = resized.toJPEG(82)
  if (data.length === 0) throw new Error(`thumbnail encoder returned no data: ${input.sourcePath}`)
  if (input.signal.aborted) throw new ThumbnailCancelledError()
  return { data: new Uint8Array(data), mime: 'image/jpeg', width, height }
}

export function getThumbnailService(): ThumbnailCacheService {
  const currentRuntime = getRuntime()
  if (!appState.thumbnailService) {
    appState.thumbnailService = new ThumbnailCacheService({
      db: currentRuntime.db,
      thumbnailsDir: currentRuntime.paths.thumbnailsDir,
      concurrency: 4,
      generator: nativeImageThumbnailGenerator,
      thumbnailSize: THUMBNAIL_SIZE,
      format: 'jpeg',
    })
  }
  return appState.thumbnailService
}

export function thumbnailUrl(cacheKey: string, mime: string): string {
  const extension = mime === 'image/webp' ? 'webp' : 'jpg'
  return `nestify-thumbnail://cache/${cacheKey}.${extension}`
}

export function registerThumbnailProtocol(): void {
  protocol.handle('nestify-thumbnail', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 })
    }

    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response(null, { status: 400 })
    }

    const filename = pathname.replace(/^\/+/, '')
    if (!/^[a-f0-9]{64}\.(?:jpg|webp)$/.test(filename)) {
      return new Response(null, { status: 404 })
    }

    const thumbnailsDir = getRuntime().paths.thumbnailsDir
    const cachePath = resolve(thumbnailsDir, filename)
    if (!isInsideDirectory(thumbnailsDir, cachePath)) {
      return new Response(null, { status: 404 })
    }

    try {
      const [info, data] = await Promise.all([stat(cachePath), readFile(cachePath)])
      if (!info.isFile() || data.length === 0) return new Response(null, { status: 404 })
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'content-type': filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
          'content-length': String(data.length),
          'cache-control': 'private, max-age=604800, immutable',
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}