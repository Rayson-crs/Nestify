import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { analyzeRuntimeDuplicates, executeRuntimePlan } from '../../../packages/core/src/app/runtime-plans.ts'
import { listDuplicateExecutionPlan } from '../../../packages/core/src/duplicates/query.ts'
import { recyclePath } from '../sidecar/recycle.ts'

type PlanExecuteInput = Parameters<typeof executeRuntimePlan>[0]
type DuplicateInput = Parameters<typeof analyzeRuntimeDuplicates>[0]
type Task =
  | (Omit<PlanExecuteInput, 'db' | 'quarantineDir' | 'trashHandler'> & { kind: 'plan-execute' })
  | (Omit<DuplicateInput, 'db' | 'quarantineDir'> & { kind: 'duplicates' })
  | {
      kind: 'duplicate-plan-execute'
      libraryId: string
      jobId?: string
      duplicateJobId: string
      duplicateKind?: string
      deselectedEntryIds?: string[]
    }

const port = parentPort
const dbPath = workerData?.dbPath
const quarantineDir = workerData?.quarantineDir
const task = workerData?.task as Task | undefined
if (!port || typeof dbPath !== 'string' || typeof quarantineDir !== 'string' || !task) {
  throw new Error('task-worker received invalid worker data')
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000; PRAGMA synchronous = NORMAL;')

const abortController = new AbortController()
port.on('message', (message: unknown) => {
  if ((message as { type?: string } | null)?.type === 'cancel') abortController.abort()
})

try {
  const onProgress = (progress: unknown) => {
    if (!port) return
    port.postMessage({
      type: 'progress',
      progress: task.kind === 'duplicates' && task.jobId
        ? { ...(progress as object), jobId: task.jobId }
        : progress,
    })
  }
  const executionTask = task.kind === 'duplicate-plan-execute' ? await buildDuplicateExecutionTask(task) : task
  const result = executionTask.kind === 'plan-execute'
    ? await executeRuntimePlan({
      ...executionTask,
      db,
      quarantineDir,
      trashHandler: recyclePath,
      onProgress,
    })
    : await analyzeRuntimeDuplicates({
      ...executionTask,
      db,
      quarantineDir,
      signal: abortController.signal,
      onProgress,
    })
  if (executionTask.kind === 'duplicates') {
    const duplicateResult = result as Awaited<ReturnType<typeof analyzeRuntimeDuplicates>>
    const { groups, plan: _plan, ...summary } = duplicateResult
    port.postMessage({
      type: 'completed',
      result: { ...summary, groupCount: groups.length },
    })
  } else {
    port.postMessage({ type: 'completed', result })
  }
} catch (error) {
  port.postMessage({
    type: 'failed',
    error: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : '',
  })
} finally {
  db.close()
  port.close()
}

function buildDuplicateExecutionTask(task: Extract<Task, { kind: 'duplicate-plan-execute' }>) {
  const plan = listDuplicateExecutionPlan(db, {
    jobId: task.duplicateJobId,
    quarantineDir,
    kind: task.duplicateKind,
  })
  const deselected = new Set(task.deselectedEntryIds ?? [])
  const selectedOps = plan.ops
    .map((op, index) => (op.entryId && deselected.has(op.entryId) ? -1 : index))
    .filter((index) => index >= 0)
  return {
    ...task,
    kind: 'plan-execute' as const,
    plan,
    selectedOps,
  }
}
