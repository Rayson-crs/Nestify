import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { callNestify, getNestifyApi, type ChangePlan, type ExecutionProgress, type LibrarySummary } from '@/lib/ipc'
import { canRollbackJob, errorMessage } from '@/lib/labels'
import type { ConfirmationRequest } from '@/app/types'
import type { PlanState } from '@/app/plan-state'
import type { JobRecord } from '@nestify/shared'

export function usePlanExecution({
  activePlan,
  planState,
  selectedOps,
  selectedCount,
  selectedLibrary,
  selectedLibraryId,
  libraryForDuplicates,
  libraryForRename,
  libraryForOrganize,
  query,
  requestConfirmation,
  runSearch,
  loadJobs,
  setError,
  setNotice,
  setBusy,
  setPlanState,
  setSelectedOps,
}: {
  activePlan: ChangePlan | null
  planState: PlanState | null
  selectedOps: Record<number, boolean>
  selectedCount: number
  selectedLibrary: LibrarySummary | null
  selectedLibraryId: string | null
  libraryForDuplicates: LibrarySummary | null
  libraryForRename: LibrarySummary | null
  libraryForOrganize: LibrarySummary | null
  query: string
  requestConfirmation: (request: ConfirmationRequest) => void
  runSearch: (text: string, libraryId?: string | null, offset?: number) => Promise<void>
  loadJobs: (options?: { preferJobId?: string }) => Promise<void>
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  setBusy: (value: string | null) => void
  setPlanState: Dispatch<SetStateAction<PlanState | null>>
  setSelectedOps: Dispatch<SetStateAction<Record<number, boolean>>>
}) {
  const [lastExecuteJobId, setLastExecuteJobId] = useState<string | null>(null)
  const [executeProgress, setExecuteProgress] = useState<ExecutionProgress | null>(null)

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onPlanExecutionProgress) return
    return api.onPlanExecutionProgress((progress) => setExecuteProgress(progress))
  }, [])

  useEffect(() => {
    if (executeProgress?.status !== 'running') return
    const timer = window.setInterval(() => {
      void callNestify((api) =>
        api.planProgress ? api.planProgress() : Promise.reject(new Error('plan.progress is unavailable')),
      )
        .then((progress) => {
          if (progress) setExecuteProgress(progress)
        })
        .catch(() => undefined)
    }, 500)
    return () => window.clearInterval(timer)
  }, [executeProgress?.status])

  const performExecutePlan = useCallback(async () => {
    const executeLibrary =
      planState?.source === 'duplicates'
        ? libraryForDuplicates
        : planState?.source === 'rename'
          ? libraryForRename
          : planState?.source === 'organize'
            ? libraryForOrganize
            : selectedLibrary
    if (!executeLibrary || !activePlan) return
    const selected = activePlan.ops.map((op, index) => (selectedOps[index] ? index : -1)).filter((index) => index >= 0)
    const module = planState?.source
    if (!module) return
    setBusy('execute')
    setExecuteProgress({ module, status: 'running', current: 0, total: selected.length, ok: 0, skipped: 0, failed: 0, path: null })
    setError(null)
    try {
      const result = await callNestify((api) =>
        api.planExecute({ libraryId: executeLibrary.id, plan: activePlan, selectedOps: selected, module }),
      )
      setLastExecuteJobId(result.jobId)
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`执行存在失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      } else if (module === 'duplicates') {
        setSelectedOps({})
      } else {
        setPlanState(null)
      }
      setNotice(`执行结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await runSearch(query, selectedLibraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setExecuteProgress(null)
      setBusy(null)
    }
  }, [
    activePlan,
    libraryForDuplicates,
    libraryForOrganize,
    libraryForRename,
    loadJobs,
    planState?.source,
    query,
    runSearch,
    selectedLibrary,
    selectedLibraryId,
    selectedOps,
    setBusy,
    setError,
    setNotice,
    setPlanState,
    setSelectedOps,
  ])

  const handleExecutePlan = useCallback(() => {
    if (!activePlan) return
    if (planState?.source === 'duplicates' && !libraryForDuplicates) return
    if (planState?.source === 'rename' && !libraryForRename) return
    if (planState?.source === 'organize' && !libraryForOrganize) return
    if (
      planState?.source !== 'duplicates'
      && planState?.source !== 'rename'
      && planState?.source !== 'organize'
      && !selectedLibraryId
    ) return
    requestConfirmation({
      title: '执行变更计划',
      description: `将执行 ${selectedCount} 个已勾选操作。此操作会修改磁盘文件，请确认预览内容。`,
      confirmLabel: '执行',
      action: performExecutePlan,
    })
  }, [
    activePlan,
    libraryForDuplicates,
    libraryForOrganize,
    libraryForRename,
    performExecutePlan,
    planState?.source,
    requestConfirmation,
    selectedCount,
    selectedLibraryId,
  ])

  const refreshAfterRollback = useCallback(async (jobId: string, libraryId?: string | null) => {
    await loadJobs({ preferJobId: jobId })
    if (libraryId) await runSearch(query, libraryId)
  }, [loadJobs, query, runSearch])

  const handleRollback = useCallback(async () => {
    if (!lastExecuteJobId) return
    setBusy('rollback')
    setError(null)
    try {
      const result = await callNestify((api) => api.planRollback({ jobId: lastExecuteJobId }))
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`回滚存在失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      } else {
        setLastExecuteJobId(null)
        setPlanState(null)
      }
      setNotice(`回滚结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await refreshAfterRollback(result.jobId, selectedLibraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }, [lastExecuteJobId, refreshAfterRollback, selectedLibraryId, setBusy, setError, setNotice, setPlanState])

  const handleJobRollback = useCallback(async (job: JobRecord) => {
    if (!canRollbackJob(job)) return
    setBusy(`rollback:${job.id}`)
    setError(null)
    try {
      const result = await callNestify((api) => api.planRollback({ jobId: job.id }))
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`任务 ${job.id.slice(0, 8)} 回滚失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      }
      setNotice(`任务 ${job.id.slice(0, 8)} 回滚结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await refreshAfterRollback(result.jobId, job.libraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }, [refreshAfterRollback, setBusy, setError, setNotice])

  return {
    lastExecuteJobId,
    executeProgress,
    handleExecutePlan,
    handleRollback,
    handleJobRollback,
  }
}
