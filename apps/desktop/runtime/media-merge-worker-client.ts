import { Worker } from 'node:worker_threads'
import type {
  MediaMergeDuration,
  MediaMergePlan,
  MediaMergePlanInput,
  MediaMergeProgress,
  MediaMergeTimeline,
  MediaMergeWaveform,
} from '@nestify/shared'
import { MediaMergeCancelledError, MediaMergeInterruptedError } from '../../../packages/core/src/media/errors.ts'
import type { MediaMergeResumeInput } from '../../../packages/core/src/media/resume.ts'

type WorkerSuccess = { id: number; ok: true; result: unknown }
type WorkerFailure = {
  id: number
  ok: false
  error: string
  interrupted?: boolean
  cancelled?: boolean
}
type WorkerProgress = { type: 'progress'; jobId: string; progress: MediaMergeProgress }
type WorkerMessage = WorkerSuccess | WorkerFailure | WorkerProgress

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

type WorkerLog = (event: string, details?: unknown, level?: 'info' | 'warn' | 'error') => void

export class MediaMergeWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly progressListeners = new Map<string, (progress: MediaMergeProgress) => void>()
  private readonly executeRequestIds = new Map<string, number>()
  private readonly workerPath: string
  private readonly mediaTools: { ffmpegPath?: string | null; ffprobePath?: string | null }
  private readonly onLog: WorkerLog | null

  constructor(
    workerPath: string,
    mediaTools: { ffmpegPath?: string | null; ffprobePath?: string | null } = {},
    onLog: WorkerLog | null = null,
  ) {
    this.workerPath = workerPath
    this.mediaTools = mediaTools
    this.onLog = onLog
  }

  plan(input: MediaMergePlanInput): Promise<MediaMergePlan> {
    return this.request('plan', input)
  }

  execute(input: {
    jobId: string
    plan: MediaMergePlan
    workspacePath: string
    resume?: MediaMergeResumeInput
    onProgress?: (progress: MediaMergeProgress) => void
  }): Promise<{ outputPath: string; warnings?: string[] }> {
    if (input.onProgress) this.progressListeners.set(input.jobId, input.onProgress)
    return this.request('execute', {
      jobId: input.jobId,
      plan: input.plan,
      workspacePath: input.workspacePath,
      resume: input.resume,
    }, input.jobId).finally(() => {
      this.progressListeners.delete(input.jobId)
      this.executeRequestIds.delete(input.jobId)
    })
  }

  duration(path: string): Promise<MediaMergeDuration> {
    return this.request('duration', { path })
  }

  timeline(path: string, timeSeconds?: number): Promise<MediaMergeTimeline> {
    return this.request('timeline', { path, timeSeconds })
  }

  waveform(path: string): Promise<MediaMergeWaveform> {
    return this.request('waveform', { path })
  }

  cancel(jobId: string): void {
    this.ensureWorker().postMessage({ id: 0, type: 'cancel', jobId })
  }

  async close(): Promise<void> {
    const worker = this.worker
    this.worker = null
    for (const request of this.pending.values()) request.reject(new MediaMergeInterruptedError())
    this.pending.clear()
    this.progressListeners.clear()
    this.executeRequestIds.clear()
    if (worker) this.onLog?.('worker.close', { type: 'mediaMerge' })
    if (worker) await worker.terminate()
  }

  private request<T>(type: string, input: unknown, jobId?: string): Promise<T> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      if (jobId) this.executeRequestIds.set(jobId, id)
      try {
        worker.postMessage({ id, type, input })
      } catch (error) {
        this.pending.delete(id)
        if (jobId) this.executeRequestIds.delete(jobId)
        reject(error)
      }
    })
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(this.workerPath, {
      type: 'module',
      workerData: { kind: 'media-merge', mediaTools: this.mediaTools },
      execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
    })
    this.onLog?.('worker.start', { type: 'mediaMerge', mediaTools: this.mediaTools })
    worker.on('online', () => this.onLog?.('worker.ready', { type: 'mediaMerge' }))
    worker.on('message', (message: WorkerMessage) => {
      try {
        if ('type' in message && message.type === 'progress') {
          this.progressListeners.get(message.jobId)?.(message.progress)
          return
        }
        const request = this.pending.get(message.id)
        if (!request) return
        this.pending.delete(message.id)
        if (message.ok) request.resolve(message.result)
        else request.reject(workerError(message))
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        this.onLog?.('worker.message.failed', { type: 'mediaMerge', error: failure }, 'error')
        if ('type' in message && message.type === 'progress') {
          const id = this.executeRequestIds.get(message.jobId)
          const request = id == null ? undefined : this.pending.get(id)
          if (id != null) this.pending.delete(id)
          this.executeRequestIds.delete(message.jobId)
          this.progressListeners.delete(message.jobId)
          try {
            worker.postMessage({ id: 0, type: 'cancel', jobId: message.jobId })
          } catch (cancelError) {
            this.onLog?.('worker.cancel.failed', { type: 'mediaMerge', error: cancelError }, 'error')
          }
          request?.reject(failure)
        } else {
          const request = this.pending.get(message.id)
          this.pending.delete(message.id)
          request?.reject(failure)
        }
      }
    })
    const fail = (error: Error) => {
      if (this.worker !== worker) return
      this.onLog?.('worker.error', { type: 'mediaMerge', error }, 'error')
      this.worker = null
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear()
      this.executeRequestIds.clear()
    }
    worker.on('error', fail)
    worker.on('exit', (code) => {
      if (this.worker === worker) {
        this.onLog?.('worker.exit', { type: 'mediaMerge', code, expected: false }, 'error')
      } else {
        this.onLog?.('worker.exit', { type: 'mediaMerge', code, expected: true })
      }
      fail(new Error(`媒体合并 Worker 已退出（${code}）`))
    })
    this.worker = worker
    return worker
  }
}

function workerError(message: WorkerFailure): Error {
  if (message.interrupted) return new MediaMergeInterruptedError()
  if (message.cancelled) return new MediaMergeCancelledError()
  return new Error(message.error || '媒体合并 Worker 请求失败')
}
