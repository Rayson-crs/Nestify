import { createReadStream, existsSync, type ReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NestifyRuntime } from '../../../packages/core/src/index.ts'
import type {
  DuplicateAnalysisProgress,
  LibraryRemovalProgress,
  PlanExecutionProgress,
} from '@nestify/shared'
import { MediaMergeWorkerClient } from '../runtime/media-merge-worker-client.ts'
import { PreviewWorkerClient } from '../runtime/preview-worker-client.ts'
import { QueryWorkerClient } from '../runtime/query-worker-client.ts'
import { ScanWorkerClient } from '../runtime/scan-worker-client.ts'
import { WriterWorkerClient } from '../runtime/writer-worker-client.ts'
import { IMAGE_EXT, VIDEO_EXT } from '../runtime/media-extensions.ts'
import { SystemLogger } from './system-log.ts'

const sidecarDir = dirname(fileURLToPath(import.meta.url))
let activeSystemLogger: SystemLogger | null = null
const EVENT_HISTORY_LIMIT = 256
const THROTTLED_PROGRESS_EVENTS = new Set([
  'scan.progress',
  'mediaMerge.progress',
  'plan.execution-progress',
  'duplicates.analysis-progress',
])
let eventSequence = Date.now()

export type SidecarEventEnvelope = {
  seq: number
  event: string
  payload: unknown
  createdAt: number
}

export type HostState = {
  port: number
  appDataRoot: string
  bundledConfigDir: string
  runtime: NestifyRuntime | null
  queryWorker: QueryWorkerClient | null
  searchRequestSeqByClient: Map<string, number>
  previewWorker: PreviewWorkerClient | null
  writerWorker: WriterWorkerClient | null
  listeners: Set<(event: SidecarEventEnvelope) => void>
  eventHistory: SidecarEventEnvelope[]
  progressTimers: Map<string, ReturnType<typeof setTimeout>>
  lastProgressAt: Map<string, number>
  fileOperationTail: Promise<void>
  thumbnailRequests: Map<string, AbortController>
  systemLog: SystemLogger
  libraryRemovalProgress: Map<string, LibraryRemovalProgress>
  planExecutionProgress: PlanExecutionProgress | null
  duplicateAnalysisProgress: DuplicateAnalysisProgress | null
  emit: (event: string, payload: unknown) => void
  workerPath: (name: string) => string
  mediaMergeWorkerFactory: (workerPath: string) => MediaMergeWorkerClient
  query: () => QueryWorkerClient
  preview: () => PreviewWorkerClient
  writers: () => WriterWorkerClient
  startWriters: () => void
  serveAsset: (url: URL, request: IncomingMessage, response: ServerResponse) => Promise<void>
  close: () => Promise<void>
}

