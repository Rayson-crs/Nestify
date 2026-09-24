import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { callNestify, type ChangePlan, type Collision, type LibrarySummary, type SearchHit } from '@/lib/ipc'
import { matchingRootPath, parentDirectoryPath } from '@/lib/path-crumbs'
import { errorMessage } from '@/lib/labels'
import type { PlanState } from '@/app/plan-state'
import { createRenameRuleGroup, type RenameRuleGroup } from '@/components/rules/RenameGroupsEditor'
import { useDirectoryPreview } from '@/app/useDirectoryPreview'
import { useExpressionPreview } from '@/app/useExpressionPreview'

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
  applyPlan: (plan: ChangePlan) => void
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
  const renameAutoPreviewFingerprintRef = useRef<string | null>(null)
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
      directoryForRename,
      renameFilter.trim(),
      JSON.stringify(renameGroups.map((group) => ({ filter: group.filter, template: group.template }))),
      collision,
    ].join('\n'),
    [collision, directoryForRename, renameFilter, renameGroups],
  )

  const handleRenamePreview = useCallback(
    async (options?: { silent?: boolean; entryIds?: string[]; fingerprint?: string }) => {
      const requestId = ++renamePreviewRequestId.current
      const requestFingerprint = options?.fingerprint ?? renameFingerprint
      const payloadGroups = renameGroups
        .map((group) => ({
          filter: group.filter.trim() || undefined,
          template: group.template.trim(),
        }))
        .filter((group) => group.template.length > 0)
      if (!libraryForRename || !canRenameScope || payloadGroups.length === 0) return false
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
            collision,
          }),
        )
        if (requestId !== renamePreviewRequestId.current) return false
        if (options?.silent) {
          setPlanState({ plan: next, source: 'rename', fingerprint: requestFingerprint })
          setRenameRuleSelected((current) => {
            const map = { ...current }
            for (const op of next.ops) {
              if (op.entryId && map[op.entryId] === undefined) map[op.entryId] = true
            }
            return map
          })
        } else {
          applyPlan(next)
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
    [applyPlan, canRenameScope, collision, directoryForRename, libraryForRename, renameFilter, renameFingerprint, renameGroups, setBusy, setError, setNotice, setPlanState],
  )

  const renamePreviewHandlerRef = useRef(handleRenamePreview)
  useEffect(() => {
    renamePreviewHandlerRef.current = handleRenamePreview
  }, [handleRenamePreview])

  const handleUseRenameDirectory = useCallback(async (path: string) => {
    directoryPreview.invalidate()
    filterPreview.invalidate()
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
  }, [directoryPreview, filterPreview, setBusy])

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
    setRenameDirectory(value)
    setRenameDirectoryId(null)
    setRenameRuleSelected({})
    setRenameStep(value.trim() ? 'filter' : 'pick')
  }, [directoryPreview, filterPreview])

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
    setRenameDirectory(hit.path)
    setRenameDirectoryId(hit.entryId)
    void directoryPreview.load(hit.path, undefined, hit.entryId)
  }, [directoryPreview, filterPreview])

  const handleRenameGoParent = useCallback(() => {
    const rootPath = libraryForRename ? matchingRootPath(directoryForRename, libraryForRename.roots) : null
    const parent = parentDirectoryPath(directoryForRename, rootPath)
    if (!parent) return
    filterPreview.invalidate()
    setRenameDirectory(parent)
    setRenameDirectoryId(null)
    void directoryPreview.load(parent)
  }, [directoryPreview, directoryForRename, filterPreview, libraryForRename])

  const handleRenameNextFromFilter = useCallback(() => {
    if (renameBlockReason) {
      setError(renameBlockReason)
      return
    }
    setRenameStep('rules')
  }, [renameBlockReason, setError])

  const handleRenameNextFromRules = useCallback(async () => {
    const ok = await handleRenamePreview()
    if (ok) setRenameStep('result')
  }, [handleRenamePreview])

  const handleToggleRenameRule = useCallback((entryId: string, checked: boolean) => {
    setRenameRuleSelected((current) => ({ ...current, [entryId]: checked }))
  }, [])

  const handleToggleAllRenameRules = useCallback((checked: boolean) => {
    setRenameRuleSelected((current) => {
      const map = { ...current }
      for (const op of renamePlan?.ops ?? []) {
        if (op.entryId) map[op.entryId] = checked
      }
      return map
    })
  }, [renamePlan])

  useEffect(() => {
    if (tab !== 'rename' || renameStep !== 'rules' || !canRenameScope) {
      renameAutoPreviewFingerprintRef.current = null
      return
    }
    if (!renameGroups.some((group) => group.template.trim())) return
    if (renameAutoPreviewFingerprintRef.current === renameFingerprint) return
    const timer = window.setTimeout(() => {
      renameAutoPreviewFingerprintRef.current = renameFingerprint
      void renamePreviewHandlerRef.current({ silent: true, fingerprint: renameFingerprint })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [canRenameScope, renameFingerprint, renameGroups, renameStep, tab])

  return {
    renameFingerprint,
    template: renameGroups[0]?.template ?? '',
    renameGroups,
    setRenameGroups,
    renameRuleSelected,
    handleToggleRenameRule,
    handleToggleAllRenameRules,
    handleRenamePreview,
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
