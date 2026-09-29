import { useCallback, useEffect, useState } from 'react'
import { callNestify } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { JobRecord } from '@nestify/shared'

type NoticeSetter = (notice: string | null) => void
type ErrorSetter = (error: string | null) => void
type JobStatus = JobRecord['status']

const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['queued', 'running', 'paused', 'cancelling']

export function useJobs({
  setError,
  setNotice,
}: {
  setError: ErrorSetter
  setNotice: NoticeSetter
}) {
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const loadJobs = useCallback(async (options?: { preferJobId?: string; silent?: boolean }) => {
    if (!options?.silent) setJobsLoading(true)
    try {
      const { jobs: next } = await callNestify((api) => api.jobsList({ limit: 100 }))
      const validJobs = next.filter((job) => Boolean(job?.id))
      setJobs(validJobs)
      setSelectedJobId((current) => {
        const preferred = options?.preferJobId
        if (preferred && validJobs.some((job) => job.id === preferred)) return preferred
        return validJobs.some((job) => job.id === current) ? current : validJobs[0]?.id ?? null
      })
    } finally {
      if (!options?.silent) setJobsLoading(false)
    }
  }, [])

  const hasActiveJobs = jobs.some((job) => ACTIVE_JOB_STATUSES.includes(job.status))
  useEffect(() => {
    if (!hasActiveJobs) return
    let refreshing = false
    const timer = window.setInterval(() => {
      if (refreshing) return
      refreshing = true
      void loadJobs({ silent: true })
        .catch(() => undefined)
        .finally(() => {
          refreshing = false
        })
    }, 750)
    return () => window.clearInterval(timer)
  }, [hasActiveJobs, loadJobs])

  const openJobDetails = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId)
  }, [])

  const resumeMediaMerge = useCallback(async (jobId: string) => {
    setJobsLoading(true)
    setError(null)
    try {
      await callNestify((api) =>
        api.mediaMergeResume
          ? api.mediaMergeResume({ jobId })
          : Promise.reject(new Error('mediaMerge.resume is unavailable')),
      )
      setNotice('媒体合并任务已恢复执行')
      await loadJobs({ preferJobId: jobId })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setJobsLoading(false)
    }
  }, [loadJobs, setError, setNotice])

  const clearJobs = useCallback(async () => {
    setJobsLoading(true)
    setError(null)
    try {
      const result = await callNestify((api) =>
        api.jobsClear
          ? api.jobsClear()
          : Promise.reject(new Error('jobs.clear is unavailable')),
      )
      setJobs([])
      setSelectedJobId(null)
      setNotice(
        result.retainedActive > 0
          ? `已清空 ${result.deleted} 条任务记录，保留 ${result.retainedActive} 条运行中任务`
          : `已清空 ${result.deleted} 条任务记录`,
      )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setJobsLoading(false)
    }
  }, [setError, setNotice])

  return {
    jobs,
    jobsLoading,
    selectedJobId,
    loadJobs,
    openJobDetails,
    resumeMediaMerge,
    clearJobs,
  }
}
