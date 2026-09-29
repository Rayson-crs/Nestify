import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  callNestify,
  getNestifyApi,
  type ChangePlan,
  type DuplicateGroup,
  type DuplicateFilesPage,
  type DuplicateHashStrategy,
  type DuplicateProgress,
  type DuplicateScope,
  type KeepStrategy,
  type LibrarySummary,
  type SearchHit,
} from '@/lib/ipc'
import { matchingRootPath, parentDirectoryPath } from '@/lib/path-crumbs'
import { errorMessage } from '@/lib/labels'
import { formatBytes } from '@/lib/utils'
import { syncDuplicateSelectedOps } from '@/app/duplicate-strategy'
import { useDirectoryPreview } from '@/app/useDirectoryPreview'
import { useExpressionPreview } from '@/app/useExpressionPreview'

export function useDuplicateWizard({
  libraries,
  tab,
  setError,
  setNotice,
  setBusy,
  applyPlan,
  setSelectedOps,
}: {
  libraries: LibrarySummary[]
  tab: string
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  setBusy: (value: string | null) => void
  applyPlan: (plan: ChangePlan, source: 'duplicates', options?: { offset?: number; fingerprint?: string }) => void
  setSelectedOps: Dispatch<SetStateAction<Record<number, boolean>>>
}) {
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [keepStrategy, setKeepStrategy] = useState<KeepStrategy>('newest')
  const [duplicateHashStrategy, setDuplicateHashStrategy] = useState<DuplicateHashStrategy>('duplicate-candidate-only')
  const [duplicateScope, setDuplicateScope] = useState<DuplicateScope>('library')
  const [duplicateDirectory, setDuplicateDirectory] = useState('')
  const [duplicateDirectoryId, setDuplicateDirectoryId] = useState<string | null>(null)
  const [duplicateStep, setDuplicateStep] = useState<'pick' | 'filter' | 'analyzing' | 'result'>('pick')
  const [duplicateFilter, setDuplicateFilter] = useState('')
  const [duplicateAnalysisProgress, setDuplicateAnalysisProgress] = useState<DuplicateProgress | null>(null)
  const [duplicateResultLoading, setDuplicateResultLoading] = useState(false)
  const [duplicateJobId, setDuplicateJobId] = useState<string | null>(null)
  const [duplicateGroupsOffset, setDuplicateGroupsOffset] = useState(0)
  const [duplicateGroupsTotal, setDuplicateGroupsTotal] = useState(0)
  const [duplicateGroupsHasMore, setDuplicateGroupsHasMore] = useState(false)
  const [duplicateFiles, setDuplicateFiles] = useState<DuplicateFilesPage['files']>([])
  const [duplicateFilesOffset, setDuplicateFilesOffset] = useState(0)
  const [duplicateFilesTotal, setDuplicateFilesTotal] = useState(0)
  const [duplicateFilesHasMore, setDuplicateFilesHasMore] = useState(false)
  const [duplicateFilesBusy, setDuplicateFilesBusy] = useState(false)
  const [duplicateResultFileCount, setDuplicateResultFileCount] = useState(0)
  const [duplicateResultWastedBytes, setDuplicateResultWastedBytes] = useState(0)
  const [duplicateSelectedCount, setDuplicateSelectedCount] = useState(0)
  const [duplicateSelectedBytes, setDuplicateSelectedBytes] = useState(0)
  const [resultKindFilter, setResultKindFilter] = useState<'all' | string>('all')
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groupsPaneWidth, setGroupsPaneWidth] = useState(240)
  const directoryPreview = useDirectoryPreview({ libraries, matchMode: 'inside-root' })
  const filterPreview = useExpressionPreview({ libraries, directory: duplicateDirectory })
  const duplicateRequestSeqRef = useRef(0)
  const duplicateCompletedLoadJobRef = useRef<string | null>(null)

  const directoryForDuplicates = duplicateDirectory.trim()
  const libraryForDirectory = useMemo(
    () => (directoryForDuplicates
      ? libraries.find((library) => matchingRootPath(directoryForDuplicates, library.roots)) ?? null
      : null),
    [directoryForDuplicates, libraries],
  )
  const canPreviewScope =
    directoryForDuplicates.length > 0
    && libraryForDirectory !== null
    && (keepStrategy !== 'preferred_dir' || directoryForDuplicates.length > 0)
  const analyzeBlockReason = (() => {
    if (libraries.length === 0) return '还没有任何资料库，先去左侧「资料库」里添加一个'
    if (!directoryForDuplicates) return '先在上面填入或选择要分析的目录'
    if (!libraryForDirectory)
      return `目录不在任何资料库范围内（现有资料库：${libraries.map((library) => library.name).join('、')}），请把该目录加入某个资料库后再分析`
    return null
  })()
  const canDuplicateGoParent = Boolean(
    parentDirectoryPath(
      directoryForDuplicates,
      libraryForDirectory ? matchingRootPath(directoryForDuplicates, libraryForDirectory.roots) : null,
    ),
  )
  const duplicateFingerprint = useMemo(
    () => [directoryForDuplicates, duplicateFilter.trim(), duplicateHashStrategy].join('\n'),
    [directoryForDuplicates, duplicateFilter, duplicateHashStrategy],
  )

  useEffect(() => {
    setDuplicateGroups([])
    setDuplicateFiles([])
    setDuplicateGroupsOffset(0)
    setDuplicateGroupsTotal(0)
    setDuplicateGroupsHasMore(false)
    setDuplicateFiles([])
    setDuplicateFilesOffset(0)
    setDuplicateFilesTotal(0)
    setDuplicateFilesHasMore(false)
    setDuplicateResultFileCount(0)
    setDuplicateResultWastedBytes(0)
    setDuplicateSelectedCount(0)
    setDuplicateSelectedBytes(0)
    setDuplicateJobId(null)
    setDuplicateAnalysisProgress(null)
    setDuplicateResultLoading(false)
    duplicateCompletedLoadJobRef.current = null
    setActiveGroupId(null)
  }, [duplicateFingerprint])

  const groupsForLoadedFiles = useCallback((
    files: DuplicateFilesPage['files'],
    summaries: DuplicateGroup[] = duplicateGroups,
  ): DuplicateGroup[] => {
    const filesByGroup = new Map<string, DuplicateFilesPage['files']>()
    for (const file of files) {
      const bucket = filesByGroup.get(file.groupId) ?? []
      bucket.push(file)
      filesByGroup.set(file.groupId, bucket)
    }
    return summaries
      .filter((group) => filesByGroup.has(group.id))
      .map((group) => ({ ...group, files: filesByGroup.get(group.id) ?? [] }))
  }, [duplicateGroups])

  const loadDuplicateFiles = useCallback(async ({
    jobId,
    groupId = null,
    offset = 0,
    kind = resultKindFilter,
    summaries = duplicateGroups,
  }: {
    jobId: string
    groupId?: string | null
    offset?: number
    kind?: string
    summaries?: DuplicateGroup[]
  }) => {
    setDuplicateFilesBusy(true)
    const requestSeq = ++duplicateRequestSeqRef.current
    try {
      const next = await callNestify((api) => {
        if (!api.duplicatesFiles) throw new Error('duplicates.files is unavailable')
        return api.duplicatesFiles({ jobId, groupId, offset, limit: 200, kind })
      })
      if (duplicateRequestSeqRef.current !== requestSeq) return
      setDuplicateFiles(next.result.files)
      setDuplicateFilesOffset(next.result.offset)
      setDuplicateFilesTotal(next.result.total)
      setDuplicateFilesHasMore(next.result.hasMore)
      setDuplicateSelectedCount(next.result.selectedCount)
      setDuplicateSelectedBytes(next.result.selectedBytes)
      const fingerprint = ['duplicates', jobId, kind, groupId ?? 'all'].join(':')
      applyPlan(next.result.plan, 'duplicates', { offset: next.result.offset, fingerprint })
      setSelectedOps(syncDuplicateSelectedOps(groupsForLoadedFiles(next.result.files, summaries), next.result.plan))
    } finally {
      if (duplicateRequestSeqRef.current === requestSeq) setDuplicateFilesBusy(false)
    }
  }, [applyPlan, duplicateGroups, groupsForLoadedFiles, resultKindFilter, setSelectedOps])

  const refreshDuplicateResult = useCallback(async ({
    jobId,
    groupsOffset = 0,
    filesOffset = 0,
    groupId = null,
    kind = resultKindFilter,
  }: {
    jobId: string
    groupsOffset?: number
    filesOffset?: number
    groupId?: string | null
    kind?: string
  }) => {
    const requestSeq = ++duplicateRequestSeqRef.current
    const next = await callNestify((api) => {
      if (!api.duplicatesResult) throw new Error('duplicates.result is unavailable')
      return api.duplicatesResult({ jobId, offset: groupsOffset, limit: 100, kind })
    })
    if (duplicateRequestSeqRef.current !== requestSeq) return next.result
    setDuplicateGroups(next.result.groups)
    setDuplicateGroupsOffset(next.result.offset)
    setDuplicateGroupsTotal(next.result.total)
    setDuplicateGroupsHasMore(next.result.hasMore)
    setDuplicateResultFileCount(next.result.fileCount)
    setDuplicateResultWastedBytes(next.result.wastedBytes)
    setDuplicateSelectedCount(next.result.selectedCount)
    setDuplicateSelectedBytes(next.result.selectedBytes)
    if (duplicateRequestSeqRef.current !== requestSeq) return next.result
    await loadDuplicateFiles({ jobId, groupId, offset: filesOffset, kind, summaries: next.result.groups })
    return next.result
  }, [loadDuplicateFiles, resultKindFilter])

  const loadDuplicateResult = useCallback(async ({
    jobId,
    offset = 0,
    kind = resultKindFilter,
  }: {
    jobId: string
    offset?: number
    kind?: string
  }) => {
    setActiveGroupId(null)
    return refreshDuplicateResult({ jobId, groupsOffset: offset, filesOffset: 0, groupId: null, kind })
  }, [
    refreshDuplicateResult,
    resultKindFilter,
  ])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onDuplicateAnalysisProgress) return
    return api.onDuplicateAnalysisProgress((progress) => {
      if (duplicateJobId && progress.jobId && progress.jobId !== duplicateJobId) return
      setDuplicateAnalysisProgress(progress)
    })
  }, [duplicateJobId])

  useEffect(() => {
    if (duplicateStep !== 'analyzing' || !duplicateJobId) return
    let stopped = false
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const progress = await callNestify((api) => {
          if (!api.duplicateProgress) throw new Error('duplicates.progress is unavailable')
          return api.duplicateProgress({ jobId: duplicateJobId })
        })
        if (stopped || !progress) return
        setDuplicateAnalysisProgress(progress)
        if (progress.status === 'completed') {
          if (duplicateCompletedLoadJobRef.current === duplicateJobId) return
          duplicateCompletedLoadJobRef.current = duplicateJobId
          setDuplicateResultLoading(true)
          try {
            const result = await loadDuplicateResult({ jobId: duplicateJobId })
            if (stopped) return
            setDuplicateStep('result')
            setNotice(
              `重复分析完成，${result.total} 组 / ${result.fileCount} 份，可释放 ${formatBytes(result.wastedBytes)}`,
            )
          } catch (error) {
            duplicateCompletedLoadJobRef.current = null
            throw error
          } finally {
            setDuplicateResultLoading(false)
          }
        } else if (progress.status === 'failed' || progress.status === 'cancelled') {
          if (stopped) return
          setError(progress.error ?? (progress.status === 'cancelled' ? '重复分析已取消' : '重复分析失败'))
          setDuplicateStep('filter')
          setDuplicateAnalysisProgress(null)
        }
      } catch (error) {
        if (!stopped) setError(errorMessage(error))
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 500)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [duplicateJobId, duplicateStep, loadDuplicateResult, setError, setNotice])

  const handleDuplicateKeepStrategyChange = useCallback(
    async (value: KeepStrategy) => {
      setKeepStrategy(value)
      if (!duplicateJobId) return
      setBusy('duplicates')
      setError(null)
      try {
        await callNestify((api) => {
          if (!api.duplicateStrategy) throw new Error('duplicates.strategy is unavailable')
          return api.duplicateStrategy({
            jobId: duplicateJobId,
            keepStrategy: value,
            preferredDirectory: value === 'preferred_dir' ? directoryForDuplicates : undefined,
          })
        })
        await refreshDuplicateResult({
          jobId: duplicateJobId,
          groupsOffset: duplicateGroupsOffset,
          filesOffset: duplicateFilesOffset,
          groupId: activeGroupId,
        })
      } catch (error) {
        setError(errorMessage(error))
      } finally {
        setBusy(null)
      }
    },
    [
      activeGroupId,
      directoryForDuplicates,
      duplicateFilesOffset,
      duplicateGroupsOffset,
      duplicateJobId,
      refreshDuplicateResult,
      setBusy,
      setError,
    ],
  )

  const handleAnalyzeDuplicates = useCallback(async () => {
    if (analyzeBlockReason) {
      setError(analyzeBlockReason)
      setNotice(null)
      return
    }
    if (!libraryForDirectory) return
    void getNestifyApi()?.logEvent?.('renderer.duplicates.request', {
      libraryId: libraryForDirectory.id,
      scope: 'directory',
      directory: directoryForDuplicates,
      filter: duplicateFilter.trim() || null,
      keepStrategy,
    })
    setBusy('duplicates')
    setDuplicateStep('analyzing')
    setDuplicateAnalysisProgress(null)
    setDuplicateResultLoading(false)
    duplicateCompletedLoadJobRef.current = null
    setError(null)
    try {
      const started = await callNestify((api) =>
        api.duplicatesAnalyze({
          libraryId: libraryForDirectory.id,
          scope: 'directory',
          directory: directoryForDuplicates,
          filter: duplicateFilter.trim() || undefined,
          hashStrategy: duplicateHashStrategy,
          keepStrategy,
          dispose: 'quarantine',
        }),
      )
      setDuplicateJobId(started.jobId)
    } catch (err) {
      setError(errorMessage(err))
      setDuplicateStep('filter')
      setDuplicateAnalysisProgress(null)
    } finally {
      setBusy(null)
    }
  }, [analyzeBlockReason, directoryForDuplicates, duplicateFilter, duplicateHashStrategy, keepStrategy, libraryForDirectory, setBusy, setError])

  const handleDuplicateCancelAnalysis = useCallback(async () => {
    if (!duplicateJobId) return
    try {
      await callNestify((api) => {
        if (!api.duplicateCancel) throw new Error('duplicates.cancel is unavailable')
        return api.duplicateCancel({ jobId: duplicateJobId })
      })
    } catch (error) {
      setError(errorMessage(error))
    }
  }, [duplicateJobId, setError])

  const handleDuplicateGroupsPage = useCallback((delta: -1 | 1) => {
    if (!duplicateJobId) return
    const offset = Math.max(0, duplicateGroupsOffset + delta * 100)
    if (offset === duplicateGroupsOffset) return
    void loadDuplicateResult({ jobId: duplicateJobId, offset }).catch((error) => setError(errorMessage(error)))
  }, [duplicateGroupsOffset, duplicateJobId, loadDuplicateResult, setError])

  const handleDuplicateSelectGroup = useCallback((groupId: string | null) => {
    setActiveGroupId(groupId)
    if (!duplicateJobId) return
    void loadDuplicateFiles({ jobId: duplicateJobId, groupId, offset: 0 }).catch((error) => setError(errorMessage(error)))
  }, [duplicateJobId, loadDuplicateFiles, setError])

  const handleDuplicateFilesPage = useCallback((delta: -1 | 1) => {
    if (!duplicateJobId) return
    const offset = Math.max(0, duplicateFilesOffset + delta * 200)
    if (offset === duplicateFilesOffset) return
    void loadDuplicateFiles({ jobId: duplicateJobId, groupId: activeGroupId, offset }).catch((error) => setError(errorMessage(error)))
  }, [activeGroupId, duplicateFilesOffset, duplicateJobId, loadDuplicateFiles, setError])

  const handleDuplicateResultKindChange = useCallback((value: string) => {
    setResultKindFilter(value)
    if (!duplicateJobId) return
    void loadDuplicateResult({ jobId: duplicateJobId, offset: 0, kind: value }).catch((error) => setError(errorMessage(error)))
  }, [duplicateJobId, loadDuplicateResult, setError])

  const handleDuplicatePreviewSort = useCallback((field: 'name' | 'size' | 'mtime') => {
    directoryPreview.sort(field, directoryForDuplicates, duplicateDirectoryId)
  }, [directoryPreview, directoryForDuplicates, duplicateDirectoryId])

  const handleDuplicatePreviewPage = useCallback((delta: -1 | 1) => {
    directoryPreview.page(delta, directoryForDuplicates, duplicateDirectoryId)
  }, [directoryPreview, directoryForDuplicates, duplicateDirectoryId])

  const handleDuplicateFilterChange = useCallback((value: string) => {
    setDuplicateFilter(value)
    setActiveGroupId(null)
    filterPreview.schedule(value)
  }, [filterPreview])

  const handleDuplicateFilterPreviewPage = useCallback((delta: -1 | 1) => {
    filterPreview.page(duplicateFilter, delta)
  }, [duplicateFilter, filterPreview])

  const handleDuplicateEnterDirectory = useCallback((hit: SearchHit) => {
    if (hit.kind !== 'dir' || !hit.path) return
    filterPreview.invalidate()
    setDuplicateDirectory(hit.path)
    setDuplicateDirectoryId(hit.entryId)
    setDuplicateGroups([])
    setDuplicateFiles([])
    void directoryPreview.load(hit.path, undefined, hit.entryId)
  }, [directoryPreview, filterPreview])

  const handleDuplicateGoParent = useCallback(() => {
    const rootPath = libraryForDirectory ? matchingRootPath(directoryForDuplicates, libraryForDirectory.roots) : null
    const parent = parentDirectoryPath(directoryForDuplicates, rootPath)
    if (!parent) return
    filterPreview.invalidate()
    setDuplicateDirectory(parent)
    setDuplicateDirectoryId(null)
    setDuplicateGroups([])
    setDuplicateFiles([])
    void directoryPreview.load(parent)
  }, [directoryPreview, directoryForDuplicates, filterPreview, libraryForDirectory])

  const handleDuplicateToggleKeep = useCallback(async (groupId: string, entryId: string) => {
    setActiveGroupId(groupId)
    const groupFiles = duplicateFiles.filter((file) => file.groupId === groupId)
    const target = groupFiles.find((file) => file.entryId === entryId)
    if (!target || target.keep) return
    const nextKeep = !target.keep
    if (!duplicateJobId) return
    setBusy('duplicates')
    setError(null)
    try {
      await callNestify((api) => {
        if (!api.duplicateKeep) throw new Error('duplicates.keep is unavailable')
        return api.duplicateKeep({ jobId: duplicateJobId, groupId, entryId, keep: nextKeep })
      })
      await refreshDuplicateResult({
        jobId: duplicateJobId,
        groupsOffset: duplicateGroupsOffset,
        filesOffset: duplicateFilesOffset,
        groupId: activeGroupId,
      })
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }, [
    activeGroupId,
    duplicateFiles,
    duplicateFilesOffset,
    duplicateGroupsOffset,
    duplicateJobId,
    refreshDuplicateResult,
    setBusy,
    setError,
  ])

  const handleDuplicateResetGroup = useCallback(async (groupId: string) => {
    setActiveGroupId(groupId)
    if (!duplicateJobId) return
    setBusy('duplicates')
    setError(null)
    try {
      await callNestify((api) => {
        if (!api.duplicateGroupStrategy) throw new Error('duplicates.groupStrategy is unavailable')
        return api.duplicateGroupStrategy({
          jobId: duplicateJobId,
          groupId,
          keepStrategy,
          preferredDirectory: keepStrategy === 'preferred_dir' ? directoryForDuplicates : undefined,
        })
      })
      await refreshDuplicateResult({
        jobId: duplicateJobId,
        groupsOffset: duplicateGroupsOffset,
        filesOffset: duplicateFilesOffset,
        groupId: activeGroupId,
      })
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }, [
    activeGroupId,
    directoryForDuplicates,
    duplicateFilesOffset,
    duplicateGroupsOffset,
    duplicateJobId,
    keepStrategy,
    refreshDuplicateResult,
    setBusy,
    setError,
  ])

  const duplicateExecutionSource = useCallback(() => (
    duplicateJobId && duplicateSelectedCount > 0
      ? { jobId: duplicateJobId, kind: resultKindFilter }
      : null
  ), [duplicateJobId, duplicateSelectedCount, resultKindFilter])

  const handleUseDuplicateDirectory = useCallback(async (path: string) => {
    directoryPreview.invalidate()
    filterPreview.invalidate()
    setDuplicateDirectory(path)
    setDuplicateDirectoryId(null)
    setDuplicateGroups([])
    setDuplicateFiles([])
    setDuplicateStep(path.trim() ? 'filter' : 'pick')
    if (!path.trim()) return
    setBusy('duplicates')
    try {
      await directoryPreview.load(path)
    } finally {
      setBusy(null)
    }
  }, [directoryPreview, filterPreview, setBusy])

  const handlePickDuplicateDirectory = useCallback(async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked?.path) return
      await handleUseDuplicateDirectory(picked.path)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [handleUseDuplicateDirectory, setError])

  const handleDuplicateDirectoryChange = useCallback((value: string) => {
    directoryPreview.invalidate()
    filterPreview.invalidate()
    setDuplicateDirectory(value)
    setDuplicateDirectoryId(null)
    setDuplicateGroups([])
    setDuplicateFiles([])
    setDuplicateStep(value.trim() ? 'filter' : 'pick')
  }, [directoryPreview, filterPreview])

  return {
    duplicateFingerprint,
    duplicateGroups,
    keepStrategy,
    setKeepStrategy,
    duplicateHashStrategy,
    setDuplicateHashStrategy,
    duplicateScope,
    setDuplicateScope,
    duplicateDirectory,
    setDuplicateDirectory,
    handlePickDuplicateDirectory,
    handleUseDuplicateDirectory,
    handleDuplicateDirectoryChange,
    handleAnalyzeDuplicates,
    handleDuplicateCancelAnalysis,
    handleDuplicateGroupsPage,
    handleDuplicateSelectGroup,
    handleDuplicateFilesPage,
    handleDuplicateResultKindChange,
    duplicateExecutionSource,
    handleDuplicateFilterChange,
    handleDuplicateKeepStrategyChange,
    handleDuplicateToggleKeep,
    handleDuplicateResetGroup,
    duplicateStep,
    setDuplicateStep,
    duplicateFilter,
    setDuplicateFilter,
    duplicateFilterPreview: filterPreview.hits,
    duplicateFilterPreviewTotal: filterPreview.total,
    duplicateFilterPreviewOffset: filterPreview.offset,
    duplicateFilterPreviewHasMore: filterPreview.hasMore,
    duplicateFilterPreviewBusy: filterPreview.busy,
    duplicateAnalysisProgress,
    duplicateResultLoading,
    duplicateJobId,
    duplicateGroupsOffset,
    duplicateGroupsTotal,
    duplicateGroupsHasMore,
    duplicateResultFileCount,
    duplicateResultWastedBytes,
    duplicateSelectedCount,
    duplicateSelectedBytes,
    duplicateFiles,
    duplicateFilesOffset,
    duplicateFilesTotal,
    duplicateFilesHasMore,
    duplicateFilesBusy,
    resultKindFilter,
    activeGroupId,
    setActiveGroupId,
    groupsPaneWidth,
    setGroupsPaneWidth,
    duplicatePreview: directoryPreview.hits,
    duplicatePreviewTotal: directoryPreview.total,
    duplicatePreviewOffset: directoryPreview.offset,
    duplicatePreviewHasMore: directoryPreview.hasMore,
    duplicatePreviewBusy: directoryPreview.busy,
    duplicatePreviewSort: directoryPreview.sortField,
    duplicatePreviewSortDirection: directoryPreview.sortDirection,
    handleDuplicatePreviewSort,
    handleDuplicatePreviewPage,
    handleDuplicateFilterPreviewPage,
    handleDuplicateEnterDirectory,
    handleDuplicateGoParent,
    canPreviewScope,
    analyzeBlockReason,
    libraryForDirectory,
    canDuplicateGoParent,
  }
}
