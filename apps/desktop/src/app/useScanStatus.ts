import { useCallback, useEffect, useRef } from 'react'
import { errorMessage } from '@/lib/labels'
import { getNestifyApi, type ScanFinishedPayload } from '@/lib/ipc'
import type { JobRecord } from '@nestify/shared'

interface ScanStatusInput {
  scanning: boolean
  scanPaused: boolean
  scanJobId: string | null
  filesScanned: number
  dirsScanned: number
  scanPhase: string
  jobs: JobRecord[]
  tab: string
  loadJobs: (options?: { preferJobId?: string }) => Promise<void>
  refreshLibraries: () => Promise<void>
  runSearch: () => Promise<void>
  refreshTree: () => Promise<void>
  setError: (error: string | null) => void
}

export function useScanStatus(input: ScanStatusInput) {
  const wasScanning = useRef(false)
  const refreshTimers = useRef<number[]>([])
  const {
    scanning,
    scanPaused,
    scanJobId,
    filesScanned,
    dirsScanned,
    scanPhase,
    jobs,
    tab,
    loadJobs,
    refreshLibraries,
    runSearch,
    refreshTree,
    setError,
  } = input

  const scheduleRefresh = useCallback((delayMs: number) => {
    const timer = window.setTimeout(() => {
      refreshTimers.current = refreshTimers.current.filter((item) => item !== timer)
      void Promise.all([
        runSearch(),
        refreshTree(),
        loadJobs({ preferJobId: scanJobId ?? undefined }),
        refreshLibraries(),
      ]).catch((err) => {
        if (/query cancelled/i.test(errorMessage(err))) return
        setError(errorMessage(err))
      })
    }, delayMs)
    refreshTimers.current.push(timer)
  }, [loadJobs, refreshLibraries, refreshTree, runSearch, scanJobId, setError])

  useEffect(() => {
    if (scanning) {
      wasScanning.current = true
      return
    }
    if (!wasScanning.current) return
    wasScanning.current = false

    scheduleRefresh(180)
  }, [scheduleRefresh, scanning])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onScanFinished) return
    return api.onScanFinished((_payload: ScanFinishedPayload) => {
      scheduleRefresh(80)
      scheduleRefresh(800)
    })
  }, [scheduleRefresh])

  useEffect(() => () => {
    for (const timer of refreshTimers.current) window.clearTimeout(timer)
    refreshTimers.current = []
  }, [])

  useEffect(() => {
    if (tab !== 'jobs') return
    const timer = window.setInterval(() => {
      void loadJobs().catch((err) => setError(errorMessage(err)))
    }, 3000)
    return () => window.clearInterval(timer)
  }, [loadJobs, setError, tab])

  const scanJob = jobs.find((job) => job.id === scanJobId) ?? null
  const hasScanData = filesScanned > 0 || dirsScanned > 0 || scanPhase !== 'idle'

  const scanCompleted = !scanning && (
    scanJob?.status === 'completed'
    || (
      wasScanning.current
      && hasScanData
      && scanPhase === 'idle'
      && scanJob?.status !== 'cancelled'
      && scanJob?.status !== 'failed'
    )
  )
  const scanPercentDisplay = scanCompleted ? 100 : null
  const scanPhaseLabel = scanning
    ? scanPaused
      ? '暂停'
      : '扫描中'
    : scanJob?.status === 'cancelled'
      ? '已取消'
      : scanJob?.status === 'failed'
        ? '失败'
        : scanCompleted
          ? '完成'
          : scanPhase === 'idle'
            ? '就绪'
            : scanPhase

  return { scanJob, scanCompleted, scanPercentDisplay, scanPhaseLabel }
}
