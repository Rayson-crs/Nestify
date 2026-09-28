import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { callNestify, getNestifyApi, type ChangePlan, type ExecutionProgress, type LibrarySummary, type PlanExecuteStartInput } from '@/lib/ipc'
import { canRollbackJob, errorMessage } from '@/lib/labels'
import type { ConfirmationRequest } from '@/app/types'
import type { PlanState } from '@/app/plan-state'
import type { JobRecord, PlanExecutionFinishedEvent } from '@nestify/shared'

export function usePlanExecution({
  activePlan,
  planState,
  selectedOps,
  selectedCount,
  planHasMore,
  selectedLibrary,
  selectedLibraryId,
  libraryForDuplicates,
  libraryForRename,
  libraryForOrganize,
  getDuplicateExecutionSource,
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
  planHasMore: boolean
  selectedLibrary: LibrarySummary | null
  selectedLibraryId: string | null
  libraryForDuplicates: LibrarySummary | null
  libraryForRename: LibrarySummary | null
  libraryForOrganize: LibrarySummary | null
  getDuplicateExecutionSource?: () => { jobId: string; kind?: string } | null
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
  const activeExecutionRequestId = useRef<string | null>(null)

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onPlanExecutionProgress) return
    return api.onPlanExecutionProgress((progress) => {
      if (progress.requestId && activeExecutionRequestId.current && progress.requestId !== activeExecutionRequestId.current) return
      setExecuteProgress(progress)
    })
  }, [])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onPlanExecutionFinished) return
    return api.onPlanExecutionFinished((event) => {
      if (activeExecutionRequestId.current && event.requestId !== activeExecutionRequestId.current) return
      setExecuteProgress((current) => current ? { ...current, ...event.result, status: event.status } : current)
    })
  }, [])

  const waitForPlanExecution = useCallback((requestId: string) => new Promise<PlanExecutionFinishedEvent>((resolve) => {
    let stopped = false
    let stopEvents: (() => void) | null = null
    let timer: number | null = null
    const finish = (event: PlanExecutionFinishedEvent) => {
      if (stopped) return
      stopped = true
      stopEvents?.()
      if (timer != null) window.clearInterval(timer)
      resolve(event)
    }
    const api = getNestifyApi()
    stopEvents = api?.onPlanExecutionFinished?.((event) => {
      if (event.requestId === requestId) finish(event)
    }) ?? null
    const poll = () => {
      void callNestify((currentApi) => (
        currentApi.planExecutionStatus
          ? currentApi.planExecutionStatus({ requestId })
          : Promise.reject(new Error('plan.execution is unavailable'))
      ))
        .then((snapshot) => {
          setExecuteProgress(snapshot.progress)
          if (snapshot.status === 'completed' || snapshot.status === 'failed') {
            finish({
              requestId,
              jobId: snapshot.jobId,
              status: snapshot.status,
              result: snapshot.result,
              error: snapshot.error,
            })
          }
        })
        .catch(() => undefined)
    }
    timer = window.setInterval(poll, 500)
    poll()
  }), [])

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
    const module = planState?.source
    if (!module) return
    let duplicateSource: { jobId: string; kind?: string } | null = null
    if (module === 'duplicates') {
      if (selectedCount === 0) return
      duplicateSource = getDuplicateExecutionSource?.() ?? null
      if (!duplicateSource) return
    }
    let executionInput: PlanExecuteStartInput
    if (module === 'duplicates' && duplicateSource) {
      const deselectedEntryIds = activePlan.ops
        .filter((_, index) => selectedOps[index] === false)
        .map((op) => op.entryId)
        .filter((entryId): entryId is string => Boolean(entryId))
      executionInput = {
        libraryId: executeLibrary.id,
        module,
        duplicateJobId: duplicateSource.jobId,
        duplicateKind: duplicateSource.kind,
        deselectedEntryIds,
      }
    } else {
      const selected = activePlan.ops
        .map((_, index) => (selectedOps[index] === false ? -1 : index))
        .filter((index) => index >= 0)
      executionInput = {
        libraryId: executeLibrary.id,
        plan: activePlan,
        selectedOps: selected,
        module,
      }
    }
    setBusy('execute')
    setExecuteProgress({
      module,
      status: 'running',
      current: 0,
      total: module === 'duplicates' ? selectedCount : executionInput.plan?.ops.length ?? 0,
      ok: 0,
      skipped: 0,
      failed: 0,
      path: null,
    })
    setError(null)
    try {
      const started = await callNestify((api) => {
        if (!api.planExecuteStart) throw new Error('plan.execute.start is unavailable')
        return api.planExecuteStart(executionInput)
      })
      activeExecutionRequestId.current = started.requestId
      setExecuteProgress((current) => current ? { ...current, requestId: started.requestId, jobId: started.jobId } : current)
      const finished = await waitForPlanExecution(started.requestId)
      if (finished.status === 'failed' || !finished.result) throw new Error(finished.error || '执行计划失败')
      const result = finished.result
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
      activeExecutionRequestId.current = null
      setExecuteProgress(null)
      setBusy(null)
    }
  }, [
    activePlan,
    getDuplicateExecutionSource,
    libraryForDuplicates,
    libraryForOrganize,
    libraryForRename,
    loadJobs,
    planState?.source,
    query,
    runSearch,
    selectedLibrary,
    selectedLibraryId,
    selectedCount,
    selectedOps,
    setBusy,
    setError,
    setNotice,
    setPlanState,
    setSelectedOps,
    waitForPlanExecution,
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
      description: planState?.source === 'duplicates'
        ? `将按持久化保留状态执行 ${selectedCount} 个重复文件处理操作；未浏览的分组也会一起执行。此操作会修改磁盘文件，请确认预览内容。`
        : `将执行 ${selectedCount} 个已加载且勾选的操作；未加载页不会执行${planHasMore ? '（仍有未加载匹配项）' : ''}。此操作会修改磁盘文件，请确认预览内容。`,
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
    planHasMore,
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
