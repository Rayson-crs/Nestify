import { protocol } from 'electron'
import { createReadStream, type ReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { Readable } from 'node:stream'
import { IMAGE_EXT, VIDEO_EXT } from './state'
import { mimeForImage } from './thumbnails'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.f4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.asf': 'video/x-ms-asf',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.vob': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp',
  '.ogv': 'video/ogg',
}

export function mediaPreviewUrl(path: string): string {
  return `nestify-media://preview/?path=${encodeURIComponent(path)}`
}

export function registerMediaProtocol(): void {
  protocol.handle('nestify-media', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { 'accept-ranges': 'bytes' } })
    }
    const resolved = await resolveMediaRequest(request.url)
    if (!resolved.ok) return new Response(null, { status: resolved.status })
    return serveFile(request, resolved.path, resolved.mime)
  })
}

async function resolveMediaRequest(rawUrl: string): Promise<
  | { ok: true; path: string; mime: string }
  | { ok: false; status: number }
> {
  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return { ok: false, status: 400 }
  }
  if (target.hostname !== 'preview') return { ok: false, status: 404 }
  const filePath = target.searchParams.get('path') ?? ''
  if (!isAbsolute(filePath)) return { ok: false, status: 400 }
  const extension = extname(filePath).toLowerCase()
  if (!IMAGE_EXT.has(extension) && !VIDEO_EXT.has(extension)) return { ok: false, status: 404 }
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return { ok: false, status: 404 }
  } catch {
    return { ok: false, status: 404 }
  }
  return { ok: true, path: filePath, mime: mimeForMedia(extension) }
}

function mimeForMedia(extension: string): string {
  return MIME[extension] ?? mimeForImage(extension)
}

async function serveFile(request: Request, filePath: string, mime: string): Promise<Response> {
  const info = await stat(filePath)
  const size = info.size
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=60',
    'content-type': mime,
  })
  const range = parseRange(request.headers.get('range'), size)
  if (range === 'invalid') {
    headers.set('content-range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  if (request.method === 'HEAD') {
    headers.set('content-length', String(range ? range.end - range.start + 1 : size))
    if (range) headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`)
    return new Response(null, { status: range ? 206 : 200, headers })
  }
  if (!range) {
    headers.set('content-length', String(size))
    return new Response(streamBody(filePath), { status: 200, headers })
  }
  headers.set('content-length', String(range.end - range.start + 1))
  headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`)
  return new Response(streamBody(filePath, range), { status: 206, headers })
}

function streamBody(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const nodeStream: ReadStream = range
    ? createReadStream(filePath, { start: range.start, end: range.end })
    : createReadStream(filePath)
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) return 'invalid'
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  if (!startText && !endText) return 'invalid'
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid'
    const length = Math.min(size, suffix)
    return { start: size - length, end: size - 1 }
  }
  const start = Number(startText)
  const end = endText ? Number(endText) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    return 'invalid'
  }
  return { start, end: Math.min(end, size - 1) }
}
