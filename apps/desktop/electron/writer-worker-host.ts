import { WriterWorkerClient } from './writer-worker-client'
import { resolveWriterWorker } from './paths'
import { appState } from './state'
import type { NestifyRuntime } from '@nestify/core'

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

export function getWriterWorker(runtime: NestifyRuntime): WriterWorkerClient {
  if (!appState.writerWorker) {
    appState.writerWorker = new WriterWorkerClient(resolveWriterWorker(), runtime.paths.dbPath)
  }
  return appState.writerWorker
}

export function startAllLibraryWriters(runtime: NestifyRuntime): void {
  const worker = getWriterWorker(runtime)
  for (const library of runtime.listLibraries()) worker.start(libraryConfig(library))
}

export function startLibraryWriter(runtime: NestifyRuntime, library: ReturnType<NestifyRuntime['listLibraries']>[number]): void {
  getWriterWorker(runtime).start(libraryConfig(library))
}

export async function stopLibraryWriter(runtime: NestifyRuntime, libraryId: string): Promise<void> {
  await getWriterWorker(runtime).stop(libraryId)
}
