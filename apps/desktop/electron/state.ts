import type { BrowserWindow, Tray } from 'electron'
import type { NestifyRuntime } from '@nestify/core'
import type { ThumbnailCacheService } from '../../../packages/core/src/preview/thumbnail-service.ts'
import type { QueryWorkerClient } from './query-worker-client'
import type { WriterWorkerClient } from './writer-worker-client'

export type ThumbnailPreviewErrorCode =
  | 'invalid_request'
  | 'not_implemented'
  | 'entry_not_found'
  | 'unsupported_kind'
  | 'generation_failed'
  | 'cancelled'

export type ThumbnailRequestState = {
  controller: AbortController
  libraryId: string
  entryId: string
}

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif'])
export const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'])
export const MAX_IMAGE_PREVIEW = 8 * 1024 * 1024
export const THUMBNAIL_SIZE = 192
export const THUMBNAIL_PRIORITY = {
  selected: 30,
  visible: 20,
  background: 10,
} as const

export const appState = {
  runtime: null as NestifyRuntime | null,
  thumbnailService: null as ThumbnailCacheService | null,
  queryWorker: null as QueryWorkerClient | null,
  writerWorker: null as WriterWorkerClient | null,
  mainWindow: null as BrowserWindow | null,
  spotlightWindow: null as BrowserWindow | null,
  ipcRegistered: false,
  tray: null as Tray | null,
  quitting: false,
  quitCleanupStarted: false,
  spotlightShortcutRegistered: false,
  spotlightFallbackShortcutRegistered: false,
  spotlightReliableShortcutRegistered: false,
  lastSpotlightRequestAt: 0,
  thumbnailRequests: new Map<string, ThumbnailRequestState>(),
  fileOperationTail: Promise.resolve(),
}
