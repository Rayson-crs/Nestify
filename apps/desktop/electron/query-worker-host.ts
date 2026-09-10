import type { NestifyRuntime } from '@nestify/core'
import { resolveQueryWorker } from './paths'
import { appState } from './state'
import { logStartup } from './log'
import { QueryWorkerClient } from './query-worker-client'

export function getQueryWorker(runtime: NestifyRuntime): QueryWorkerClient {
  if (!appState.queryWorker) {
    appState.queryWorker = new QueryWorkerClient(resolveQueryWorker(), runtime.paths.dbPath)
    logStartup('query-worker.created', {
      workerPath: resolveQueryWorker(),
      dbPath: runtime.paths.dbPath,
    })
  }
  return appState.queryWorker
}

export async function prewarmQueryWorkers(runtime: NestifyRuntime): Promise<void> {
  const targets = runtime.listLibraries().flatMap((library) =>
    library.roots
      .filter((root) => root.trim().length > 0)
      .slice(0, 1)
      .map((root) => ({ libraryId: library.id, directory: root })),
  ).slice(0, 8)
  const startedAt = Date.now()
  try {
    await getQueryWorker(runtime).prewarmDirectories(targets)
    logStartup('query-worker.prewarm.finished', {
      targets: targets.length,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (error) {
    logStartup('query-worker.prewarm.failed', {
      targets: targets.length,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
