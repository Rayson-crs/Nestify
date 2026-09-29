import { Worker } from 'node:worker_threads'

type LibraryConfig = {
  id: string
  roots: readonly string[]
  excludeGlobs: readonly string[]
  maxDepth: number | null
  followSymlinks: boolean
  scanHidden: boolean
}

type WriterResponse = {
  id?: number
  type: 'ack' | 'closed' | 'error' | 'synced'
  message?: string
  libraryId?: string
  count?: number
}

type WorkerLog = (event: string, details?: unknown, level?: 'info' | 'warn' | 'error') => void

export class WriterWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly libraries = new Map<string, LibraryConfig>()
  private readonly initialReconcile = new Map<string, boolean>()
  private readonly controlRequests = new Map<number, { resolve: () => void; reject: (reason?: unknown) => void }>()
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private closing = false
  private readonly workerPath: string
  private readonly dbPath: string
  private readonly onLog: WorkerLog | null
  /** 索引有实际更新时触发（watcher 捕获到文件变更并处理完）。 */
  onSynced: ((payload: { libraryId: string; count: number }) => void) | null = null
  onError: ((event: string, error: unknown) => void) | null = null

  constructor(workerPath: string, dbPath: string, onLog: WorkerLog | null = null) {
    this.workerPath = workerPath
    this.dbPath = dbPath
    this.onLog = onLog
  }

  start(library: LibraryConfig, options: { initialReconcile?: boolean } = {}): void {
    this.libraries.set(library.id, library)
    this.initialReconcile.set(library.id, options.initialReconcile !== false)
    this.onLog?.('worker.library.start', {
      libraryId: library.id,
      roots: library.roots,
      initialReconcile: options.initialReconcile !== false,
    })
    this.send({ type: 'start', library, initialReconcile: options.initialReconcile })
  }

  async stop(libraryId: string): Promise<void> {
    this.libraries.delete(libraryId)
    this.initialReconcile.delete(libraryId)
    this.onLog?.('worker.library.stop', { libraryId })
    try {
      await this.withTimeout(this.request({ type: 'stop', libraryId }), 2_000)
    } catch {
      // A stalled reconciliation can otherwise prevent scans from ever starting.
      await this.terminateWorker()
      this.restartConfiguredLibraries()
    }
  }

  schedule(libraryId: string): void {
    if (this.worker) this.send({ type: 'schedule', libraryId })
  }

  async close(): Promise<void> {
    this.closing = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const worker = this.worker
    this.worker = null
    if (!worker) return
    this.onLog?.('worker.close', { type: 'writer' })
    await new Promise<void>((resolve) => {
      const id = this.nextId++
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.controlRequests.delete(id)
        resolve()
      }
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        this.controlRequests.delete(id)
        void worker.terminate().finally(resolve)
      }, 1000)
      this.controlRequests.set(id, { resolve: settle, reject: settle })
      try {
        worker.postMessage({ id, type: 'close' })
      } catch {
        settle()
      }
    })
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    if (this.closing) throw new Error('writer worker is closed')
    const worker = new Worker(this.workerPath, {
      type: 'module',
      workerData: { dbPath: this.dbPath },
      execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
    })
    this.onLog?.('worker.start', { type: 'writer' })
    worker.on('online', () => this.onLog?.('worker.ready', { type: 'writer' }))
    worker.on('message', (message: WriterResponse) => {
      if (message.type === 'synced' && message.libraryId) {
        this.onSynced?.({ libraryId: message.libraryId, count: message.count ?? 0 })
        return
      }
      if (message.id == null) return
      const request = this.controlRequests.get(message.id)
      if (!request) return
      this.controlRequests.delete(message.id)
      if (message.type === 'error') request.reject(new Error(message.message ?? 'writer worker request failed'))
      else request.resolve()
    })
    worker.on('error', (error) => {
      console.error('[Nestify Writer Worker]', error)
      this.onError?.('writer.worker.error', error)
      this.handleFailure(worker, error)
    })
    worker.on('exit', () => {
      if (this.worker === worker) {
        const error = new Error('writer worker exited')
        this.onLog?.('worker.exit', { type: 'writer', expected: false }, 'error')
        this.onError?.('writer.worker.error', error)
        this.handleFailure(worker, error)
      }
    })
    this.worker = worker
    return worker
  }

  private send(message: { type: 'start'; library: LibraryConfig; initialReconcile?: boolean } | { type: 'schedule'; libraryId: string }): void {
    const worker = this.ensureWorker()
    try {
      worker.postMessage({ id: this.nextId++, ...message })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.onError?.('writer.worker.send-failed', failure)
      this.handleFailure(worker, failure)
    }
  }

  private request(message: { type: 'stop'; libraryId: string }): Promise<void> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise<void>((resolve, reject) => {
      this.controlRequests.set(id, { resolve, reject })
      try {
        worker.postMessage({ id, ...message })
      } catch (error) {
        this.controlRequests.delete(id)
        reject(error)
      }
    })
  }

  private withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('writer worker stop timed out')), milliseconds)
      }),
    ])
  }

  private async terminateWorker(): Promise<void> {
    const worker = this.worker
    this.worker = null
    for (const request of this.controlRequests.values()) request.reject(new Error('writer worker was terminated'))
    this.controlRequests.clear()
    if (worker) await worker.terminate()
  }

  private restartConfiguredLibraries(): void {
    if (this.libraries.size === 0) return
    const worker = this.ensureWorker()
    for (const library of this.libraries.values()) {
      worker.postMessage({
        type: 'start',
        library,
        initialReconcile: this.initialReconcile.get(library.id) ?? true,
      })
    }
  }

  private handleFailure(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = null
    for (const request of this.controlRequests.values()) request.reject(error)
    this.controlRequests.clear()
    if (this.closing) return
    this.restartTimer ??= setTimeout(() => {
      this.restartTimer = null
      try {
        const restarted = this.ensureWorker()
        for (const library of this.libraries.values()) {
          restarted.postMessage({
            type: 'start',
            library,
            initialReconcile: this.initialReconcile.get(library.id) ?? true,
          })
        }
      } catch (restartError) {
        console.error('[Nestify Writer Worker] restart failed', restartError)
        this.onError?.('writer.worker.restart-failed', restartError)
      }
    }, 250)
  }
}
