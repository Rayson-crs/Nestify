export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.tif',
  '.heic',
  '.avif',
] as const

export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.m4v',
  '.mkv',
  '.avi',
  '.mov',
  '.wmv',
  '.asf',
  '.flv',
  '.webm',
  '.ts',
  '.mts',
  '.m2ts',
  '.mpg',
  '.mpeg',
  '.vob',
  '.3gp',
  '.3g2',
  '.ogv',
  '.f4v',
] as const

export const IMAGE_EXT = new Set<string>(IMAGE_EXTENSIONS)
export const VIDEO_EXT = new Set<string>(VIDEO_EXTENSIONS)
