import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  callNestify,
  getNestifyApi,
  type ChangePlan,
  type DuplicateGroup,
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
import type { PlanState } from '@/app/plan-state'
import {
  applyKeepStrategyToGroups,
  compareKeepHit,
  ensureDuplicateLoserOps,
  syncDuplicateSelectedOps,
} from '@/app/duplicate-strategy'
import { useDirectoryPreview } from '@/app/useDirectoryPreview'
import { useExpressionPreview } from '@/app/useExpressionPreview'

export function useDuplicateWizard({
  libraries,
  tab,
  duplicatePlan,
  planState,
  setError,
  setNotice,
  setBusy,
  applyPlan,
  setPlanState,
  setSelectedOps,
}: {
  libraries: LibrarySummary[]
  tab: string
  duplicatePlan: ChangePlan | null
  planState: PlanState | null
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  setBusy: (value: string | null) => void
  applyPlan: (plan: ChangePlan) => void
  setPlanState: Dispatch<SetStateAction<PlanState | null>>
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
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groupsPaneWidth, setGroupsPaneWidth] = useState(240)
  const directoryPreview = useDirectoryPreview({ libraries, matchMode: 'inside-root' })
  const filterPreview = useExpressionPreview({ libraries, directory: duplicateDirectory })

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
    const api = getNestifyApi()
    if (!api?.onDuplicateAnalysisProgress) return
    return api.onDuplicateAnalysisProgress((progress) => setDuplicateAnalysisProgress(progress))
  }, [])

  useEffect(() => {
    if (duplicateStep !== 'analyzing') return
    const timer = window.setInterval(() => {
      void callNestify((api) =>
        api.duplicateProgress ? api.duplicateProgress() : Promise.reject(new Error('duplicates.progress is unavailable')),
      )
        .then((progress) => {
          if (progress) setDuplicateAnalysisProgress(progress)
        })
        .catch(() => undefined)
    }, 500)
    return () => window.clearInterval(timer)
  }, [duplicateStep])

  useEffect(() => {
    setDuplicateGroups([])
  }, [duplicateFingerprint])

  const handleDuplicateKeepStrategyChange = useCallback(
    (value: KeepStrategy) => {
      setKeepStrategy(value)
      if (duplicateGroups.length === 0) return
      const nextGroups = applyKeepStrategyToGroups(duplicateGroups, value, directoryForDuplicates)
      setDuplicateGroups(nextGroups)
      if (planState?.source === 'duplicates' && duplicatePlan && duplicatePlan.ops.length > 0) {
        const nextPlan = ensureDuplicateLoserOps(duplicatePlan, nextGroups)
        setPlanState({ ...planState, plan: nextPlan })
        setSelectedOps(syncDuplicateSelectedOps(nextGroups, nextPlan))
      }
    },
    [directoryForDuplicates, duplicateGroups, duplicatePlan, planState, setPlanState, setSelectedOps],
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
    setError(null)
    try {
      const next = await callNestify((api) =>
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
      setDuplicateGroups(next.groups)
      applyPlan(next.plan)
      setActiveGroupId(next.groups.length > 0 ? next.groups[0]!.id : null)
      setDuplicateStep('result')
      setNotice(
        `重复分析完成（资料库「${libraryForDirectory.name}」），${next.groups.length} 组 / 可释放 ${formatBytes(
          next.groups.reduce((sum, group) => sum + group.wastedBytes, 0),
        )}`,
      )
    } catch (err) {
      setError(errorMessage(err))
      setDuplicateStep('filter')
      setDuplicateAnalysisProgress(null)
    } finally {
      setBusy(null)
    }
  }, [analyzeBlockReason, applyPlan, directoryForDuplicates, duplicateFilter, duplicateHashStrategy, keepStrategy, libraryForDirectory, setBusy, setError, setNotice])

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
    void directoryPreview.load(parent)
  }, [directoryPreview, directoryForDuplicates, filterPreview, libraryForDirectory])

  const handleDuplicateToggleKeep = useCallback((groupId: string, entryId: string) => {
    setActiveGroupId(groupId)
    setDuplicateGroups((current) =>
      current.map((group) => {
        if (group.id !== groupId) return group
        const target = group.files.find((file) => file.entryId === entryId)
        if (!target) return group
        const keeping = group.files.filter((file) => file.keep)
        if (target.keep && keeping.length <= 1) return group
        return {
          ...group,
          files: group.files.map((file) => (file.entryId === entryId ? { ...file, keep: !file.keep } : file)),
        }
      }),
    )
    if (planState?.source !== 'duplicates' || !duplicatePlan) return
    const group = duplicateGroups.find((item) => item.id === groupId)
    if (!group) return
    const target = group.files.find((file) => file.entryId === entryId)
    if (!target || (target.keep && group.files.filter((file) => file.keep).length <= 1)) return
    const nextKeep = !target.keep
    setSelectedOps((current) => {
      const map = { ...current }
      duplicatePlan.ops.forEach((op, index) => {
        if (op.entryId === entryId) map[index] = !nextKeep
      })
      return map
    })
  }, [duplicateGroups, duplicatePlan, planState, setSelectedOps])

  const handleDuplicateResetGroup = useCallback((groupId: string) => {
    setActiveGroupId(groupId)
    const group = duplicateGroups.find((item) => item.id === groupId)
    if (!group || !duplicatePlan || planState?.source !== 'duplicates') return
    const sorted = [...group.files].sort((a, b) => compareKeepHit(a, b, keepStrategy, directoryForDuplicates))
    const keepId = sorted[0]?.entryId
    setDuplicateGroups((current) =>
      current.map((item) =>
        item.id === groupId
          ? { ...item, files: item.files.map((file) => ({ ...file, keep: file.entryId === keepId })) }
          : item,
      ),
    )
    setSelectedOps((current) => {
      const map = { ...current }
      duplicatePlan.ops.forEach((op, index) => {
        if (op.entryId && group.files.some((file) => file.entryId === op.entryId)) {
          map[index] = op.entryId !== keepId
        }
      })
      return map
    })
  }, [directoryForDuplicates, duplicateGroups, duplicatePlan, keepStrategy, planState, setSelectedOps])

  const handleUseDuplicateDirectory = useCallback(async (path: string) => {
    directoryPreview.invalidate()
    filterPreview.invalidate()
    setDuplicateDirectory(path)
    setDuplicateDirectoryId(null)
    setDuplicateGroups([])
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
