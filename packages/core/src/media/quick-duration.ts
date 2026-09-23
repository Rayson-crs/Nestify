import { open, type FileHandle } from 'node:fs/promises'
import { extname } from 'node:path'

const QUICK_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.f4v'])
const MAX_MOOV_SCAN = 64 * 1024 * 1024

export async function readQuickVideoDuration(path: string): Promise<number | null> {
  if (!QUICK_EXTENSIONS.has(extname(path).toLowerCase())) return null
  const file = await open(path, 'r')
  try {
    const size = (await file.stat()).size
    return await findMvhdDuration(file, 0, size, 0)
  } catch {
    return null
  } finally {
    await file.close()
  }
}

async function findMvhdDuration(file: FileHandle, start: number, end: number, depth: number): Promise<number | null> {
  if (depth > 8 || end - start < 8) return null
  let offset = start
  while (offset + 8 <= end && offset - start <= MAX_MOOV_SCAN) {
    const header = await readExact(file, offset, 16)
    if (!header) return null
    let boxSize = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    let headerSize = 8
    if (boxSize === 1) {
      boxSize = Number(header.readBigUInt64BE(8))
      headerSize = 16
    } else if (boxSize === 0) {
      boxSize = end - offset
    }
    if (!Number.isSafeInteger(boxSize) || boxSize < headerSize || offset + boxSize > end) return null
    const contentStart = offset + headerSize
    const contentEnd = offset + boxSize
    if (type === 'moov' || type === 'trak' || type === 'mdia') {
      const nested = await findMvhdDuration(file, contentStart, contentEnd, depth + 1)
      if (nested != null) return nested
    } else if (type === 'mvhd') {
      return readMvhd(await readExact(file, contentStart, Math.min(32, contentEnd - contentStart)))
    }
    offset += boxSize
  }
  return null
}

function readMvhd(header: Buffer | null): number | null {
  if (!header || header.length < 20) return null
  const version = header.readUInt8(0)
  if (version === 0) {
    if (header.length < 20) return null
    return duration(header.readUInt32BE(12), header.readUInt32BE(16))
  }
  if (version === 1) {
    if (header.length < 32) return null
    const timescale = header.readUInt32BE(20)
    const raw = header.readBigUInt64BE(24)
    if (raw > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return duration(timescale, Number(raw))
  }
  return null
}

function duration(timescale: number, value: number): number | null {
  if (timescale <= 0 || !Number.isFinite(value) || value < 0) return null
  const seconds = value / timescale
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

async function readExact(file: FileHandle, position: number, length: number): Promise<Buffer | null> {
  if (length <= 0) return null
  const buffer = Buffer.alloc(length)
  const result = await file.read(buffer, 0, length, position)
  return result.bytesRead === length ? buffer : null
}
