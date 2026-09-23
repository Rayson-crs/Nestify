import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  callNestify,
  type ChangePlan,
  type Collision,
  type LibrarySummary,
  type OrganizePreviewPayload,
  type OrganizeRuleInput,
  type OrganizeSnapshotPayload,
  type SearchHit,
} from '@/lib/ipc'
import { matchingRootPath, parentDirectoryPath } from '@/lib/path-crumbs'
import { errorMessage } from '@/lib/labels'
import type { OrganizeStep } from '@/app/types'
import type { PlanState } from '@/app/plan-state'
import { useDirectoryPreview } from '@/app/useDirectoryPreview'
import { useExpressionPreview } from '@/app/useExpressionPreview'

const DEFAULT_ORGANIZE_RULES: OrganizeRuleInput[] = [
  {
    id: 'organize-images',
    name: '图片归类',
    enabled: true,
    priority: 10,
    target: 'files',
    scope: 'all',
    filter: 'kind:image',
    continueMatching: false,
    action: 'move',
    template: '图片/{name}{ext}',
    reason: '按图片扩展名移动到图片目录',
  },
  {
    id: 'organize-videos',
    name: '视频归类',
    enabled: true,
    priority: 20,
    target: 'files',
    scope: 'all',
    filter: 'kind:video',
    continueMatching: false,
    action: 'move',
    template: '视频/{name}{ext}',
    reason: '按视频扩展名移动到视频目录',
  },
  {
    id: 'organize-documents',
    name: '文档归类',
    enabled: true,
    priority: 30,
    target: 'files',
    scope: 'all',
    filter: 'kind:document',
    continueMatching: false,
    action: 'move',
    template: '文档/{name}{ext}',
    reason: '按文档扩展名移动到文档目录',
  },
]

