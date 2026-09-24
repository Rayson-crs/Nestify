import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { NestifyRuntime } from '../../../packages/core/src/index.ts'
import { handleRpc, type HostContext } from './handlers.ts'
import { configureBundledMediaTools } from './media-tools.ts'
import {
  applySystemLogSettings,
  applyFfmpegDirectory,
  readSettings,
  type DesktopSettings,
} from './settings.ts'
import { createHostState, logSidecar } from './state.ts'
import { ScanWorkerClient } from '../runtime/scan-worker-client.ts'

const state = createHostState()
state.systemLog.log('sidecar.start', {
  node: process.version,
  platform: process.platform,
  appDataRoot: state.appDataRoot,
})
const mediaTools = configureBundledMediaTools()
logSidecar('media-tools.configured', mediaTools)

const server = createServer((request, response) => {
  void route(request, response)
})
server.on('error', (error) => {
  state.systemLog.log('http.server.error', error, 'error')
})

void start()

async function start(): Promise<void> {
  try {
    await initializeRuntime()
  } catch (error) {
    logSidecar('runtime.failed', error, 'error')
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`Nestify sidecar failed to initialize: ${detail}\n`)
    process.exitCode = 1
    return
  }

  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      state.systemLog.log('http.server.bind-failed', { address }, 'error')
      process.stderr.write('Nestify sidecar failed to bind a local port\n')
      process.exitCode = 1
      return
    }
    state.port = address.port
    logSidecar('http.server.ready', { port: state.port, host: '127.0.0.1' })
    process.stdout.write(`NESTIFY_SIDECAR_READY ${address.port}\n`)
  })
}

async function initializeRuntime(): Promise<void> {
  logSidecar('settings.load.start')
  let settings: DesktopSettings
  try {
    settings = await readSettings(state.appDataRoot)
  } catch (error) {
    logSidecar('settings.load.failed', error, 'error')
    throw error
  }
  logSidecar('settings.load.finished', {
    ffmpegConfigured: Boolean(settings.ffmpegDirectory),
    logDirectoryConfigured: Boolean(settings.auditLogDirectory),
    scanConcurrency: settings.scanConcurrency,
  })
  await applySystemLogSettings(settings, state)
  applyFfmpegDirectory(settings.ffmpegDirectory, state)
  state.runtime = new NestifyRuntime({
    appDataRoot: state.appDataRoot,
    bundledConfigDir: state.bundledConfigDir,
    onStartupLog: logSidecar,
    fileSync: false,
    mediaMergeWorkerPath: state.workerPath('media-merge-worker.mjs'),
    mediaMergeWorkerFactory: state.mediaMergeWorkerFactory,
    scanWorkerFactory: () => new ScanWorkerClient(
      state.workerPath('scan-worker.mjs'),
      state.runtime?.paths.dbPath ?? '',
      logSidecar,
    ),
  })
  state.runtime.setScanConcurrency(settings.scanConcurrency)
  state.runtime.onMediaMergeProgress((progress) => {
    state.emit('mediaMerge.progress', progress)
  })
  state.runtime.onScanProgress((progress) => {
    state.emit('scan.progress', progress)
  })
  state.runtime.onScanFinished((libraryId) => {
    const progress = state.runtime?.getScanProgress()
    // Long-running query workers keep their own SQLite read connections. Drop
    // them at the scan boundary so the next UI query cannot observe an old WAL
    // snapshot or return a stale pending result.
    state.queryWorker?.cancel('search')
    state.queryWorker?.cancel('directory')
    state.emit('scan.finished', {
      libraryId,
      filesScanned: progress?.filesScanned ?? 0,
      dirsScanned: progress?.dirsScanned ?? 0,
      errors: progress?.errors ?? 0,
    })
    logSidecar('scan.finished', {
      libraryId,
      jobId: progress?.jobId ?? null,
      filesScanned: progress?.filesScanned ?? 0,
      dirsScanned: progress?.dirsScanned ?? 0,
      errors: progress?.errors ?? 0,
    }, progress?.errors ? 'warn' : 'info')
  })
  state.startWriters()
    logSidecar('runtime.ready', { port: state.port })
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestId = randomUUID()
  let method = ''
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/events') {
      streamEvents(request, response)
      return
    }
    if (request.method === 'GET' && (url.pathname === '/media' || url.pathname.startsWith('/thumbnail/'))) {
      await state.serveAsset(url, request, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/rpc') {
      const body = JSON.parse(await readBody(request)) as { id?: unknown; method?: unknown; params?: unknown }
      method = String(body.method ?? '')
      const startedAt = Date.now()
      state.systemLog.log('rpc.request', {
        requestId,
        method,
        action: rpcAction(method),
        params: auditRpcParams(method, body.params),
      })
      const context: HostContext = state
      const result = await handleRpc(context, method, body.params)
      state.systemLog.log('rpc.success', {
        requestId,
        method,
        action: rpcAction(method),
        elapsedMs: Date.now() - startedAt,
        result: auditResult(method, result),
      })
      sendJson(response, 200, { id: body.id ?? null, ok: true, result })
      return
    }
    sendJson(response, 404, { ok: false, error: 'not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.systemLog.log('rpc.failed', {
      requestId,
      method,
      path: request.url ?? '',
      error: error instanceof Error ? error : { message },
    }, 'error')
    sendJson(response, 200, { ok: false, error: message })
  }
}

