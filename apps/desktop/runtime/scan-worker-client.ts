import { Worker } from 'node:worker_threads'

export type ScanWorkerProgress = {
  phase: string
  paused?: boolean
  filesScanned: number
  dirsScanned: number
  bytesScanned: number
  currentPath?: string
  errors: number
  filesPerSecond?: number
}

export type ScanWorkerResult = {
  filesScanned: number
  dirsScanned: number
  errors: number
  errorDetails?: Array<{ path: string; operation: string; message: string; code?: string }>
  errorSummary?: Record<string, number>
}

type WorkerRequest =
  | { id: number; type: 'execute'; input: { jobId: string; libraryId: string; concurrency?: number } }
  | { id: number; type: 'pause'; jobId: string }
  | { id: number; type: 'resume'; jobId: string }
  | { id: number; type: 'cancel'; jobId: string }
  | { id: number; type: 'close' }

type WorkerResponse =
  | { id: number; type: 'progress'; jobId: string; progress: ScanWorkerProgress }
  | { id: number; type: 'result'; result: ScanWorkerResult }
  | { id: number; type: 'error'; error: string }
  | { id: number; type: 'ack' }
  | { id: number; type: 'closed' }

interface PendingRequest {
  resolve: (value: ScanWorkerResult) => void
  reject: (reason?: unknown) => void
}

type WorkerLog = (event: string, details?: unknown, level?: 'info' | 'warn' | 'error') => void

export class ScanWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private progressListener: ((jobId: string, progress: ScanWorkerProgress) => void) | null = null
  private closing = false
  private readonly workerPath: string
  private readonly dbPath: string
  private readonly onLog: WorkerLog | null

  constructor(workerPath: string, dbPath: string, onLog: WorkerLog | null = null) {
    this.workerPath = workerPath
    this.dbPath = dbPath
    this.onLog = onLog
  }

  execute(input: {
    jobId: string
    libraryId: string
    concurrency?: number
    onProgress?: (progress: ScanWorkerProgress) => void
  }): Promise<ScanWorkerResult> {
    const previousListener = this.progressListener
    const { onProgress, ...workerInput } = input
    if (onProgress) {
      this.progressListener = (jobId, progress) => {
        if (jobId === workerInput.jobId) onProgress(progress)
      }
    }
    const id = this.nextId++
    return this.request({ id, type: 'execute', input: workerInput }).finally(() => {
      this.progressListener = previousListener
    })
  }

  pause(jobId: string): void {
    this.control({ type: 'pause', jobId })
  }

  resume(jobId: string): void {
    this.control({ type: 'resume', jobId })
  }

  cancel(jobId: string): void {
    this.control({ type: 'cancel', jobId })
  }

  async close(): Promise<void> {
    this.closing = true
    const worker = this.worker
    this.worker = null
    this.progressListener = null
    if (worker) this.onLog?.('worker.close', { type: 'scan' })
    if (worker) {
      await new Promise<void>((resolve) => {
        let settled = false
        const timeout = setTimeout(() => {
          if (settled) return
          settled = true
          void worker.terminate().finally(resolve)
        }, 1000)
        const settle = () => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve()
        }
        worker.once('message', (message: WorkerResponse) => {
          if (message.type === 'closed') settle()
        })
        worker.once('exit', settle)
        try {
          worker.postMessage({ id: this.nextId++, type: 'close' })
        } catch {
          settle()
        }
      })
    }
    this.rejectPending(new Error('scan worker closed'))
  }

  private control(message: Omit<WorkerRequest, 'id'> & { type: 'pause' | 'resume' | 'cancel' }): void {
    this.ensureWorker().postMessage({ id: this.nextId++, ...message })
  }

  private request(message: WorkerRequest): Promise<ScanWorkerResult> {
    const worker = this.ensureWorker()
    return new Promise<ScanWorkerResult>((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject })
      try {
        worker.postMessage(message)
      } catch (error) {
        this.pending.delete(message.id)
        reject(error)
      }
    })
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    if (this.closing) throw new Error('scan worker is closed')
    const worker = new Worker(this.workerPath, {
      type: 'module',
      workerData: { dbPath: this.dbPath },
      execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
    })
    this.onLog?.('worker.start', { type: 'scan' })
    worker.on('online', () => this.onLog?.('worker.ready', { type: 'scan' }))
    worker.on('message', (message: WorkerResponse) => {
      if (message.type === 'progress') {
        this.progressListener?.(message.jobId, message.progress)
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.type === 'result') pending.resolve(message.result)
      else if (message.type === 'error') pending.reject(new Error(message.error))
      else pending.resolve({ filesScanned: 0, dirsScanned: 0, errors: 0 })
    })
    const fail = (error: Error) => {
      if (this.worker !== worker) return
      this.onLog?.('worker.error', { type: 'scan', error }, 'error')
      this.worker = null
      this.rejectPending(error)
      this.progressListener = null
    }
    worker.on('error', fail)
    worker.on('exit', (code) => {
      if (this.worker === worker) {
        this.onLog?.('worker.exit', { type: 'scan', code, expected: false }, 'error')
        fail(new Error(`scan worker exited with code ${code}`))
      } else {
        this.onLog?.('worker.exit', { type: 'scan', code, expected: true })
      }
    })
    this.worker = worker
    return worker
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}
