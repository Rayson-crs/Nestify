export type MainPreviewSurface = 'frame' | 'video' | 'image' | 'empty'

export function selectMainPreviewSurface(input: {
  frameUrl?: string | null
  videoReady: boolean
  imageReady?: boolean
}): MainPreviewSurface {
  if (input.imageReady) return 'image'
  if (input.frameUrl && !input.videoReady) return 'frame'
  if (input.videoReady) return 'video'
  return input.frameUrl ? 'frame' : 'empty'
}

export function videoFrameIsPainted(
  video: { videoWidth: number; videoHeight: number } | null,
): boolean {
  return Boolean(video && video.videoWidth > 0 && video.videoHeight > 0)
}

export function normalizePreviewProxySrc(
  src: string | null | undefined,
  fallback: string,
  mediaSrc: (path: string) => string,
): string {
  if (!src) return fallback
  if (!src.startsWith('nestify-media://preview/')) return src
  try {
    const path = new URL(src).searchParams.get('path')
    return path ? mediaSrc(path) : fallback
  } catch {
    return fallback
  }
}
