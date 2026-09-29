import { Worker } from 'node:worker_threads'

type PreviewWorkerMessage = {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

type WorkerLog = (event: string, details?: unknown, level?: 'info' | 'warn' | 'error') => void

export class PreviewWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>()
  private readonly workerPath: string
  private readonly dbPath: string
  private readonly quarantineDir: string
  private readonly onLog: WorkerLog | null

  constructor(
    workerPath: string,
    dbPath: string,
    quarantineDir: string,
    onLog: WorkerLog | null = null,
  ) {
    this.workerPath = workerPath
    this.dbPath = dbPath
    this.quarantineDir = quarantineDir
    this.onLog = onLog
  }

  request<T>(type: 'rules' | 'rename' | 'organize' | 'organize-snapshot', input: unknown): Promise<T> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        worker.postMessage({ id, type, input })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async close(): Promise<void> {
    const worker = this.worker
    this.worker = null
    for (const request of this.pending.values()) request.reject(new Error('preview worker closed'))
    this.pending.clear()
    if (worker) this.onLog?.('worker.close', { type: 'preview' })
    if (worker) await worker.terminate()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(this.workerPath, {
      type: 'module',
      workerData: { dbPath: this.dbPath, quarantineDir: this.quarantineDir },
      execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
    })
    this.onLog?.('worker.start', { type: 'preview' })
    worker.on('online', () => this.onLog?.('worker.ready', { type: 'preview' }))
    worker.on('message', (message: PreviewWorkerMessage) => {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.ok) request.resolve(message.result)
      else request.reject(new Error(message.error ?? 'preview worker request failed'))
    })
    const fail = (error: Error) => {
      if (this.worker !== worker) return
      this.onLog?.('worker.error', { type: 'preview', error }, 'error')
      this.worker = null
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear()
    }
    worker.on('error', fail)
    worker.on('exit', (code) => {
      if (this.worker === worker) {
        this.onLog?.('worker.exit', { type: 'preview', code, expected: false }, 'error')
      } else {
        this.onLog?.('worker.exit', { type: 'preview', code, expected: true })
      }
      fail(new Error(`preview worker exited with code ${code}`))
    })
    this.worker = worker
    return worker
  }
}
