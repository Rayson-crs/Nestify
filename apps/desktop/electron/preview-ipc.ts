import { ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { ALL_LIBRARIES_ID, getEntryById, getLibrary, membershipLibraryIdFor } from '@nestify/core'
import { ThumbnailCancelledError } from '../../../packages/core/src/preview/thumbnail-service.ts'
import { mediaPreviewUrl } from './media-protocol'
import { getRuntime } from './runtime-host'
import { appState, IMAGE_EXT, MAX_IMAGE_PREVIEW, THUMBNAIL_PRIORITY, VIDEO_EXT } from './state'
import {
  getThumbnailService,
  isInsideDirectory,
  mimeForImage,
  thumbnailUnavailable,
  thumbnailUrl,
} from './thumbnails'

export function registerPreviewIpc(): void {
  ipcMain.handle('preview.file', async (_event, input: { path: string }) => {
    try {
      const ext = extname(input.path).toLowerCase()
      if (IMAGE_EXT.has(ext)) {
        const info = await stat(input.path)
        if (info.size > MAX_IMAGE_PREVIEW) return { kind: 'too-large' as const }
        const buf = await readFile(input.path)
        return { kind: 'image' as const, dataUrl: `data:${mimeForImage(ext)};base64,${buf.toString('base64')}` }
      }
      if (VIDEO_EXT.has(ext)) return { kind: 'video' as const, src: mediaPreviewUrl(input.path) }
      return { kind: 'none' as const }
    } catch {
      return { kind: 'none' as const }
    }
  })

  ipcMain.handle(
    'preview.thumbnail',
    async (
      _event,
      input: {
        requestId?: string
        libraryId?: string
        entryId?: string
        kind?: 'image' | 'video'
        width?: number
        height?: number
        size?: number
        priority?: 'selected' | 'visible' | 'background'
      },
    ) => {
      const requestId = input.requestId?.trim()
      if (requestId && appState.thumbnailRequests.has(requestId)) {
        return thumbnailUnavailable(input.entryId?.trim() ?? '', 'invalid_request', 'requestId is already active', false)
      }
      if (!input.libraryId?.trim() || !input.entryId?.trim()) {
        return thumbnailUnavailable(input.entryId?.trim() ?? '', 'invalid_request', 'libraryId and entryId are required', false)
      }

      const entryId = input.entryId.trim()
      const libraryId = input.libraryId.trim()
      const request = requestId ? { controller: new AbortController(), libraryId, entryId } : null
      if (requestId && request) appState.thumbnailRequests.set(requestId, request)

      try {
        const currentRuntime = getRuntime()
        const entry = getEntryById(currentRuntime.db, entryId)
        const membershipLibraryId =
          libraryId === ALL_LIBRARIES_ID
            ? membershipLibraryIdFor(currentRuntime.db, entryId)
            : membershipLibraryIdFor(currentRuntime.db, entryId, libraryId)
        if (!entry || !membershipLibraryId || entry.tombstone) {
          return thumbnailUnavailable(entryId, 'entry_not_found', 'entry not found in library', false)
        }
        if (entry.isDir || !['image', 'video'].includes(entry.kind) || entry.protocol !== 'local') {
          return thumbnailUnavailable(entryId, 'unsupported_kind', 'only local image and video entries are supported', false)
        }
        if (input.kind && input.kind !== entry.kind) {
          return thumbnailUnavailable(entryId, 'unsupported_kind', 'requested kind does not match the indexed entry', false)
        }
        const entryExt = extname(entry.path).toLowerCase()
        if ((!IMAGE_EXT.has(entryExt) && !VIDEO_EXT.has(entryExt)) || !isAbsolute(entry.path)) {
          return thumbnailUnavailable(entryId, 'unsupported_kind', 'entry has an unsupported media path', false)
        }

        const library = getLibrary(currentRuntime.db, membershipLibraryId)
        const insideLibraryRoot = library?.roots.some((root) => isInsideDirectory(root, entry.path))
        if (!insideLibraryRoot) {
          return thumbnailUnavailable(entryId, 'entry_not_found', 'entry is outside its library roots', false)
        }

        const info = await stat(entry.path)
        const mtime = Math.trunc(info.mtimeMs)
        if (!info.isFile() || info.size !== entry.size || mtime !== entry.mtime) {
          return thumbnailUnavailable(
            entryId,
            'generation_failed',
            'source file changed since the last scan; rescan the library',
            true,
          )
        }
        if (request?.controller.signal.aborted) {
          return thumbnailUnavailable(entryId, 'cancelled', 'thumbnail generation was cancelled', true)
        }

        const result = await getThumbnailService().getThumbnail(
          {
            entryId,
            sizeBytes: info.size,
            mtime,
            generatorVersion: 3,
            sourcePath: entry.path,
          },
          {
            priority: THUMBNAIL_PRIORITY[input.priority ?? 'visible'],
            signal: request?.controller.signal,
          },
        )

        return {
          entryId,
          kind: entry.kind,
          cacheKey: result.cacheKey,
          mime: result.mime,
          width: result.width,
          height: result.height,
          url: thumbnailUrl(result.cacheKey, result.mime),
          error: null,
        }
      } catch (error) {
        if (error instanceof ThumbnailCancelledError) {
          return thumbnailUnavailable(entryId, 'cancelled', 'thumbnail generation was cancelled', true)
        }
        return thumbnailUnavailable(
          entryId,
          'generation_failed',
          error instanceof Error ? error.message : 'thumbnail generation failed',
          true,
        )
      } finally {
        if (requestId) appState.thumbnailRequests.delete(requestId)
      }
    },
  )

  ipcMain.handle('preview.thumbnail.cancel', async (_event, input: { requestId?: string }) => {
    const requestId = input.requestId?.trim()
    const request = requestId ? appState.thumbnailRequests.get(requestId) : undefined
    if (!request) return { cancelled: false as const }
    request.controller.abort()
    return { cancelled: true as const }
  })
}
