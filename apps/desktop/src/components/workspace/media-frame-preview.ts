import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { MediaMergeFrameFit, MediaMergeItemRotation } from '@/lib/ipc'

export function useMediaPreviewCanvasRatio(fallbackRatio: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const fullscreenRef = useRef<HTMLDivElement | null>(null)
  const fallback = normalizeRatio(fallbackRatio)
  const [size, setSize] = useState({ width: fallback * 100, height: 100 })
  const [isFullscreen, setIsFullscreen] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      setSize((current) => Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { width, height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement === (fullscreenRef.current ?? ref.current))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  const toggleFullscreen = async () => {
    const target = fullscreenRef.current ?? ref.current
    if (document.fullscreenElement === target) await document.exitFullscreen()
    else await target?.requestFullscreen()
  }

  const fullscreenStyle: CSSProperties = isFullscreen
    ? { width: '100%', height: 'calc(100vh - 76px)', maxHeight: 'none', aspectRatio: 'auto' }
    : {}

  return { ref, fullscreenRef, size, isFullscreen, toggleFullscreen, fullscreenStyle }
}

export function mediaFrameBoxStyle(
  rotation: MediaMergeItemRotation,
  containerSize: { width: number; height: number },
): CSSProperties {
  const { width, height } = mediaFrameSize(rotation, containerSize)
  if (rotation === 'none') {
    return centeredFrame(width, height, 0)
  }
  if (rotation === 'rotate-180') {
    return centeredFrame(width, height, 180)
  }
  const angle = rotation === 'clockwise-90' ? 90 : -90
  return centeredFrame(width, height, angle)
}

export function mediaFrameSize(
  rotation: MediaMergeItemRotation,
  containerSize: { width: number; height: number },
): { width: number; height: number } {
  const width = Math.max(1, containerSize.width)
  const height = Math.max(1, containerSize.height)
  return rotation === 'clockwise-90' || rotation === 'counterclockwise-90'
    ? { width: height, height: width }
    : { width, height }
}

export function mediaScaleLayerStyle(): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
  }
}

export function mediaContentStyle(
  frameFit: MediaMergeFrameFit,
  frameSize: { width: number; height: number },
  mediaSize: { width: number; height: number } | null,
  scalePercent = 100,
  focusX = 50,
  focusY = 50,
): CSSProperties {
  const frameWidth = Math.max(1, frameSize.width)
  const frameHeight = Math.max(1, frameSize.height)
  const mediaWidth = Math.max(1, mediaSize?.width ?? frameWidth)
  const mediaHeight = Math.max(1, mediaSize?.height ?? frameHeight)
  const fitScale = frameFit === 'cover'
    ? Math.max(frameWidth / mediaWidth, frameHeight / mediaHeight)
    : Math.min(frameWidth / mediaWidth, frameHeight / mediaHeight)
  const userScale = normalizeScale(scalePercent) / 100
  const width = mediaWidth * fitScale * userScale
  const height = mediaHeight * fitScale * userScale
  const left = mediaOffset(frameWidth, width, focusX)
  const top = mediaOffset(frameHeight, height, focusY)
  return {
    display: 'block',
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    maxWidth: 'none',
    maxHeight: 'none',
  }
}

function normalizeRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 16 / 9
}

function normalizeScale(value: number): number {
  return Number.isFinite(value) ? Math.min(300, Math.max(25, value)) : 100
}

function normalizeFocus(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50
}

function mediaOffset(frameLength: number, mediaLength: number, focus: number): number {
  if (mediaLength <= frameLength) return (frameLength - mediaLength) / 2
  return -(mediaLength - frameLength) * (normalizeFocus(focus) / 100)
}

function centeredFrame(width: number, height: number, angle: number): CSSProperties {
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(-50%, -50%) rotate(${angle}deg)`,
    transformOrigin: 'center',
  }
}
