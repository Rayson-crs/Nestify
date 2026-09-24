import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { runScan, RuntimePauseGate, type ScanResult } from '@nestify/core'

type ScanInput = {
  jobId: string
  libraryId: string
  concurrency?: number
}

type WorkerRequest =
  | { id: number; type: 'execute'; input: ScanInput }
  | { id: number; type: 'pause'; jobId: string }
  | { id: number; type: 'resume'; jobId: string }
  | { id: number; type: 'cancel'; jobId: string }
  | { id: number; type: 'close' }

type WorkerResponse =
  | { id: number; type: 'progress'; jobId: string; progress: unknown }
  | { id: number; type: 'result'; result: ScanResult }
  | { id: number; type: 'error'; error: string }
  | { id: number; type: 'ack' }
  | { id: number; type: 'closed' }

const port = parentPort
if (!port) throw new Error('scan-worker requires a worker parent port')
const dbPath = workerData?.dbPath
if (typeof dbPath !== 'string' || dbPath.length === 0) throw new Error('scan-worker requires a database path')

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000; PRAGMA synchronous = NORMAL;')

let current: {
  jobId: string
  abort: AbortController
  gate: RuntimePauseGate
} | null = null
let closed = false

port.on('message', (message: WorkerRequest) => {
  if (message.type === 'pause' || message.type === 'resume' || message.type === 'cancel') {
    const active = current?.jobId === message.jobId ? current : null
    if (message.type === 'pause') active?.gate.pause()
    else if (message.type === 'resume') active?.gate.resume()
    else {
      active?.gate.cancel()
      active?.abort.abort()
    }
    port.postMessage({ id: message.id, type: 'ack' })
    return
  }

  if (message.type === 'close') {
    closed = true
    current?.gate.cancel()
    current?.abort.abort()
    db.close()
    port.postMessage({ id: message.id, type: 'closed' })
    port.close()
    return
  }

  void executeScan(message.id, message.input).catch((error: unknown) => {
    port.postMessage({
      id: message.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  })
})

async function executeScan(id: number, input: ScanInput): Promise<void> {
  if (closed) throw new Error('scan worker is closed')
  if (current) throw new Error('another scan is active')
  const abort = new AbortController()
  const gate = new RuntimePauseGate()
  current = { jobId: input.jobId, abort, gate }
  try {
    const result = await runScan(
      db,
      {
        roots: libraryRoots(input.libraryId),
        incremental: true,
      },
      {
        libraryId: input.libraryId,
        abortSignal: abort.signal,
        pauseGate: gate,
        concurrency: input.concurrency,
        onProgress: (progress) => {
          port.postMessage({
            id,
            type: 'progress',
            jobId: input.jobId,
            progress: { ...progress, paused: gate.isPaused() },
          })
        },
      },
    )
    port.postMessage({ id, type: 'result', result })
  } finally {
    current = null
  }
}

function libraryRoots(libraryId: string): string[] {
  const library = db
    .prepare('SELECT roots_json FROM libraries WHERE id = ?')
    .get(libraryId) as { roots_json: string } | undefined
  if (!library) throw new Error(`library not found: ${libraryId}`)
  const roots = JSON.parse(library.roots_json) as unknown
  if (!Array.isArray(roots) || !roots.every((root) => typeof root === 'string')) {
    throw new Error(`library has invalid roots: ${libraryId}`)
  }
  return roots
}
