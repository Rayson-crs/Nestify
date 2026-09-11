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
    // 索引更新 → 广播所有窗口（渲染端自动刷新搜索/目录/统计）。
    appState.writerWorker.onSynced = ({ libraryId, count }) => {
      for (const window of [appState.mainWindow, appState.spotlightWindow]) {
        if (window && !window.isDestroyed()) {
          window.webContents.send('sync.updated', { libraryId, count })
        }
      }
    }
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