export function createHostState(): HostState {
  const appDataRoot = defaultAppDataRoot()
  const systemLog = new SystemLogger(join(appDataRoot, 'logs'))
  activeSystemLogger = systemLog
  const state: HostState = {
    port: 0,
    appDataRoot,
    bundledConfigDir: resolveBundledConfigDir(),
    runtime: null,
    queryWorker: null,
    searchRequestSeqByClient: new Map(),
    previewWorker: null,
    writerWorker: null,
    listeners: new Set(),
    eventHistory: [],
    progressTimers: new Map(),
    lastProgressAt: new Map(),
    fileOperationTail: Promise.resolve(),
    thumbnailRequests: new Map(),
    systemLog,
    libraryRemovalProgress: new Map(),
    planExecutionProgress: null,
    duplicateAnalysisProgress: null,
    emit(event, payload) {
      const progressKey = progressStreamKey(event, payload)
      if (progressKey) {
        const status = payload && typeof payload === 'object'
          ? (payload as { status?: unknown; phase?: unknown }).status
          : undefined
        const terminal = status === 'completed' || status === 'failed' || status === 'cancelled'
          || (event === 'scan.progress' && (payload as { phase?: unknown } | null)?.phase === 'idle')
        const timer = state.progressTimers.get(progressKey)
        if (terminal && timer) {
          clearTimeout(timer)
          state.progressTimers.delete(progressKey)
          state.lastProgressAt.delete(progressKey)
        }
        const last = state.lastProgressAt.get(progressKey) ?? 0
        if (!terminal && Date.now() - last < 80) {
          if (timer) clearTimeout(timer)
          state.progressTimers.set(progressKey, setTimeout(() => {
            state.progressTimers.delete(progressKey)
            state.emit(event, payload)
          }, 80))
          return
        }
        state.lastProgressAt.set(progressKey, Date.now())
      }
      logSystemEvent(state.systemLog, event, payload)
      const envelope: SidecarEventEnvelope = {
        seq: ++eventSequence,
        event,
        payload,
        createdAt: Date.now(),
      }
      state.eventHistory.push(envelope)
      if (state.eventHistory.length > EVENT_HISTORY_LIMIT) {
        state.eventHistory.splice(0, state.eventHistory.length - EVENT_HISTORY_LIMIT)
      }
      for (const listener of state.listeners) listener(envelope)
    },
    workerPath(name) {
      if (process.env.NESTIFY_WORKER_DIR) return join(process.env.NESTIFY_WORKER_DIR, name)
      return join(sidecarDir, '..', 'dist-runtime', name)
    },
    mediaMergeWorkerFactory(workerPath) {
      return new MediaMergeWorkerClient(workerPath, {
        ffmpegPath: process.env.NESTIFY_FFMPEG_PATH,
        ffprobePath: process.env.NESTIFY_FFPROBE_PATH,
      }, logSidecar)
    },
    query() {
      const runtime = requireRuntime(state)
      state.queryWorker ??= new QueryWorkerClient(
        state.workerPath('query-worker.mjs'),
        runtime.paths.dbPath,
        logSidecar,
      )
      return state.queryWorker
    },
    preview() {
      const runtime = requireRuntime(state)
      state.previewWorker ??= new PreviewWorkerClient(
        state.workerPath('preview-worker.mjs'),
        runtime.paths.dbPath,
        runtime.paths.quarantineDir,
        logSidecar,
      )
      return state.previewWorker
    },
    writers() {
      const runtime = requireRuntime(state)
      if (!state.writerWorker) {
        state.writerWorker = new WriterWorkerClient(
          state.workerPath('writer-worker.mjs'),
          runtime.paths.dbPath,
          logSidecar,
        )
        state.writerWorker.onError = (event, error) => state.systemLog.log(event, error, 'error')
        state.writerWorker.onSynced = ({ libraryId, count }) => {
          state.systemLog.log('index.synced', { libraryId, count })
          state.emit('sync.updated', { libraryId, count })
        }
      }
      return state.writerWorker
    },
    startWriters() {
      const runtime = requireRuntime(state)
      const worker = state.writers()
      const libraries = runtime.listLibraries()
      for (const library of libraries) {
        worker.start(libraryConfig(library), { initialReconcile: true })
      }
      state.systemLog.log('writer.libraries.started', { count: libraries.length })
    },
    serveAsset(url, request, response) {
      return serveAsset(state, url, request, response)
    },
    async close() {
      state.systemLog.log('sidecar.close.start')
      for (const timer of state.progressTimers.values()) clearTimeout(timer)
      state.progressTimers.clear()
      await state.queryWorker?.close()
      await state.previewWorker?.close()
      await state.writerWorker?.close()
      if (state.runtime) {
        state.systemLog.log('runtime.shutdown.start')
        try {
          await state.runtime.shutdown()
          state.systemLog.log('runtime.shutdown.finished')
        } catch (error) {
          state.systemLog.log('runtime.shutdown.failed', error, 'error')
          throw error
        } finally {
          state.runtime = null
        }
      }
      state.systemLog.log('sidecar.close.finished')
      await state.systemLog.flush()
    },
  }
  return state
}

export function requireRuntime(state: HostState): NestifyRuntime {
  if (!state.runtime) throw new Error('Nestify sidecar runtime is not ready')
  return state.runtime
}

function progressStreamKey(event: string, payload: unknown): string | null {
  if (!THROTTLED_PROGRESS_EVENTS.has(event)) return null
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const streamId = value.jobId ?? value.requestId ?? value.libraryId
  return typeof streamId === 'string' && streamId ? `${event}:${streamId}` : event
}

export function logSidecar(event: string, details?: unknown, level: 'info' | 'warn' | 'error' = 'info'): void {
  activeSystemLogger?.log(event, details, level)
}

