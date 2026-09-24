import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { analyzeRuntimeDuplicates, executeRuntimePlan } from '../../../packages/core/src/app/runtime-plans.ts'
import { recyclePath } from '../sidecar/recycle.ts'

type PlanExecuteInput = Parameters<typeof executeRuntimePlan>[0]
type DuplicateInput = Parameters<typeof analyzeRuntimeDuplicates>[0]
type Task =
  | (Omit<PlanExecuteInput, 'db' | 'quarantineDir' | 'trashHandler'> & { kind: 'plan-execute' })
  | (Omit<DuplicateInput, 'db' | 'quarantineDir'> & { kind: 'duplicates' })

const port = parentPort
const dbPath = workerData?.dbPath
const quarantineDir = workerData?.quarantineDir
const task = workerData?.task as Task | undefined
if (!port || typeof dbPath !== 'string' || typeof quarantineDir !== 'string' || !task) {
  throw new Error('task-worker received invalid worker data')
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000; PRAGMA synchronous = NORMAL;')

try {
  const onProgress = (progress: unknown) => {
    if (!port) return
    port.postMessage({ type: 'progress', progress })
  }
  const result = task.kind === 'plan-execute'
    ? await executeRuntimePlan({
      ...task,
      db,
      quarantineDir,
      trashHandler: recyclePath,
      onProgress,
    })
    : await analyzeRuntimeDuplicates({
      ...task,
      db,
      quarantineDir,
      onProgress,
    })
  port.postMessage({ type: 'completed', result })
} catch (error) {
  port.postMessage({
    type: 'failed',
    error: error instanceof Error ? error.message : String(error),
  })
} finally {
  db.close()
  port.close()
}
