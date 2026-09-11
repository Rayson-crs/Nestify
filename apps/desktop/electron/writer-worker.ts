import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import {
  ChangeProcessor,
  ensureInitialReconciliation,
  listLibraries,
  recoverProcessingChanges,
  startLibraryWatcher,
  upgradeSqliteDerivedIndexes,
  type ChangeProcessorOptions,
  type LibraryWatcher,
} from '@nestify/core'

type LibraryConfig = ChangeProcessorOptions['library']
type WriterMessage =
  | { id?: number; type: 'start'; library: LibraryConfig }
  | { id?: number; type: 'stop'; libraryId: string }
  | { id?: number; type: 'schedule'; libraryId: string }
  | { id?: number; type: 'close' }
type WriterEvent =
  | { id?: number; type: 'ack' }
  | { id?: number; type: 'closed' }
  | { id?: number; type: 'error'; message: string }
  | { type: 'synced'; libraryId: string; count: number }

const port = parentPort
if (!port) throw new Error('writer-worker requires a worker parent port')
const dbPath = workerData?.dbPath
if (typeof dbPath !== 'string' || dbPath.length === 0) throw new Error('writer-worker requires a database path')

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;')
recoverProcessingChanges(db)

const resources = new Map<string, { watcher: LibraryWatcher; processor: ChangeProcessor }>()

function start(library: LibraryConfig): void {
  if (!library || resources.has(library.id)) return
  const processor = new ChangeProcessor(db, {
    library,
    onProcessed: (count) => {
      if (count > 0) port.postMessage({ type: 'synced', libraryId: library.id, count })
    },
  })
  const watcher = startLibraryWatcher(db, library, () => processor.schedule())
  ensureInitialReconciliation(db, library)
  resources.set(library.id, { watcher, processor })
  void processor.process()
}

async function stop(libraryId: string): Promise<void> {
  const resource = resources.get(libraryId)
  if (!resource) return
  resource.processor.stop()
  resource.watcher.close()
  await resource.processor.waitForIdle()
  resources.delete(libraryId)
}

for (const library of listLibraries(db)) start(library)

let messageTail = Promise.resolve()
const searchIndexUpgrade = upgradeSqliteDerivedIndexes(db).catch((error: unknown) => {
  console.error('[Nestify Writer Worker] search index upgrade failed', error)
})

async function handleMessage(message: WriterMessage): Promise<void> {
  try {
    if (message.type === 'close') {
      await Promise.all(Array.from(resources.keys(), (libraryId) => stop(libraryId)))
      await searchIndexUpgrade
      db.close()
      port.postMessage({ id: message.id, type: 'closed' })
      port.close()
      return
    }
    if (message.type === 'start') start(message.library)
    else if (message.type === 'stop') await stop(message.libraryId)
    else resources.get(message.libraryId)?.processor.schedule()
    if (message.id != null) port.postMessage({ id: message.id, type: 'ack' })
  } catch (error) {
    port.postMessage({
      id: message.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

port.on('message', (message: WriterMessage) => {
  messageTail = messageTail.then(() => handleMessage(message))
})
