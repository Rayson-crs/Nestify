import { Worker } from 'node:worker_threads'

type QueryWorkerResponse = {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

type QueryWorkerReady = {
  type: 'ready'
  startupMs: number
  pragmaMs: number
}

type QueryWorkerMessage = QueryWorkerResponse | QueryWorkerReady

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  kind: 'search' | 'directory'
}

export class QueryWorkerClient {
  private searchWorker: Worker | null = null
  private directoryWorker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly ready = new Map<PendingRequest['kind'], Promise<void>>()
  private readonly readyReject = new Map<PendingRequest['kind'], (error: Error) => void>()
  private readonly workerPath: string
  private readonly dbPath: string

  constructor(workerPath: string, dbPath: string) {
    this.workerPath = workerPath
    this.dbPath = dbPath
  }

  search<T>(request: unknown): Promise<T> {
    return this.send<T>('search', { type: 'search', request })
  }

  directory<T>(libraryId: string, directory: string, options: unknown): Promise<T> {
    return this.send<T>('directory', { type: 'directory', libraryId, directory, options })
  }

  cancel(): void {
    const worker = this.searchWorker
    this.searchWorker = null
    if (worker) void worker.terminate()
    this.rejectPending(new Error('query cancelled'), 'search')
  }

  hasPending(kind: PendingRequest['kind']): boolean {
    for (const pending of this.pending.values()) {
      if (pending.kind === kind) return true
    }
    return false
  }

  async prewarmDirectories(
    targets: Array<{ libraryId: string; directory: string }>,
  ): Promise<void> {
    this.ensureWorker('search')
    this.ensureWorker('directory')
    await Promise.all([this.waitForReady('search'), this.waitForReady('directory')])
    for (const target of targets) {
      await this.directory(target.libraryId, target.directory, { limit: 1 })
    }
  }

  async close(): Promise<void> {
    const workers = [this.searchWorker, this.directoryWorker].filter((worker): worker is Worker => worker != null)
    this.searchWorker = null
    this.directoryWorker = null
    this.rejectPending(new Error('query worker closed'))
    this.rejectReady('search', new Error('query worker closed'))
    this.rejectReady('directory', new Error('query worker closed'))
    await Promise.all(workers.map((worker) => worker.terminate()))
  }

  private send<T>(kind: PendingRequest['kind'], payload: Record<string, unknown>): Promise<T> {
    const worker = this.ensureWorker(kind)
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, kind })
      try {
        worker.postMessage({ id, ...payload })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  private ensureWorker(kind: PendingRequest['kind']): Worker {
    const current = this.getWorker(kind)
    if (current) return current
    const worker = new Worker(this.workerPath, {
      type: 'module',
      workerData: { dbPath: this.dbPath },
      execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
    })
    let resolveReady: () => void = () => {}
    let rejectReady: (error: Error) => void = () => {}
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    this.ready.set(kind, readyPromise)
    this.readyReject.set(kind, rejectReady)
    worker.on('message', (message: QueryWorkerMessage) => {
      if (message.type === 'ready') {
        resolveReady()
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error ?? 'query worker request failed'))
    })
    worker.on('error', (error) => this.handleWorkerFailure(kind, worker, error))
    worker.on('exit', (code) => {
      if (this.getWorker(kind) === worker) {
        this.setWorker(kind, null)
        if (code !== 0) this.rejectPending(new Error(`query worker exited with code ${code}`), kind)
        this.rejectReady(kind, new Error(`query worker exited with code ${code}`))
      }
    })
    this.setWorker(kind, worker)
    return worker
  }

  private handleWorkerFailure(kind: PendingRequest['kind'], worker: Worker, error: Error): void {
    if (this.getWorker(kind) === worker) {
      this.setWorker(kind, null)
      this.rejectReady(kind, error)
      void worker.terminate()
    }
    this.rejectPending(error, kind)
  }

  private rejectReady(kind: PendingRequest['kind'], error: Error): void {
    this.readyReject.get(kind)?.(error)
    this.ready.delete(kind)
    this.readyReject.delete(kind)
  }

  private rejectPending(error: Error, kind?: PendingRequest['kind']): void {
    for (const [id, pending] of this.pending) {
      if (kind && pending.kind !== kind) continue
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private getWorker(kind: PendingRequest['kind']): Worker | null {
    return kind === 'search' ? this.searchWorker : this.directoryWorker
  }

  private setWorker(kind: PendingRequest['kind'], worker: Worker | null): void {
    if (kind === 'search') this.searchWorker = worker
    else this.directoryWorker = worker
  }

  private waitForReady(kind: PendingRequest['kind']): Promise<void> {
    this.ensureWorker(kind)
    return this.ready.get(kind) ?? Promise.resolve()
  }
}
