import { ipcMain, shell } from 'electron'
import type { NestifyRuntime } from '@nestify/core'
import { getPreviewWorker } from './preview-worker-host'
import { getRuntime } from './runtime-host'
import { assertNoActiveScan, runExclusiveFileOperation } from './file-operations-ipc'
import type { PlanScopeInput } from './payloads'

export function registerPlanIpc(): void {
  ipcMain.handle(
    'organize.snapshot',
    async (_event, input: { libraryId: string; scope?: 'library' | 'directory' | 'selection'; entryIds?: string[]; directory?: string }) => ({
      snapshot: await getPreviewWorker().request('organize-snapshot', input),
    }),
  )
  ipcMain.handle(
    'organize.preview',
    async (_event, input: { libraryId: string; rules: unknown[]; snapshotId?: string; scope?: 'library' | 'directory' | 'selection'; entryIds?: string[]; directory?: string; filter?: string; collision?: 'suffix' | 'skip' | 'overwrite' }) => ({
      preview: await getPreviewWorker().request('organize', input),
    }),
  )
  ipcMain.handle(
    'rules.preview',
    async (
      _event,
      input: PlanScopeInput & { libraryId: string; ruleSetId: string; collision?: 'suffix' | 'skip' | 'overwrite' },
    ) => ({ plan: await getPreviewWorker().request('rules', input) }),
  )
  ipcMain.handle(
    'rename.preview',
    async (
      _event,
      input: PlanScopeInput & {
        libraryId: string
        template: string
        groups?: Array<{ filter?: string; template: string }>
        filter?: string
        collision?: 'suffix' | 'skip' | 'overwrite'
      },
    ) => ({ plan: await getPreviewWorker().request('rename', input) }),
  )
  ipcMain.handle(
    'plan.execute',
    async (
      event,
      input: {
        libraryId: string
        plan: Parameters<NestifyRuntime['executePlan']>[0]['plan']
        selectedOps?: number[]
        module?: 'rules' | 'organize' | 'rename' | 'duplicates'
      },
    ) => runExclusiveFileOperation(() => {
      assertNoActiveScan()
      return getRuntime().executePlan({
        ...input,
        // delete op 走系统回收站（宿主注入；core 保持平台无关）。
        trashHandler: async (path: string) => {
          try {
            await shell.trashItem(path)
            return true
          } catch {
            return false
          }
        },
        module: input.module,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send('plan.execution-progress', progress)
        },
      })
    }),
  )
  ipcMain.handle('plan.rollback', async (_event, input: { jobId: string }) =>
    runExclusiveFileOperation(() => {
      assertNoActiveScan()
      return getRuntime().rollbackPlan(input.jobId)
    }),
  )
  ipcMain.handle('jobs.list', async (_event, input?: { libraryId?: string; limit?: number }) => ({
    jobs: getRuntime().listJobs(input),
  }))
  ipcMain.handle(
    'job.ops',
    async (_event, input: { jobId: string; offset?: number; limit?: number }) =>
      getRuntime().listJobOps(input.jobId, input),
  )
  ipcMain.handle('duplicates.analyze', async (event, input: Parameters<NestifyRuntime['analyzeDuplicates']>[0]) => {
    try {
      return await getRuntime().analyzeDuplicates({
        ...input,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send('duplicates.analysis-progress', progress)
        },
      })
    } catch (error) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('duplicates.analysis-progress', {
          status: 'failed',
          phase: 'finalizing',
          phaseCurrent: 0,
          phaseTotal: 0,
          percent: 0,
          path: null,
        })
      }
      throw error
    }
  })
}