export function useOrganizeWizard({
  libraries,
  tab,
  collision,
  hasPlan,
  setError,
  setNotice,
  setBusy,
  applyPlan,
  setPlanState,
}: {
  libraries: LibrarySummary[]
  tab: string
  collision: Collision
  hasPlan: boolean
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  setBusy: (value: string | null) => void
  applyPlan: (plan: ChangePlan) => void
  setPlanState: Dispatch<SetStateAction<PlanState | null>>
}) {
  const [organizeDirectory, setOrganizeDirectory] = useState('')
  const [organizeDirectoryId, setOrganizeDirectoryId] = useState<string | null>(null)
  const [organizeStep, setOrganizeStep] = useState<OrganizeStep>('pick')
  const [organizeFilter, setOrganizeFilter] = useState('')
  const [organizeRuleDraft, setOrganizeRuleDraft] = useState<OrganizeRuleInput[]>(() =>
    structuredClone(DEFAULT_ORGANIZE_RULES),
  )
  const [organizePreview, setOrganizePreview] = useState<OrganizePreviewPayload | null>(null)
  const [organizeSnapshot, setOrganizeSnapshot] = useState<OrganizeSnapshotPayload | null>(null)
  const [organizePreviewBusy, setOrganizePreviewBusy] = useState(false)
  const organizePreviewRequestId = useRef(0)
  const organizeSnapshotRef = useRef<OrganizeSnapshotPayload | null>(null)

  const directoryPreview = useDirectoryPreview({ libraries, matchMode: 'exact-root' })
  const filterPreview = useExpressionPreview({ libraries, directory: organizeDirectory })
  const organizeDirectoryValue = organizeDirectory.trim()
  const libraryForOrganize = useMemo(
    () => (organizeDirectoryValue
      ? libraries.find((library) => matchingRootPath(organizeDirectoryValue, library.roots)) ?? null
      : null),
    [libraries, organizeDirectoryValue],
  )
  const organizeCanPick = organizeDirectoryValue.length > 0 && libraryForOrganize !== null
  const organizeCanRules = organizeCanPick && organizeRuleDraft.some((rule) => {
    if (!rule.enabled || !rule.name.trim() || !rule.action) return false
    if (rule.action === 'delete_to_quarantine' || rule.action === 'flatten_dir') return true
    return Boolean(rule.template?.trim()) || Boolean(rule.steps?.some((step) => step.template?.trim()))
  })
  const organizeBlockReason = (() => {
    if (libraries.length === 0) return '还没有任何资料库，先去左侧「资料库」里添加一个'
    if (!organizeDirectoryValue) return '先在上面填入或选择要整理的文件夹'
    if (!libraryForOrganize) return '该文件夹不在任何资料库范围内，请先把它加入资料库后再整理'
    return null
  })()
  const canOrganizeGoParent = Boolean(
    parentDirectoryPath(
      organizeDirectoryValue,
      libraryForOrganize ? matchingRootPath(organizeDirectoryValue, libraryForOrganize.roots) : null,
    ),
  )

  const resetOrganizeArtifacts = useCallback(() => {
    filterPreview.invalidate()
    setOrganizePreview(null)
    setOrganizeSnapshot(null)
    organizeSnapshotRef.current = null
    setPlanState(null)
  }, [filterPreview, setPlanState])

  const handleUseOrganizeDirectory = useCallback(async (path: string) => {
    directoryPreview.invalidate()
    resetOrganizeArtifacts()
    setOrganizeDirectory(path)
    setOrganizeDirectoryId(null)
    setOrganizeStep(path.trim() ? 'filter' : 'pick')
    if (!path.trim()) return
    setBusy('organize')
    try {
      await directoryPreview.load(path)
    } finally {
      setBusy(null)
    }
  }, [directoryPreview, resetOrganizeArtifacts, setBusy])

  const handlePickOrganizeDirectory = useCallback(async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked?.path) return
      await handleUseOrganizeDirectory(picked.path)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [handleUseOrganizeDirectory, setError])

  const handleOrganizeDirectoryChange = useCallback((value: string) => {
    directoryPreview.invalidate()
    resetOrganizeArtifacts()
    setOrganizeDirectory(value)
    setOrganizeDirectoryId(null)
    setOrganizeStep(value.trim() ? 'filter' : 'pick')
  }, [directoryPreview, resetOrganizeArtifacts])

  const handleOrganizeFilterChange = useCallback((value: string) => {
    setOrganizeFilter(value)
    filterPreview.schedule(value)
  }, [filterPreview])

  const handleOrganizePreviewSort = useCallback((field: 'name' | 'size' | 'mtime') => {
    directoryPreview.sort(field, organizeDirectoryValue, organizeDirectoryId)
  }, [directoryPreview, organizeDirectoryId, organizeDirectoryValue])

  const handleOrganizeDirectoryPreviewPage = useCallback((delta: -1 | 1) => {
    directoryPreview.page(delta, organizeDirectoryValue, organizeDirectoryId)
  }, [directoryPreview, organizeDirectoryId, organizeDirectoryValue])

  const handleOrganizeFilterPreviewPage = useCallback((delta: -1 | 1) => {
    filterPreview.page(organizeFilter, delta)
  }, [filterPreview, organizeFilter])

  const handleOrganizeEnterDirectory = useCallback((hit: SearchHit) => {
    if (hit.kind !== 'dir' || !hit.path) return
    filterPreview.invalidate()
    setOrganizeDirectory(hit.path)
    setOrganizeDirectoryId(hit.entryId)
    setOrganizePreview(null)
    setOrganizeSnapshot(null)
    organizeSnapshotRef.current = null
    void directoryPreview.load(hit.path, undefined, hit.entryId)
  }, [directoryPreview, filterPreview])

  const handleOrganizeGoParent = useCallback(() => {
    const parent = parentDirectoryPath(
      organizeDirectoryValue,
      libraryForOrganize ? matchingRootPath(organizeDirectoryValue, libraryForOrganize.roots) : null,
    )
    if (!parent) return
    filterPreview.invalidate()
    setOrganizeDirectory(parent)
    setOrganizeDirectoryId(null)
    setOrganizePreview(null)
    setOrganizeSnapshot(null)
    organizeSnapshotRef.current = null
    void directoryPreview.load(parent)
  }, [directoryPreview, filterPreview, libraryForOrganize, organizeDirectoryValue])

  const handleOrganizeNextFromFilter = useCallback(() => {
    if (organizeBlockReason) {
      setError(organizeBlockReason)
      return
    }
    setOrganizeStep('rules')
  }, [organizeBlockReason, setError])

  const handleOrganizePreview = useCallback(async (options?: { silent?: boolean }) => {
    if (!organizeCanPick || !libraryForOrganize) return false
    const requestId = ++organizePreviewRequestId.current
    if (!options?.silent) {
      setBusy('organize')
      setError(null)
    }
    setOrganizePreviewBusy(true)
    try {
      const scopeInput = { libraryId: libraryForOrganize.id, scope: 'directory' as const, directory: organizeDirectoryValue }
      const cached = organizeSnapshotRef.current
      const snapshot = cached
        && cached.libraryId === libraryForOrganize.id
        && (cached.directory ?? '') === organizeDirectoryValue
        ? cached
        : (await callNestify((api) => api.organizeSnapshot(scopeInput))).snapshot
      if (requestId !== organizePreviewRequestId.current) return false
      const { preview } = await callNestify((api) => api.organizePreview({
        ...scopeInput,
        rules: organizeRuleDraft,
        snapshotId: snapshot.id,
        filter: organizeFilter.trim() || undefined,
        collision,
      }))
      if (requestId !== organizePreviewRequestId.current) return false
      organizeSnapshotRef.current = snapshot
      setOrganizeSnapshot(snapshot)
      setOrganizePreview(preview)
      applyPlan(preview.plan)
      if (!options?.silent) setNotice(`整理预览完成：${preview.rows.length} 项变更，范围 ${snapshot.stats.selected} 项`)
      return true
    } catch (err) {
      if (requestId !== organizePreviewRequestId.current) return false
      setError(errorMessage(err))
      return false
    } finally {
      if (requestId === organizePreviewRequestId.current) {
        setOrganizePreviewBusy(false)
        if (!options?.silent) setBusy(null)
      }
    }
  }, [applyPlan, collision, organizeCanPick, organizeDirectoryValue, organizeFilter, organizeRuleDraft, libraryForOrganize, setBusy, setError, setNotice])

  const handleOrganizeNextFromRules = useCallback(async () => {
    if (!organizeCanRules) {
      setError('请至少启用一条完整的整理规则')
      return
    }
    const ok = await handleOrganizePreview()
    if (ok) setOrganizeStep('result')
  }, [handleOrganizePreview, organizeCanRules, setError])

  useEffect(() => {
    if (tab !== 'organize' || (organizeStep !== 'rules' && organizeStep !== 'result')) return
    if (organizeStep === 'result' && !hasPlan) setOrganizeStep('rules')
  }, [hasPlan, organizeStep, tab])

  useEffect(() => {
    if (tab !== 'organize' || organizeStep !== 'rules' || !organizeCanPick) {
      organizePreviewRequestId.current += 1
      setOrganizePreviewBusy(false)
      return
    }
    organizePreviewRequestId.current += 1
    setOrganizePreviewBusy(true)
    const timer = window.setTimeout(() => {
      void handleOrganizePreview({ silent: true })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [tab, organizeStep, organizeCanPick, organizeDirectoryValue, organizeFilter, organizeRuleDraft, collision, libraryForOrganize?.id])

  return {
    organizeDirectory,
    setOrganizeDirectory,
    organizeDirectoryId,
    organizeStep,
    setOrganizeStep,
    organizeFilter,
    setOrganizeFilter,
    organizeFilterPreview: filterPreview.hits,
    organizeFilterPreviewTotal: filterPreview.total,
    organizeFilterPreviewOffset: filterPreview.offset,
    organizeFilterPreviewHasMore: filterPreview.hasMore,
    organizeFilterPreviewBusy: filterPreview.busy,
    organizeDirectoryPreview: directoryPreview.hits,
    organizeDirectoryPreviewTotal: directoryPreview.total,
    organizeDirectoryPreviewOffset: directoryPreview.offset,
    organizeDirectoryPreviewHasMore: directoryPreview.hasMore,
    organizeDirectoryPreviewBusy: directoryPreview.busy,
    organizeDirectoryPreviewSort: directoryPreview.sortField,
    organizeDirectoryPreviewSortDirection: directoryPreview.sortDirection,
    organizeRuleDraft,
    setOrganizeRuleDraft,
    organizePreview,
    organizeSnapshot,
    organizePreviewBusy,
    organizeCanPick,
    organizeCanRules,
    organizeBlockReason,
    libraryForOrganize,
    handlePickOrganizeDirectory,
    handleUseOrganizeDirectory,
    handleOrganizeDirectoryChange,
    handleOrganizeFilterChange,
    handleOrganizePreviewSort,
    handleOrganizeDirectoryPreviewPage,
    handleOrganizeFilterPreviewPage,
    handleOrganizeEnterDirectory,
    handleOrganizeGoParent,
    canOrganizeGoParent,
    handleOrganizeNextFromFilter,
    handleOrganizeNextFromRules,
    handleOrganizePreview,
  }
}