function logSystemEvent(logger: SystemLogger, event: string, payload: unknown): void {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  if (!value) return

  if (event === 'mediaMerge.progress' || event === 'plan.execution-progress' || event === 'duplicates.analysis-progress') {
    const status = typeof value.status === 'string' ? value.status : ''
    if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') return
    const finishEvent = event === 'mediaMerge.progress'
      ? 'mediaMerge.finished'
      : event === 'plan.execution-progress'
        ? 'plan.execution.finished'
        : 'duplicates.analysis.finished'
    logger.log(finishEvent, {
      jobId: typeof value.jobId === 'string' ? value.jobId : null,
      status,
      error: typeof value.error === 'string' ? value.error : null,
      outputPath: typeof value.outputPath === 'string' ? value.outputPath : null,
    }, status === 'failed' ? 'error' : 'info')
    return
  }

  if (event === 'library.removal-progress') {
    const status = typeof value.status === 'string' ? value.status : ''
    if (status !== 'completed' && status !== 'failed') return
    logger.log('library.removal.finished', {
      jobId: typeof value.jobId === 'string' ? value.jobId : null,
      libraryId: typeof value.libraryId === 'string' ? value.libraryId : null,
      status,
      error: typeof value.error === 'string' ? value.error : null,
    }, status === 'failed' ? 'error' : 'info')
  }
}

function defaultAppDataRoot(): string {
  if (process.env.NESTIFY_APPDATA) return process.env.NESTIFY_APPDATA
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Nestify')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Nestify')
  return join(homedir(), '.config', 'Nestify')
}

function resolveBundledConfigDir(): string {
  if (process.env.NESTIFY_CONFIG_DIR) return process.env.NESTIFY_CONFIG_DIR
  const seeds = [
    join(process.cwd(), 'config'),
    join(sidecarDir, '..', '..', '..', 'config'),
    join(process.env.NESTIFY_RESOURCE_DIR ?? '', 'config'),
    join(process.resourcesPath ?? '', 'config'),
    join(process.resourcesPath ?? '', 'resources', 'config'),
  ]
  return seeds.find((dir) => existsSync(join(dir, 'app.default.yaml'))) ?? join(process.cwd(), 'config')
}

function libraryConfig(library: ReturnType<NestifyRuntime['listLibraries']>[number]) {
  return {
    id: library.id,
    roots: library.roots,
    excludeGlobs: library.excludeGlobs,
    maxDepth: library.maxDepth,
    followSymlinks: library.followSymlinks,
    scanHidden: library.scanHidden,
  }
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

async function serveAsset(state: HostState, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (url.pathname === '/media') {
    const filePath = url.searchParams.get('path') ?? ''
    const extension = extname(filePath).toLowerCase()
    if (!isAbsolute(filePath) || (!IMAGE_EXT.has(extension) && !VIDEO_EXT.has(extension))) {
      response.writeHead(400).end()
      return
    }
    await serveFile(request, response, filePath, MIME[extension] ?? 'application/octet-stream')
    return
  }
  const filename = decodeURIComponent(url.pathname.slice('/thumbnail/'.length))
  if (!/^[a-f0-9]{64}\.(?:jpg|webp)$/.test(filename)) {
    response.writeHead(404).end()
    return
  }
  const runtime = requireRuntime(state)
  const cachePath = resolve(runtime.paths.thumbnailsDir, filename)
  if (!cachePath.startsWith(resolve(runtime.paths.thumbnailsDir) + sep)) {
    response.writeHead(404).end()
    return
  }
  await serveFile(request, response, cachePath, filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg')
}

async function serveFile(request: IncomingMessage, response: ServerResponse, filePath: string, mime: string): Promise<void> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) {
    response.writeHead(404).end()
    return
  }
  const range = parseRange(request.headers.range, info.size)
  if (range === 'invalid') {
    response.writeHead(416, { 'content-range': `bytes */${info.size}` }).end()
    return
  }
  const status = range ? 206 : 200
  const headers: Record<string, string | number> = {
    'accept-ranges': 'bytes',
    'content-type': mime,
    'content-length': range ? range.end - range.start + 1 : info.size,
  }
  if (range) headers['content-range'] = `bytes ${range.start}-${range.end}/${info.size}`
  response.writeHead(status, headers)
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream: ReadStream = range ? createReadStream(filePath, range) : createReadStream(filePath)
  stream.pipe(response)
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) return 'invalid'
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  if (!startText && !endText) return 'invalid'
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - Math.min(size, suffix)), end: size - 1 }
  }
  const start = Number(startText)
  const end = endText ? Number(endText) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return 'invalid'
  return { start, end: Math.min(end, size - 1) }
}
