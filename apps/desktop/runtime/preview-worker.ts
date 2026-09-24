import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import {
  getLibrary,
  listEntries,
  previewOrganize,
  createOrganizeSnapshot,
  type OrganizeSnapshot,
} from '@nestify/core'
import { previewRuntimeRename, previewRuntimeRules } from '../../../packages/core/src/app/runtime-rules.ts'

type PreviewRequest = {
  id: number
  type: 'rules' | 'rename' | 'organize' | 'organize-snapshot'
  input: any
}

const port = parentPort
if (!port) throw new Error('preview-worker requires a worker parent port')
const dbPath = workerData?.dbPath
const quarantineDir = workerData?.quarantineDir
if (typeof dbPath !== 'string' || typeof quarantineDir !== 'string') {
  throw new Error('preview-worker received invalid worker data')
}

const db = new DatabaseSync(dbPath, { readOnly: true })
db.exec('PRAGMA busy_timeout = 5000; PRAGMA query_only = ON;')

port.on('message', (message: PreviewRequest) => {
  try {
    let result: unknown
    if (message.type === 'organize-snapshot') {
      const library = getLibrary(db, message.input.libraryId)
      if (!library) throw new Error(`library not found: ${message.input.libraryId}`)
      const snapshot = createOrganizeSnapshot({
        ...message.input,
        entries: listEntries(db, message.input.libraryId),
      })
      result = snapshot
      snapshots.set(snapshot.id, snapshot)
    } else if (message.type === 'rules') {
      result = previewRuntimeRules(db, quarantineDir, message.input)
    } else if (message.type === 'rename') {
      result = previewRuntimeRename(db, message.input)
    } else {
      const library = getLibrary(db, message.input.libraryId)
      if (!library) throw new Error(`library not found: ${message.input.libraryId}`)
      const snapshot: OrganizeSnapshot = message.input.snapshot ?? snapshots.get(message.input.snapshotId)
      if (!snapshot) throw new Error('organize preview requires a snapshot')
      result = previewOrganize(
        db,
        quarantineDir,
        { ...message.input, snapshot },
        snapshot.entries,
        library.roots[0] ?? '',
      )
      snapshots.set(snapshot.id, snapshot)
    }
    port.postMessage({ id: message.id, ok: true, result })
  } catch (error) {
    port.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

const snapshots = new Map<string, OrganizeSnapshot>()
