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
import type { PlanApplyOptions, PlanState } from '@/app/plan-state'
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

const ORGANIZE_PLAN_PAGE_SIZE = 200

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
  applyPlan: (plan: ChangePlan, options?: PlanApplyOptions) => void
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
  const organizePreviewInFlightRef = useRef<{ key: string; promise: Promise<boolean> } | null>(null)
  const organizePlanPageRef = useRef<{ offset: number; cursors: Array<ChangePlan["seqCursor"]> }>({ offset: 0, cursors: [] })
  const [organizePlanOffset, setOrganizePlanOffset] = useState(0)
  const [organizePlanTotal, setOrganizePlanTotal] = useState(0)
  const organizeSnapshotRef = useRef<OrganizeSnapshotPayload | null>(null)
  const organizePlanOffsetRef = useRef(0)
  const organizeFingerprintRef = useRef('')

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
  const organizePlanFingerprint = useMemo(() => [
    libraryForOrganize?.id ?? '',
    organizeDirectoryValue,
    organizeFilter.trim(),
    JSON.stringify(organizeRuleDraft),
    collision,
  ].join('\n'), [collision, libraryForOrganize?.id, organizeDirectoryValue, organizeFilter, organizeRuleDraft])
  useEffect(() => {
    organizeFingerprintRef.current = organizePlanFingerprint
  }, [organizePlanFingerprint])
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
    organizePreviewInFlightRef.current = null
    organizePlanPageRef.current = { offset: 0, cursors: [] }
    setOrganizePlanOffset(0)
    organizePlanOffsetRef.current = 0
    setOrganizePlanTotal(0)
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
    resetOrganizeArtifacts()
    setOrganizeDirectory(hit.path)
    setOrganizeDirectoryId(hit.entryId)
    void directoryPreview.load(hit.path, undefined, hit.entryId)
  }, [directoryPreview, resetOrganizeArtifacts])

  const handleOrganizeGoParent = useCallback(() => {
    const parent = parentDirectoryPath(
      organizeDirectoryValue,
      libraryForOrganize ? matchingRootPath(organizeDirectoryValue, libraryForOrganize.roots) : null,
    )
    if (!parent) return
    resetOrganizeArtifacts()
    setOrganizeDirectory(parent)
    setOrganizeDirectoryId(null)
    void directoryPreview.load(parent)
  }, [directoryPreview, resetOrganizeArtifacts, libraryForOrganize, organizeDirectoryValue])

  const handleOrganizeNextFromFilter = useCallback(() => {
    if (organizeBlockReason) {
      setError(organizeBlockReason)
      return
    }
    setOrganizeStep('rules')
  }, [organizeBlockReason, setError])

  const handleOrganizePreview = useCallback(async (options?: { silent?: boolean; offset?: number; seqCursor?: ChangePlan["seqCursor"] }) => {
    if (!organizeCanPick || !libraryForOrganize) return false
    const requestId = ++organizePreviewRequestId.current
    if (!options?.silent) {
      setBusy('organize')
      setError(null)
    }
    setOrganizePreviewBusy(true)
    try {
      const scopeInput = { libraryId: libraryForOrganize.id, scope: 'directory' as const, directory: organizeDirectoryValue }
      const { preview } = await callNestify((api) => api.organizePreview({
        ...scopeInput,
        rules: organizeRuleDraft,
        filter: organizeFilter.trim() || undefined,
        offset: options?.offset ?? 0,
        limit: ORGANIZE_PLAN_PAGE_SIZE,
        seqCursor: options?.seqCursor,
        collision,
      }))
      if (requestId !== organizePreviewRequestId.current || organizeFingerprintRef.current !== organizePlanFingerprint) return false
      organizeSnapshotRef.current = preview.snapshot
      setOrganizeSnapshot(preview.snapshot)
      const pageOffset = preview.plan.sourceOffset ?? options?.offset ?? 0
      const pageOps = preview.plan.ops
      organizePlanPageRef.current = {
        offset: Math.max(organizePlanPageRef.current.offset, pageOffset),
        cursors: (() => {
          const cursors = [...organizePlanPageRef.current.cursors]
          cursors[pageOffset / ORGANIZE_PLAN_PAGE_SIZE] = preview.plan.seqCursor
          return cursors
        })(),
      }
      setOrganizePlanTotal(
        preview.sourceHasMore
          ? -1
          : pageOffset + preview.sourceCount,
      )
      setOrganizePreview(preview)
      applyPlan(preview.plan, { offset: pageOffset, fingerprint: organizePlanFingerprint })
      if (!options?.silent) setNotice(`整理预览完成：${preview.rows.length} 项变更`)
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
  }, [applyPlan, organizeCanPick, organizeDirectoryValue, organizeFilter, organizePlanFingerprint, organizeRuleDraft, libraryForOrganize, setBusy, setError, setNotice])

  const loadOrganizePlanPage = useCallback(async (targetOffset: number) => {
    const cached = organizePlanPageRef.current
    const pageIndex = targetOffset / ORGANIZE_PLAN_PAGE_SIZE
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return false
    const cursor = targetOffset === 0 ? undefined : cached.cursors[pageIndex - 1]
    if (targetOffset > 0 && !cursor) return false
    const key = `${organizePlanFingerprint}:${targetOffset}:${cursor ? JSON.stringify(cursor) : ''}`
    const inFlight = organizePreviewInFlightRef.current
    if (inFlight?.key === key) return inFlight.promise
    const promise = handleOrganizePreview({
      silent: true,
      offset: targetOffset,
      seqCursor: cursor,
    })
    organizePreviewInFlightRef.current = { key, promise }
    try {
      return await promise
    } finally {
      if (organizePreviewInFlightRef.current?.key === key) organizePreviewInFlightRef.current = null
    }
  }, [handleOrganizePreview, organizePlanFingerprint])

  const handleOrganizeNextFromRules = useCallback(async () => {
    if (!organizeCanRules) {
      setError('请先启用至少一条带动作的整理规则')
      return
    }
    const ok = await loadOrganizePlanPage(0)
    if (ok) setOrganizeStep('result')
  }, [loadOrganizePlanPage, organizeCanRules, setError])

  const handleOrganizePlanPage = useCallback(async (delta: -1 | 1) => {
    if (delta > 0 && organizePreview?.sourceHasMore === false) return
    const nextOffset = Math.max(0, organizePlanOffset + delta * ORGANIZE_PLAN_PAGE_SIZE)
    if (nextOffset === organizePlanOffset) return
    const ok = await loadOrganizePlanPage(nextOffset)
    if (ok) {
      setOrganizePlanOffset(nextOffset)
      organizePlanOffsetRef.current = nextOffset
    }
  }, [loadOrganizePlanPage, organizePlanOffset, organizePreview?.sourceHasMore])

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
    organizePreviewInFlightRef.current = null
    organizePlanPageRef.current = { offset: 0, cursors: [] }
    setOrganizePlanOffset(0)
    organizePlanOffsetRef.current = 0
    setOrganizePlanTotal(0)
    setOrganizePreview(null)
    setOrganizeSnapshot(null)
    organizeSnapshotRef.current = null
    const timer = window.setTimeout(() => {
      void loadOrganizePlanPage(0)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [loadOrganizePlanPage, tab, organizeStep, organizeCanPick, organizeDirectoryValue, organizeFilter, organizeRuleDraft, collision, libraryForOrganize?.id])

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
    organizePlanOffset,
    organizePlanTotal,
    handleOrganizePlanPage,
  }
}
