import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import {
  callNestify,
  type ChangePlan,
  type Collision,
  type LibrarySummary,
  type RuleSetSummary,
} from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { PlanSource, WorkspaceSendTarget, WorkspaceTab } from '@/lib/workspace'
import type { ConfirmationRequest } from '@/app/types'
import { useRuleSetActions } from '@/app/useRuleSetActions'
import { useDuplicateWizard } from '@/app/useDuplicateWizard'
import { useOrganizeWizard } from '@/app/useOrganizeWizard'
import { usePlanExecution } from '@/app/usePlanExecution'
import { useRenameWizard } from '@/app/useRenameWizard'
import {
  accumulatePlanPage,
  carryPlanSelection,
  type PlanApplyOptions,
  type PlanOpView,
  type PlanState,
} from '@/app/plan-state'

export function usePlans(options: {
  libraries: LibrarySummary[]
  selectedLibrary: LibrarySummary | null
  selectedLibraryId: string | null
  selectedEntryIds: string[]
  query: string
  tab: WorkspaceTab
  setTab: (tab: WorkspaceTab) => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  requestConfirmation: (request: ConfirmationRequest) => void
  runSearch: (text: string, libraryId?: string | null, offset?: number) => Promise<void>
  loadJobs: (options?: { preferJobId?: string }) => Promise<void>
}) {
  const {
    libraries,
    selectedLibrary,
    selectedLibraryId,
    selectedEntryIds,
    query,
    tab,
    setTab,
    setError,
    setNotice,
    requestConfirmation,
    runSearch,
    loadJobs,
  } = options

  const [ruleSets, setRuleSets] = useState<RuleSetSummary[]>([])
  const [selectedRuleSetId, setSelectedRuleSetId] = useState('')
  const [ruleActionBusy, setRuleActionBusy] = useState<string | null>(null)
  const [ruleDraft, setRuleDraft] = useState<RuleSetEditorValue>({
    name: '',
    description: '',
    dryRunDefault: true,
    collision: 'suffix',
    rules: [],
  })
  const [collision, setCollision] = useState<Collision>('suffix')
  const [planState, setPlanState] = useState<PlanState | null>(null)
  const [selectedOps, setSelectedOps] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const planFingerprintRef = useRef('')
  const planStateRef = useRef<PlanState | null>(null)

  useEffect(() => {
    planStateRef.current = planState
  }, [planState])

  const applyPlan = useCallback((
    next: ChangePlan,
    source: PlanSource,
    options?: PlanApplyOptions,
  ) => {
    const fingerprint = options?.fingerprint ?? planFingerprintRef.current
    const nextState = accumulatePlanPage({
      current: planStateRef.current,
      next,
      source,
      fingerprint,
      offset: options?.offset,
    })
    const previousState = planStateRef.current
    const canKeepSelection = previousState?.source === source && previousState.fingerprint === fingerprint
    planStateRef.current = nextState
    setPlanState(nextState)
    setSelectedOps((current) => {
      const map = canKeepSelection && previousState
        ? carryPlanSelection(previousState, current, nextState)
        : {}
      nextState.plan.ops.forEach((op, index) => {
        const selection = op.entryId ? options?.selectionByEntryId?.[op.entryId] : undefined
        if (selection !== undefined) {
          map[index] = selection && op.risk !== 'overwrite'
        } else if (map[index] === undefined) {
          map[index] = op.selected && op.risk !== 'overwrite'
        }
      })
      return map
    })
  }, [])

  const applyOrganizePlan = useCallback(
    (plan: ChangePlan, options?: PlanApplyOptions) => applyPlan(plan, 'organize', options),
    [applyPlan],
  )
  const applyRenamePlan = useCallback(
    (plan: ChangePlan, options?: PlanApplyOptions) => applyPlan(plan, 'rename', options),
    [applyPlan],
  )

  const organize = useOrganizeWizard({
    libraries,
    tab,
    collision,
    hasPlan: planState?.source === 'organize',
    setError,
    setNotice,
    setBusy,
    applyPlan: applyOrganizePlan,
    setPlanState,
  })
  const rename = useRenameWizard({
    libraries,
    tab,
    collision,
    renamePlan: planState?.source === 'rename' ? planState.currentPage : null,
    setError,
    setNotice,
    setBusy,
    applyPlan: applyRenamePlan,
    setPlanState,
  })
  const duplicate = useDuplicateWizard({
    libraries,
    tab,
    setError,
    setNotice,
    setBusy,
    applyPlan: (plan, source, options) => applyPlan(plan, source, options),
    setSelectedOps,
  })

  const selectedRuleSet = ruleSets.find((item) => item.id === selectedRuleSetId) ?? null
  const selectionKey = selectedEntryIds.join(',')
  const planFingerprint = useMemo(() => {
    const common = [selectedLibraryId ?? '', duplicate.duplicateScope, duplicate.duplicateDirectory.trim(), selectionKey]
    if (tab === 'rules') return [...common, selectedRuleSetId, collision, JSON.stringify(ruleDraft)].join('\n')
    if (tab === 'rename') return rename.renameFingerprint
    if (tab === 'duplicates') return duplicate.duplicateFingerprint
    if (tab === 'organize') {
      return [
        organize.libraryForOrganize?.id ?? '',
        organize.organizeDirectory.trim(),
        organize.organizeFilter.trim(),
        JSON.stringify(organize.organizeRuleDraft),
        collision,
      ].join('\n')
    }
    return ''
  }, [
    collision,
    duplicate.duplicateDirectory,
    duplicate.duplicateFingerprint,
    duplicate.duplicateScope,
    organize.libraryForOrganize?.id,
    organize.organizeFilter,
    organize.organizeRuleDraft,
    rename.renameFingerprint,
    ruleDraft,
    selectedLibraryId,
    selectedRuleSetId,
    selectionKey,
    tab,
  ])
  planFingerprintRef.current = planFingerprint

  const loadRules = useCallback(async (preferId?: string) => {
    const { ruleSets: next } = await callNestify((api) => api.rulesList())
    const validSets = next.filter((set) => Boolean(set?.id))
    setRuleSets(validSets)
    setSelectedRuleSetId((current) => {
      const preferred = preferId ?? current
      return preferred && validSets.some((set) => set.id === preferred) ? preferred : validSets[0]?.id || ''
    })
    const firstCollision = validSets[0]?.collision
    if (firstCollision === 'suffix' || firstCollision === 'skip' || firstCollision === 'overwrite') {
      setCollision((current) => current || firstCollision)
    }
  }, [])

  const ruleActions = useRuleSetActions({
    selectedRuleSet,
    ruleDraft,
    setError,
    setNotice,
    setRuleSets,
    setRuleActionBusy,
    loadRules,
    requestConfirmation,
  })

  useEffect(() => {
    if (!selectedRuleSet) return
    setRuleDraft({
      name: selectedRuleSet.name,
      description: selectedRuleSet.description ?? '',
      dryRunDefault: selectedRuleSet.dryRunDefault,
      collision: selectedRuleSet.collision,
      rules: selectedRuleSet.rules,
    })
  }, [selectedRuleSet?.id, selectedRuleSet?.updatedAt])

  useEffect(() => {
    const fingerprint = planFingerprint
    setPlanState((current) => {
      // applyPlan updates the ref before React commits the state. An older
      // fingerprint cleanup must never overwrite a preview that already landed.
      const latest = planStateRef.current ?? current
      if (!latest || latest.source !== tab || latest.fingerprint === fingerprint) return latest
      return null
    })
  }, [planFingerprint, tab])

  useEffect(() => {
    if (!planState) setSelectedOps({})
  }, [planState])

  const activePlan = planState?.source === tab ? planState.plan : null
  const renameCurrentPlan = planState?.source === 'rename' ? planState.currentPage : null
  const organizeResultOps = useMemo<PlanOpView[]>(() => {
    if (planState?.source !== 'organize') return []
    const page = planState.pages.find((item) => item.plan === planState.currentPage)
    if (!page) return []
    return page.opIndexes
      .map((index) => {
        const op = planState.plan.ops[index]
        return op ? { op, index } : null
      })
      .filter((item): item is PlanOpView => item !== null)
  }, [planState])
  const renameResultOps = useMemo<PlanOpView[]>(() => {
    if (planState?.source !== 'rename') return []
    const page = planState.pages.find((item) => item.plan === planState.currentPage)
    if (!page) return []
    return page.opIndexes
      .map((index) => {
        const op = planState.plan.ops[index]
        return op ? { op, index } : null
      })
      .filter((item): item is PlanOpView => item !== null)
  }, [planState])
  const selectedCount = useMemo(
    () => (planState?.source === 'duplicates' && tab === 'duplicates'
      ? duplicate.duplicateSelectedCount
      : Object.values(selectedOps).filter(Boolean).length),
    [duplicate.duplicateSelectedCount, planState?.source, selectedOps, tab],
  )

  const handleSendSelectionTo = useCallback(
    (target: WorkspaceSendTarget) => {
      const entryIds = selectedEntryIds.length > 0 ? selectedEntryIds : []
      if (entryIds.length === 0 && target !== 'duplicates' && target !== 'rename') {
        setError('请先选择搜索结果')
        return
      }
      if (target === 'organize') duplicate.setDuplicateScope('selection')
      setTab(target)
      setNotice(`已加入 ${entryIds.length} 条记录`)
    },
    [duplicate, selectedEntryIds, setError, setNotice, setTab],
  )

  const handleRulesPreview = useCallback(async () => {
    if (!selectedLibrary || !selectedRuleSetId || !duplicate.canPreviewScope) return
    setBusy('rules')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.rulesPreview({
          libraryId: selectedLibrary.id,
          ruleSetId: selectedRuleSetId,
          scope: duplicate.duplicateScope,
          entryIds: duplicate.duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory: duplicate.duplicateScope === 'directory' ? duplicate.duplicateDirectory.trim() || undefined : undefined,
          collision,
        }),
      )
      applyPlan(next, tab === 'rename' ? 'rename' : 'rules')
      setNotice(`Dry-run 完成，${next.ops.length} 条变更`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }, [
    applyPlan,
    collision,
    duplicate.canPreviewScope,
    duplicate.duplicateDirectory,
    duplicate.duplicateScope,
    selectedEntryIds,
    selectedLibrary,
    selectedRuleSetId,
    setBusy,
    setError,
    setNotice,
    tab,
  ])

  const execution = usePlanExecution({
    activePlan,
    planHasMore: planState?.source === tab ? planState.sourceHasMore : false,
    planState,
    selectedOps,
    selectedCount,
    selectedLibrary,
    selectedLibraryId,
    libraryForDuplicates: duplicate.libraryForDirectory,
    libraryForRename: rename.libraryForRename,
    libraryForOrganize: organize.libraryForOrganize,
    getDuplicateExecutionSource: duplicate.duplicateExecutionSource,
    query,
    requestConfirmation,
    runSearch,
    loadJobs,
    setError,
    setNotice,
    setBusy,
    setPlanState,
    setSelectedOps,
  })

  return {
    ruleSets,
    selectedRuleSetId,
    setSelectedRuleSetId,
    selectedRuleSet,
    ruleActionBusy,
    ruleDraft,
    setRuleDraft,
    collision,
    setCollision,
    selectedOps,
    setSelectedOps,
    activePlan,
    organizeResultOps,
    renameCurrentPlan,
    renameResultOps,
    planBusy: busy,
    selectedCount,
    loadRules,
    handleSendSelectionTo,
    handleRulesPreview,
    ...ruleActions,
    ...organize,
    ...rename,
    ...duplicate,
    ...execution,
  }
}
export type PlansController = ReturnType<typeof usePlans>
