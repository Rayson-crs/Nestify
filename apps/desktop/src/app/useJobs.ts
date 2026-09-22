import { useCallback, useRef, useState } from 'react'
import { callNestify } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { JobOpRecord, JobRecord } from '@nestify/shared'

type NoticeSetter = (notice: string | null) => void
type ErrorSetter = (error: string | null) => void

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
  const [jobOps, setJobOps] = useState<JobOpRecord[]>([])
  const [jobOpsTotal, setJobOpsTotal] = useState(0)
  const [jobOpsOffset, setJobOpsOffset] = useState(0)
  const [jobOpsLimit, setJobOpsLimit] = useState(100)
  const [jobOpsLoading, setJobOpsLoading] = useState(false)
  const jobOpsRequestRef = useRef(0)

  const loadJobs = useCallback(async (options?: { preferJobId?: string }) => {
    setJobsLoading(true)
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
      setJobsLoading(false)
    }
  }, [])

  const loadJobOps = useCallback(async (jobId: string, offset = 0, limit = 100) => {
    const requestId = jobOpsRequestRef.current + 1
    jobOpsRequestRef.current = requestId
    setJobOpsLoading(true)
    setJobOps([])
    try {
      const page = await callNestify((api) => api.jobOps({ jobId, offset, limit }))
      if (jobOpsRequestRef.current !== requestId) return
      setJobOps(page.ops)
      setJobOpsTotal(page.total)
      setJobOpsOffset(page.offset)
      setJobOpsLimit(page.limit)
    } finally {
      if (jobOpsRequestRef.current === requestId) setJobOpsLoading(false)
    }
  }, [])

  const loadJobOpsPage = useCallback((jobId: string, offset: number) => {
    void loadJobOps(jobId, offset, jobOpsLimit).catch((err) => setError(errorMessage(err)))
  }, [jobOpsLimit, loadJobOps, setError])

  const openJobDetails = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId)
    try {
      await loadJobOps(jobId)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [loadJobOps, setError])

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

  return {
    jobs,
    jobsLoading,
    selectedJobId,
    jobOps,
    jobOpsTotal,
    jobOpsOffset,
    jobOpsLimit,
    jobOpsLoading,
    loadJobs,
    loadJobOps,
    loadJobOpsPage,
    openJobDetails,
    resumeMediaMerge,
  }
}
