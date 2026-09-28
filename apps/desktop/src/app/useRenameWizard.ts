import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { callNestify, type ChangePlan, type Collision, type LibrarySummary, type SearchHit } from '@/lib/ipc'
import { matchingRootPath, parentDirectoryPath } from '@/lib/path-crumbs'
import { errorMessage } from '@/lib/labels'
import type { PlanApplyOptions, PlanState } from '@/app/plan-state'
import { createRenameRuleGroup, type RenameRuleGroup } from '@/components/rules/RenameGroupsEditor'
import { useDirectoryPreview } from '@/app/useDirectoryPreview'
import { useExpressionPreview } from '@/app/useExpressionPreview'

const RENAME_PLAN_PAGE_SIZE = 200

function auditRenamePreview(phase: 'discarded' | 'committed', details: Record<string, unknown>) {
  void callNestify((api) =>
    api.logEvent?.('rename.preview.frontend', { phase, ...details }, phase === 'discarded' ? 'warn' : 'info')
    ?? Promise.resolve({ ok: true as const }),
  ).catch(() => undefined)
}

export function useRenameWizard({
  libraries,
  tab,
  collision,
  renamePlan,
  setError,
  setNotice,
  setBusy,
  applyPlan,
  setPlanState,
}: {
  libraries: LibrarySummary[]
  tab: string
  collision: Collision
  renamePlan: ChangePlan | null
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  setBusy: (value: string | null) => void
  applyPlan: (plan: ChangePlan, options?: PlanApplyOptions) => void
  setPlanState: Dispatch<SetStateAction<PlanState | null>>
}) {
  const [renameDirectory, setRenameDirectory] = useState('')
  const [renameDirectoryId, setRenameDirectoryId] = useState<string | null>(null)
  const [renameStep, setRenameStep] = useState<'pick' | 'filter' | 'rules' | 'result'>('pick')
  const [renameFilter, setRenameFilter] = useState('')
  const [renameGroups, setRenameGroups] = useState<RenameRuleGroup[]>(() => [
    createRenameRuleGroup({
      template: "{parent}_{name.regex_replace('\\\\[.*?\\\\]', '').trim()}{ext}",
    }),
  ])
  const [renameRuleSelected, setRenameRuleSelected] = useState<Record<string, boolean>>({})
  const [renamePreviewBusy, setRenamePreviewBusy] = useState(false)
  const renamePreviewRequestId = useRef(0)
  const renamePreviewEpoch = useRef(0)
  const renamePreviewInFlightRef = useRef<{ key: string; promise: Promise<boolean> } | null>(null)
  const renamePlanPageRef = useRef<{ offset: number; cursors: Array<ChangePlan["seqCursor"]> }>({ offset: 0, cursors: [] })
  const [renamePlanOffset, setRenamePlanOffset] = useState(0)
  const [renamePlanTotal, setRenamePlanTotal] = useState(0)
  const renameAutoPreviewFingerprintRef = useRef<string | null>(null)
  const renamePlanOffsetRef = useRef(0)
  const renameFingerprintRef = useRef('')
  const renameRuleSelectedRef = useRef<Record<string, boolean>>({})
  const directoryPreview = useDirectoryPreview({ libraries, matchMode: 'exact-root' })
  const filterPreview = useExpressionPreview({ libraries, directory: renameDirectory })

  const directoryForRename = renameDirectory.trim()
  const libraryForRename = useMemo(
    () => (directoryForRename
      ? libraries.find((library) => matchingRootPath(directoryForRename, library.roots)) ?? null
      : null),
    [directoryForRename, libraries],
  )
  const canRenameScope = directoryForRename.length > 0 && libraryForRename !== null
  const renameBlockReason = (() => {
    if (libraries.length === 0) return '还没有任何资料库，先去左侧「资料库」里添加一个'
    if (!directoryForRename) return '先在上面填入或选择要改名的目录'
    if (!libraryForRename)
      return `目录不在任何资料库范围内（现有资料库：${libraries.map((library) => library.name).join('、')}），请把该目录加入某个资料库后再改名`
    return null
  })()
  const canRenameGoParent = Boolean(
    parentDirectoryPath(
      directoryForRename,
      libraryForRename ? matchingRootPath(directoryForRename, libraryForRename.roots) : null,
    ),
  )
  const renameFingerprint = useMemo(
    () => [
      libraryForRename?.id ?? '',
      directoryForRename,
      renameFilter.trim(),
      JSON.stringify(renameGroups.map((group) => ({ filter: group.filter, template: group.template }))),
      collision,
    ].join('\n'),
    [collision, directoryForRename, libraryForRename?.id, renameFilter, renameGroups],
  )
  useEffect(() => {
    renameFingerprintRef.current = renameFingerprint
  }, [renameFingerprint])

  const handleRenamePreview = useCallback(
    async (options?: { silent?: boolean; entryIds?: string[]; fingerprint?: string; offset?: number; limit?: number | null; seqCursor?: ChangePlan["seqCursor"] }) => {
      const requestFingerprint = options?.fingerprint ?? renameFingerprint
      const requestId = ++renamePreviewRequestId.current
      const requestEpoch = renamePreviewEpoch.current
      const payloadGroups = renameGroups
        .map((group) => ({
          filter: group.filter.trim() || undefined,
          template: group.template.trim(),
        }))
        .filter((group) => group.template.length > 0)
      if (!libraryForRename || !canRenameScope || payloadGroups.length === 0) return false
      const isCurrentRequest = () =>
        requestId === renamePreviewRequestId.current
        && requestEpoch === renamePreviewEpoch.current
        && renameFingerprintRef.current === requestFingerprint
      console.info('[rename.preview] request', {
        directory: directoryForRename,
        filter: renameFilter.trim(),
        groups: payloadGroups,
        offset: options?.offset ?? 0,
        limit: options?.limit === undefined ? RENAME_PLAN_PAGE_SIZE : options.limit,
      })
      if (!options?.silent) {
        setBusy('rename')
        setError(null)
      } else {
        setRenamePreviewBusy(true)
      }
      try {
        const { plan: next } = await callNestify((api) =>
          api.renamePreview({
            libraryId: libraryForRename.id,
            template: payloadGroups[0]!.template,
            groups: payloadGroups,
            scope: 'directory',
            directory: directoryForRename,
            entryIds: options?.entryIds,
            filter: renameFilter.trim() || undefined,
            offset: options?.offset ?? 0,
            ...(options?.limit === undefined ? { limit: RENAME_PLAN_PAGE_SIZE } : options.limit === null ? {} : { limit: options.limit }),
            seqCursor: options?.seqCursor,
            collision,
          }),
        )
        console.info('[rename.preview] response', {
          ops: next.ops.length,
          sourceOffset: next.sourceOffset,
          sourceCount: next.sourceCount,
          matchedCount: next.matchedCount,
          sourceHasMore: next.sourceHasMore,
        })
        if (!isCurrentRequest()) {
          auditRenamePreview('discarded', {
            requestId,
            requestEpoch,
            requestFingerprint,
            currentFingerprint: renameFingerprintRef.current,
          })
          console.info('[rename.preview] discarded', {
            staleRequest: requestId !== renamePreviewRequestId.current || requestEpoch !== renamePreviewEpoch.current,
            fingerprintChanged: renameFingerprintRef.current !== requestFingerprint,
          })
          return false
        }
        const pageCursor = next.seqCursor
        const pageOffset = next.sourceOffset ?? options?.offset ?? 0
        renamePlanPageRef.current = {
          offset: Math.max(renamePlanPageRef.current.offset, pageOffset),
          cursors: (() => {
            const cursors = [...renamePlanPageRef.current.cursors]
            cursors[pageOffset / RENAME_PLAN_PAGE_SIZE] = pageCursor
            return cursors
          })(),
        }
        setRenamePlanTotal(
          next.sourceHasMore
            ? -1
            : pageOffset + next.sourceCount,
        )
        const commitPreview = () => {
          if (!isCurrentRequest()) return false
          applyPlan(next, {
            offset: pageOffset,
            fingerprint: requestFingerprint,
            selectionByEntryId: renameRuleSelectedRef.current,
          })
          auditRenamePreview('committed', {
            requestId,
            requestEpoch,
            ops: next.ops.length,
            sourceCount: next.sourceCount,
          })
          return true
        }
        if (!commitPreview()) return false
        if (options?.silent) {
          const map = { ...renameRuleSelectedRef.current }
          for (const op of next.ops) {
            if (op.entryId && map[op.entryId] === undefined) map[op.entryId] = true
          }
          renameRuleSelectedRef.current = map
          setRenameRuleSelected(map)
        } else {
          setNotice(`改名预览完成，${next.ops.length} 条变更`)
        }
        return true
      } catch (err) {
        setError(errorMessage(err))
        return false
      } finally {
        if (!options?.silent) setBusy(null)
        else setRenamePreviewBusy(false)
      }
    },
    [applyPlan, canRenameScope, collision, directoryForRename, libraryForRename, renameFilter, renameFingerprint, renameGroups, setBusy, setError, setNotice],
  )

  const renamePreviewHandlerRef = useRef(handleRenamePreview)
  useEffect(() => {
    renamePreviewHandlerRef.current = handleRenamePreview
  }, [handleRenamePreview])

  const resetRenamePlanPaging = useCallback(() => {
    renamePreviewEpoch.current += 1
    renamePreviewInFlightRef.current = null
    renamePlanPageRef.current = { offset: 0, cursors: [] }
    setRenamePlanOffset(0)
    renamePlanOffsetRef.current = 0
    setRenamePlanTotal(0)
    setRenameRuleSelected({})
    renameRuleSelectedRef.current = {}
    setPlanState(null)
  }, [setPlanState])

  const handleUseRenameDirectory = useCallback(async (path: string) => {
    directoryPreview.invalidate()
    filterPreview.invalidate()
    resetRenamePlanPaging()
    setRenameDirectory(path)
    setRenameDirectoryId(null)
    setRenameRuleSelected({})
    setRenameStep(path.trim() ? 'filter' : 'pick')
    if (!path.trim()) return
    setBusy('rename')
    try {
      await directoryPreview.load(path)
    } finally {
      setBusy(null)
    }
  }, [directoryPreview, filterPreview, resetRenamePlanPaging, setBusy])

  const handlePickRenameDirectory = useCallback(async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked?.path) return
      await handleUseRenameDirectory(picked.path)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [handleUseRenameDirectory, setError])

  const handleRenameDirectoryChange = useCallback((value: string) => {
    directoryPreview.invalidate()
    filterPreview.invalidate()
    resetRenamePlanPaging()
    setRenameDirectory(value)
    setRenameDirectoryId(null)
    setRenameRuleSelected({})
    setRenameStep(value.trim() ? 'filter' : 'pick')
  }, [directoryPreview, filterPreview, resetRenamePlanPaging])

  const handleRenameFilterChange = useCallback((value: string) => {
    setRenameFilter(value)
    filterPreview.schedule(value)
  }, [filterPreview])

  const handleRenamePreviewSort = useCallback((field: 'name' | 'size' | 'mtime') => {
    directoryPreview.sort(field, directoryForRename, renameDirectoryId)
  }, [directoryPreview, directoryForRename, renameDirectoryId])

  const handleRenamePreviewPage = useCallback((delta: -1 | 1) => {
    directoryPreview.page(delta, directoryForRename, renameDirectoryId)
  }, [directoryPreview, directoryForRename, renameDirectoryId])

  const handleRenameFilterPreviewPage = useCallback((delta: -1 | 1) => {
    filterPreview.page(renameFilter, delta)
  }, [filterPreview, renameFilter])

  const handleRenameEnterDirectory = useCallback((hit: SearchHit) => {
    if (hit.kind !== 'dir' || !hit.path) return
    filterPreview.invalidate()
    resetRenamePlanPaging()
    setRenameDirectory(hit.path)
    setRenameDirectoryId(hit.entryId)
    void directoryPreview.load(hit.path, undefined, hit.entryId)
  }, [directoryPreview, filterPreview, resetRenamePlanPaging])

  const handleRenameGoParent = useCallback(() => {
    const rootPath = libraryForRename ? matchingRootPath(directoryForRename, libraryForRename.roots) : null
    const parent = parentDirectoryPath(directoryForRename, rootPath)
    if (!parent) return
    filterPreview.invalidate()
    resetRenamePlanPaging()
    setRenameDirectory(parent)
    setRenameDirectoryId(null)
    void directoryPreview.load(parent)
  }, [directoryPreview, directoryForRename, filterPreview, libraryForRename, resetRenamePlanPaging])

  const handleRenameNextFromFilter = useCallback(() => {
    if (renameBlockReason) {
      setError(renameBlockReason)
      return
    }
    setRenameStep('rules')
  }, [renameBlockReason, setError])

  const handleToggleRenameRule = useCallback((entryId: string, checked: boolean) => {
    setRenameRuleSelected((current) => {
      const map = { ...current, [entryId]: checked }
      renameRuleSelectedRef.current = map
      return map
    })
  }, [])

  const handleToggleAllRenameRules = useCallback((checked: boolean) => {
    setRenameRuleSelected((current) => {
      const map = { ...current }
      for (const op of renamePlan?.ops ?? []) {
        if (op.entryId) map[op.entryId] = checked
      }
      renameRuleSelectedRef.current = map
      return map
    })
  }, [renamePlan])

  useEffect(() => {
    resetRenamePlanPaging()
  }, [directoryForRename, libraryForRename?.id, renameFilter, resetRenamePlanPaging])

  const loadRenamePlanPage = useCallback(async (targetOffset: number) => {
    const cached = renamePlanPageRef.current
    const pageIndex = targetOffset / RENAME_PLAN_PAGE_SIZE
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return false
    const cursor = targetOffset === 0 ? undefined : cached.cursors[pageIndex - 1]
    if (targetOffset > 0 && !cursor) return false
    const key = `${renameFingerprint}:${targetOffset}:${cursor ? JSON.stringify(cursor) : ''}`
    const inFlight = renamePreviewInFlightRef.current
    if (inFlight?.key === key) return inFlight.promise
    const promise = renamePreviewHandlerRef.current({
      silent: true,
      fingerprint: renameFingerprint,
      offset: targetOffset,
      seqCursor: cursor,
    })
    renamePreviewInFlightRef.current = { key, promise }
    try {
      return await promise
    } finally {
      if (renamePreviewInFlightRef.current?.key === key) renamePreviewInFlightRef.current = null
    }
  }, [renameFingerprint])

  const handleRenameNextFromRules = useCallback(async () => {
    const ok = await loadRenamePlanPage(0)
    if (ok) setRenameStep('result')
  }, [loadRenamePlanPage])

  const handleRenamePlanPage = useCallback(async (delta: -1 | 1) => {
    if (delta > 0 && renamePlan?.sourceHasMore === false) return
    const nextOffset = Math.max(0, renamePlanOffset + delta * RENAME_PLAN_PAGE_SIZE)
    if (nextOffset === renamePlanOffset) return
    const ok = await loadRenamePlanPage(nextOffset)
    if (ok) {
      setRenamePlanOffset(nextOffset)
      renamePlanOffsetRef.current = nextOffset
    }
  }, [loadRenamePlanPage, renamePlan?.sourceHasMore, renamePlanOffset])

  useEffect(() => {
    if (tab !== 'rename' || renameStep !== 'rules' || !canRenameScope) {
      renameAutoPreviewFingerprintRef.current = null
      return
    }
    if (!renameGroups.some((group) => group.template.trim())) return
    if (renameAutoPreviewFingerprintRef.current === renameFingerprint) return
    const requestFingerprint = renameFingerprint
    renamePreviewInFlightRef.current = null
    renamePlanPageRef.current = { offset: 0, cursors: [] }
    setRenamePlanOffset(0)
    renamePlanOffsetRef.current = 0
    setRenamePlanTotal(0)
    setRenameRuleSelected({})
    renameRuleSelectedRef.current = {}
    const timer = window.setTimeout(() => {
      if (renameFingerprintRef.current !== requestFingerprint) return
      renameAutoPreviewFingerprintRef.current = requestFingerprint
      void loadRenamePlanPage(0).then((ok) => {
        if (!ok && renameAutoPreviewFingerprintRef.current === requestFingerprint) {
          renameAutoPreviewFingerprintRef.current = null
        }
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [canRenameScope, loadRenamePlanPage, renameFingerprint, renameGroups, renameStep, tab])

  return {
    renameFingerprint,
    template: renameGroups[0]?.template ?? '',
    renameGroups,
    setRenameGroups,
    renameRuleSelected,
    handleToggleRenameRule,
    handleToggleAllRenameRules,
    handleRenamePreview,
    renamePlanOffset,
    renamePlanTotal,
    handleRenamePlanPage,
    renameDirectory,
    setRenameDirectory,
    renameStep,
    setRenameStep,
    renameFilter,
    handleRenameFilterChange,
    renameFilterPreview: filterPreview.hits,
    renameFilterPreviewTotal: filterPreview.total,
    renameFilterPreviewOffset: filterPreview.offset,
    renameFilterPreviewHasMore: filterPreview.hasMore,
    renameFilterPreviewBusy: filterPreview.busy,
    renamePreview: directoryPreview.hits,
    renamePreviewTotal: directoryPreview.total,
    renamePreviewOffset: directoryPreview.offset,
    renamePreviewHasMore: directoryPreview.hasMore,
    renamePreviewLoading: directoryPreview.busy,
    renamePreviewBusy,
    renamePreviewSort: directoryPreview.sortField,
    renamePreviewSortDirection: directoryPreview.sortDirection,
    handleRenamePreviewSort,
    handleRenamePreviewPage,
    handleRenameFilterPreviewPage,
    handleRenameEnterDirectory,
    handleRenameGoParent,
    handlePickRenameDirectory,
    handleUseRenameDirectory,
    handleRenameDirectoryChange,
    handleRenameNextFromFilter,
    handleRenameNextFromRules,
    renameBlockReason,
    libraryForRename,
    canRenameScope,
    canRenameGoParent,
  }
}
