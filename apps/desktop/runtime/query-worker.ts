import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { listDirectoryChildren, searchEntries, type SearchEntriesRequest, type SearchSort } from '@nestify/core'

type QueryRequest =
  | { id: number; type: 'search'; request: SearchEntriesRequest }
  | { id: number; type: 'directory'; libraryId: string; directory: string; options: { limit?: number; offset?: number; sort?: SearchSort; parentId?: string } }
  | { type: 'close' }

const port = parentPort
if (!port) throw new Error('query-worker requires a worker parent port')

const dbPath = workerData?.dbPath
if (typeof dbPath !== 'string' || dbPath.length === 0) throw new Error('query-worker requires a database path')

const workerStartedAt = performance.now()
const db = new DatabaseSync(dbPath, { readOnly: true })
const pragmaStartedAt = performance.now()
db.exec('PRAGMA busy_timeout = 5000; PRAGMA query_only = ON;')
port.postMessage({
  type: 'ready',
  startupMs: Math.round(performance.now() - workerStartedAt),
  pragmaMs: Math.round(performance.now() - pragmaStartedAt),
})

port.on('message', (message: QueryRequest) => {
  if (message.type === 'close') {
    db.close()
    port.close()
    return
  }

  try {
    const result = message.type === 'search'
      ? searchEntries(db, message.request)
      : listDirectoryChildren(db, message.libraryId, message.directory, message.options)
    port.postMessage({ id: message.id, ok: true, result })
  } catch (error) {
    port.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
