import sharp from 'sharp'
import type { FfmpegProbeResult } from './ffmpeg.ts'
import { imageClipProbe, isImagePath } from './image-clip.ts'

export async function probeImageClip(path: string, signal?: AbortSignal): Promise<FfmpegProbeResult> {
  if (signal?.aborted) throw new Error('已取消')
  const metadata = await sharp(path, { pages: 1 }).metadata()
  const swap = metadata.orientation != null && metadata.orientation >= 5
  const width = swap ? metadata.height : metadata.width
  const height = swap ? metadata.width : metadata.height
  if (!width || !height) throw new Error(`无法读取图片尺寸：${path}`)
  return imageClipProbe(width, height)
}

export async function probeMediaInput(
  path: string,
  signal?: AbortSignal,
): Promise<FfmpegProbeResult | null> {
  if (!isImagePath(path)) return null
  return probeImageClip(path, signal)
}