function rpcAction(method: string): string {
  if (method === 'search.query' || method === 'directory.children') return 'search'
  if (method.startsWith('preview.') || method.startsWith('mediaMerge.')) return 'preview-or-media'
  if ([
    'scan.start',
    'scan.pause',
    'scan.resume',
    'scan.cancel',
    'plan.execute',
    'plan.rollback',
    'jobs.clear',
    'library.add',
    'library.update',
    'library.remove',
    'rules.create',
    'rules.update',
    'rules.delete',
    'rules.enable',
    'rules.priority',
    'rules.clone',
    'rules.import',
    'rules.export',
    'duplicates.analyze',
    'file.rename',
    'file.move',
    'file.delete',
    'mediaMerge.start',
    'mediaMerge.cancel',
    'mediaMerge.resume',
  ].includes(method)) return 'execute'
  if (method.startsWith('settings.')) return 'settings'
  return 'read'
}

function auditRpcParams(method: string, params: unknown): unknown {
  const input = asRecord(params)
  if (method === 'plan.execute') {
    const plan = asRecord(input.plan)
    const summary = asRecord(plan.summary)
    return {
      libraryId: input.libraryId,
      module: input.module,
      selectedOpsCount: Array.isArray(input.selectedOps) ? input.selectedOps.length : undefined,
      planId: plan.id,
      planSummary: summary,
      planOpCount: Array.isArray(plan.ops) ? plan.ops.length : undefined,
    }
  }
  if (method === 'mediaMerge.start') {
    const plan = asRecord(input.plan)
    const summary = asRecord(plan.summary)
    return {
      outputPath: plan.outputPath,
      itemCount: Array.isArray(plan.items) ? plan.items.length : undefined,
      summary,
    }
  }
  if (method === 'mediaMerge.buildPlan') {
    return {
      kind: input.kind,
      itemCount: Array.isArray(input.items) ? input.items.length : undefined,
      outputDirectory: input.outputDirectory,
      outputName: input.outputName,
    }
  }
  if (method === 'log.event') return input
  if (method === 'organize.preview' || method === 'rename.preview' || method === 'rules.preview') {
    return {
      ...input,
      rules: Array.isArray(input.rules) ? { count: input.rules.length } : input.rules,
      groups: Array.isArray(input.groups) ? { count: input.groups.length } : input.groups,
      entryIds: Array.isArray(input.entryIds) ? { count: input.entryIds.length } : input.entryIds,
    }
  }
  if (method === 'duplicates.analyze') {
    return {
      ...input,
      entryIds: Array.isArray(input.entryIds) ? { count: input.entryIds.length } : input.entryIds,
    }
  }
  if (method === 'mediaMerge.filesFromPaths') {
    return { paths: Array.isArray(input.paths) ? { count: input.paths.length } : undefined }
  }
  return compactParams(input)
}

function auditResult(method: string, result: unknown): unknown {
  const value = asRecord(result)
  if (method === 'search.query') {
    const search = asRecord(value.result)
    return {
      total: search.total,
      hitCount: Array.isArray(search.hits) ? search.hits.length : undefined,
      elapsedMs: search.elapsedMs,
      hasMore: search.hasMore,
    }
  }
  if (method === 'jobs.list') {
    return { count: Array.isArray(value.jobs) ? value.jobs.length : undefined }
  }
  if (method === 'job.ops') {
    return { total: value.total, offset: value.offset, limit: value.limit }
  }
  if (method === 'library.list') {
    return { count: Array.isArray(value.libraries) ? value.libraries.length : undefined }
  }
  if (method === 'rules.list') {
    return { count: Array.isArray(value.ruleSets) ? value.ruleSets.length : undefined }
  }
  if (method === 'jobs.clear') return value
  if (value && typeof value === 'object') return { keys: Object.keys(value).slice(0, 30) }
  return value
}

function compactParams(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).slice(0, 60)) {
    const item = value[key]
    if (Array.isArray(item)) result[key] = { count: item.length }
    else if (item && typeof item === 'object' && depth < 2) result[key] = compactParams(item, depth + 1)
    else if (typeof item === 'string' && item.length > 1000) result[key] = `${item.slice(0, 1000)}...`
    else result[key] = item
  }
  return result
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function streamEvents(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  response.flushHeaders()
  const heartbeat = setInterval(() => {
    response.write(': heartbeat\n\n')
  }, 10_000)
  const listener = (event: {
    seq: number
    event: string
    payload: unknown
    createdAt: number
  }) => {
    response.write(`id: ${event.seq}\n`)
    response.write('event: nestify-event\n')
    response.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  state.listeners.add(listener)
  const rawLastEventId = request.headers['last-event-id']
  const lastEventIdText = Array.isArray(rawLastEventId) ? rawLastEventId[0] : rawLastEventId
  if (typeof lastEventIdText === 'string' && lastEventIdText.trim()) {
    const replayAfter = Number(lastEventIdText)
    if (Number.isSafeInteger(replayAfter) && replayAfter >= 0) {
      for (const event of state.eventHistory) {
        if (event.seq > replayAfter) listener(event)
      }
    }
  }
  response.on('close', () => {
    clearInterval(heartbeat)
    state.listeners.delete(listener)
  })
  response.on('error', () => response.destroy())
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    state.systemLog.log('sidecar.signal', { signal })
    void shutdown().finally(() => process.exit(0))
  })
}

process.on('unhandledRejection', (reason) => {
  state.systemLog.log('process.unhandledRejection', reason, 'error')
})

process.on('uncaughtException', (error) => {
  state.systemLog.log('process.uncaughtException', error, 'error')
  void state.systemLog.flush().finally(() => process.exit(1))
})

async function shutdown(): Promise<void> {
  state.systemLog.log('sidecar.shutdown.start', { port: state.port })
  await state.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  state.systemLog.log('sidecar.shutdown.finished', { port: state.port })
  await state.systemLog.flush()
}
