import type { NestifyRuntime } from '../app/runtime.ts'
import { notImplemented, type ModuleContext, type ModuleDefinition, type ScanProgress, type ScanRequest, type ScanResult } from './types.ts'

export type { ScanResult }

export interface ScanController {
  execute(request: ScanRequest, ctx: ModuleContext): Promise<ScanResult>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(): Promise<void>
  progress(): Promise<ScanProgress>
}

export const scanModule: ModuleDefinition<ScanController> = {
  id: 'scan',
  createController() {
    return {
      execute(_request, _ctx) {
        return notImplemented('scan.execute')
      },
      pause() {
        return notImplemented('scan.pause')
      },
      resume() {
        return notImplemented('scan.resume')
      },
      cancel() {
        return notImplemented('scan.cancel')
      },
      progress() {
        return notImplemented('scan.progress')
      },
    }
  },
}

export function createRuntimeScanController(runtime: NestifyRuntime): ScanController {
  let activeJobId: string | null = null

  return {
    async execute(_request, ctx) {
      if (ctx.abortSignal?.aborted) throw new Error('scan was aborted')

      const unsubscribe = ctx.onProgress ? runtime.onScanProgress(ctx.onProgress) : undefined
      const onAbort = () => {
        if (activeJobId) runtime.cancelScan(activeJobId)
      }
      ctx.abortSignal?.addEventListener('abort', onAbort, { once: true })

      try {
        const started = runtime.startScan(ctx.libraryId)
        activeJobId = started.job.id
        while (isActiveRuntimeScan(runtime, started.job.id)) {
          await delay()
        }
        const progress = runtime.getScanProgress()
        return {
          filesScanned: progress.filesScanned,
          dirsScanned: progress.dirsScanned,
          errors: progress.errors,
        }
      } finally {
        activeJobId = null
        ctx.abortSignal?.removeEventListener('abort', onAbort)
        unsubscribe?.()
      }
    },
    async pause() {
      assertActiveScan(activeJobId)
      runtime.pauseScan(activeJobId)
    },
    async resume() {
      assertActiveScan(activeJobId)
      runtime.resumeScan(activeJobId)
    },
    async cancel() {
      assertActiveScan(activeJobId)
      runtime.cancelScan(activeJobId)
    },
    async progress() {
      return runtime.getScanProgress()
    },
  }
}

function isActiveRuntimeScan(runtime: NestifyRuntime, jobId: string): boolean {
  const active = runtime.getActiveScanJob()
  return active?.jobId === jobId &&
    (active.status === 'running' || active.status === 'paused' || active.status === 'cancelling')
}

function assertActiveScan(jobId: string | null): asserts jobId is string {
  if (!jobId) throw new Error('scan job is not active')
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
}
