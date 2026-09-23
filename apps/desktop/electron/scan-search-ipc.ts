import { ipcMain } from 'electron'
import type { NestifyRuntime } from '@nestify/core'
import { getQueryWorker } from './query-worker-host'
import { getRuntime } from './runtime-host'
import { resumeLibraryWriter, stopLibraryWriter } from './writer-worker-host'
import { assertNoActiveScan, runExclusiveFileOperation } from './file-operations-ipc'
import { appState } from './state'
import { logStartup } from './log'

export function registerScanSearchIpc(): void {
  ipcMain.handle('scan.start', async (_event, input: { libraryId: string }) =>
    runExclusiveFileOperation(async () => {
      assertNoActiveScan()
      const runtime = getRuntime()
      const library = runtime.listLibraries().find((item) => item.id === input.libraryId)
      if (!library) throw new Error(`library not found: ${input.libraryId}`)
      await stopLibraryWriter(runtime, input.libraryId)
      try {
        const started = runtime.startScan(input.libraryId)
        const removeListener = runtime.onScanFinished((libraryId) => {
          if (libraryId !== input.libraryId) return
          removeListener()
          const current = runtime.listLibraries().find((item) => item.id === libraryId)
          if (current) resumeLibraryWriter(runtime, current)
        })
        return started
      } catch (error) {
        resumeLibraryWriter(runtime, library)
        throw error
      }
    }),
  )
  ipcMain.handle('scan.progress', async () => {
    const progress = getRuntime().getScanProgress()
    return {
      phase: progress.phase,
      paused: progress.paused,
      filesScanned: progress.filesScanned,
      dirsScanned: progress.dirsScanned,
      bytesScanned: progress.bytesScanned,
      currentPath: progress.currentPath,
      errors: progress.errors,
      filesPerSecond: progress.filesPerSecond,
      jobId: progress.jobId ?? null,
      libraryId: progress.libraryId ?? null,
      jobStatus: progress.jobStatus ?? null,
    }
  })
  ipcMain.handle('scan.pause', async (_event, input: { jobId: string }) => getRuntime().pauseScan(input.jobId))
  ipcMain.handle('scan.resume', async (_event, input: { jobId: string }) => getRuntime().resumeScan(input.jobId))
  ipcMain.handle('scan.cancel', async (_event, input: { jobId: string }) => getRuntime().cancelScan(input.jobId))
  ipcMain.handle('search.cancel', async () => {
    appState.queryWorker?.cancel()
    return { cancelled: true as const }
  })

  ipcMain.handle(
    'search.query',
    async (
      _event,
      input: {
        libraryId: string
        text: string
        textMode?: 'full-text' | 'substring'
        limit?: number
        offset?: number
        cursor?: string
        resultMode?: 'hits-only' | 'hits-and-approximate-count' | 'hits-and-exact-stats'
        kinds?: string[]
        scope?: 'library' | 'directory' | 'selection'
        directory?: string
        directChildren?: boolean
        entryIds?: string[]
        sort?: {
          field: 'relevance' | 'mtime' | 'size' | 'path' | 'name' | 'path_mtime'
          direction?: 'asc' | 'desc'
        }
      },
    ) => {
      const { libraryId, text, ...options } = input
      const startedAt = Date.now()
      logStartup('search.query', { libraryId, text, options })
      try {
        const runtime = getRuntime()
        const isFreshSearch = (options.offset ?? 0) === 0 && options.cursor == null
        if (isFreshSearch && appState.queryWorker?.hasPending('search')) {
          appState.queryWorker.cancel()
        }
        const result = await getQueryWorker(runtime).search<ReturnType<NestifyRuntime['search']>>({
          ...options,
          libraryId,
          text,
        } satisfies Parameters<NestifyRuntime['search']>[2] & { libraryId: string; text: string })
        const response = {
          total: result.total,
          fileCount: result.fileCount,
          directoryCount: result.directoryCount,
          kindCounts: result.kindCounts,
          elapsedMs: result.elapsedMs,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          statsIncluded: result.statsIncluded,
          hits: result.hits.map((hit) => ({
            entryId: hit.entryId,
            libraryId: hit.libraryId,
            name: hit.name,
            path: hit.path,
            ext: hit.ext,
            kind: hit.kind,
            size: hit.size,
            mtime: hit.mtime,
            parent: hit.parent,
          })),
        }
        logStartup('search.result', {
          libraryId,
          text,
          total: response.total,
          hits: response.hits.length,
          elapsedMs: response.elapsedMs,
          ipcElapsedMs: Date.now() - startedAt,
        })
        return { result: response }
      } catch (error) {
        logStartup('search.failed', {
          libraryId,
          text,
          options,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          ipcElapsedMs: Date.now() - startedAt,
        })
        throw error
      }
    },
  )

  ipcMain.handle(
    'directory.children',
    async (
      _event,
      input: {
        libraryId: string
        directory: string
        parentId?: string
        limit?: number
        offset?: number
        sort?: {
          field: 'relevance' | 'mtime' | 'size' | 'path' | 'name' | 'path_mtime'
          direction?: 'asc' | 'desc'
        }
      },
    ) => {
      const startedAt = Date.now()
      const result = await getQueryWorker(getRuntime()).directory<ReturnType<NestifyRuntime['listDirectoryChildren']>>(
        input.libraryId,
        input.directory,
        input,
      )
      logStartup('directory.children.result', {
        libraryId: input.libraryId,
        directory: input.directory,
        hits: result.hits.length,
        elapsedMs: result.elapsedMs,
        ipcElapsedMs: Date.now() - startedAt,
      })
      return { result }
    },
  )
}
