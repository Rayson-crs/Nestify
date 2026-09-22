import { useEffect, useRef } from 'react'
import { errorMessage } from '@/lib/labels'
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
  runSearch: () => Promise<void>
  refreshTree: () => Promise<void>
  setError: (error: string | null) => void
}

export function useScanStatus(input: ScanStatusInput) {
  const wasScanning = useRef(false)
  const lastScanPercent = useRef(0)
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
    runSearch,
    refreshTree,
    setError,
  } = input

  useEffect(() => {
    if (scanning) {
      wasScanning.current = true
      return
    }
    if (!wasScanning.current) return
    wasScanning.current = false

    // 扫描完成后索引已写入数据库，但当前目录树不会自动刷新。
    void Promise.all([runSearch(), refreshTree(), loadJobs({ preferJobId: scanJobId ?? undefined })])
      .catch((err) => setError(errorMessage(err)))
  }, [
    loadJobs,
    refreshTree,
    runSearch,
    scanJobId,
    scanning,
    setError,
  ])

  useEffect(() => {
    if (tab !== 'jobs') return
    const timer = window.setInterval(() => {
      void loadJobs().catch((err) => setError(errorMessage(err)))
    }, 3000)
    return () => window.clearInterval(timer)
  }, [loadJobs, setError, tab])

  const scanJob = jobs.find((job) => job.id === scanJobId) ?? null
  const scanCount = Math.max(1, filesScanned + dirsScanned)
  const liveScanPercent = Math.min(95, 8 + Math.log10(scanCount) * 18)
  if (scanning) lastScanPercent.current = liveScanPercent

  const scanCompleted = !scanning && (
    scanJob?.status === 'completed'
    || (
      lastScanPercent.current > 0
      && scanPhase === 'idle'
      && scanJob?.status !== 'cancelled'
      && scanJob?.status !== 'failed'
    )
  )
  const scanPercentDisplay = scanning
    ? liveScanPercent
    : scanCompleted
      ? 100
      : lastScanPercent.current
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
