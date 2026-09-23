import type sharpFactory from 'sharp'
import type { MediaMergeImageSettings, MediaMergeItem, MediaMergeItemRotation } from '@nestify/shared'

type SharpFactory = typeof sharpFactory

export interface ImageSourceMetadata {
  width?: number
  height?: number
  orientation?: number
}

export interface ImageFrameSize {
  width: number
  height: number
}

export function imageItemDimensions(
  metadata: ImageSourceMetadata,
  rotation: MediaMergeItemRotation = 'none',
): ImageFrameSize {
  if (!metadata.width || !metadata.height) return { width: 0, height: 0 }
  const autoOriented = metadata.orientation != null && metadata.orientation >= 5
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height }
  return swapsAxes(rotation)
    ? { width: autoOriented.height, height: autoOriented.width }
    : autoOriented
}

export async function renderImageFrame(
  sharp: SharpFactory,
  item: MediaMergeItem,
  frame: ImageFrameSize,
  background: MediaMergeImageSettings['background'],
): Promise<Buffer> {
  const frameWidth = positiveInteger(frame.width)
  const frameHeight = positiveInteger(frame.height)
  const oriented = await sharp(item.path, { pages: 1 }).autoOrient().png().toBuffer()
  const angle = rotationDegrees(item.rotation ?? 'none')
  const source = angle === 0 ? oriented : await sharp(oriented).rotate(angle).png().toBuffer()
  const metadata = await sharp(source).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`无法读取图片尺寸：${item.path}`)

  const fit = item.frameFit ?? 'contain'
  const fitScale = fit === 'cover'
    ? Math.max(frameWidth / metadata.width, frameHeight / metadata.height)
    : Math.min(frameWidth / metadata.width, frameHeight / metadata.height)
  const userScale = clamp(item.frameScalePercent ?? 100, 25, 300) / 100
  const renderWidth = positiveInteger(metadata.width * fitScale * userScale)
  const renderHeight = positiveInteger(metadata.height * fitScale * userScale)
  const offsetX = imageOffset(frameWidth, renderWidth, item.frameFocusX ?? 50)
  const offsetY = imageOffset(frameHeight, renderHeight, item.frameFocusY ?? 50)
  const sourceLeft = Math.max(0, -offsetX)
  const sourceTop = Math.max(0, -offsetY)
  const destinationLeft = Math.max(0, offsetX)
  const destinationTop = Math.max(0, offsetY)
  const visibleWidth = Math.min(renderWidth - sourceLeft, frameWidth - destinationLeft)
  const visibleHeight = Math.min(renderHeight - sourceTop, frameHeight - destinationTop)
  const canvasBackground = background === 'transparent'
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : { r: 255, g: 255, b: 255, alpha: 1 }

  if (visibleWidth <= 0 || visibleHeight <= 0) {
    return sharp({
      create: { width: frameWidth, height: frameHeight, channels: 4, background: canvasBackground },
    }).png().toBuffer()
  }

  const visible = await sharp(source)
    .resize({ width: renderWidth, height: renderHeight, fit: 'fill' })
    .extract({
      left: sourceLeft,
      top: sourceTop,
      width: visibleWidth,
      height: visibleHeight,
    })
    .png()
    .toBuffer()

  return sharp({
    create: { width: frameWidth, height: frameHeight, channels: 4, background: canvasBackground },
  })
    .composite([{ input: visible, left: destinationLeft, top: destinationTop }])
    .png()
    .toBuffer()
}

function swapsAxes(rotation: MediaMergeItemRotation): boolean {
  return rotation === 'clockwise-90' || rotation === 'counterclockwise-90'
}

function rotationDegrees(rotation: MediaMergeItemRotation): number {
  if (rotation === 'clockwise-90') return 90
  if (rotation === 'counterclockwise-90') return -90
  if (rotation === 'rotate-180') return 180
  return 0
}

function imageOffset(frameLength: number, imageLength: number, focus: number): number {
  if (imageLength <= frameLength) return Math.round((frameLength - imageLength) / 2)
  return -Math.round((imageLength - frameLength) * (clamp(focus, 0, 100) / 100))
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.round(value))
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}
