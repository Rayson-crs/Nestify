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
import type { PlanState } from '@/app/plan-state'

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
  loadJobOps: (jobId: string) => Promise<void>
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
    loadJobOps,
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

  const applyPlan = useCallback((next: ChangePlan, source: PlanSource) => {
    setPlanState({ plan: next, source, fingerprint: planFingerprintRef.current })
    const map: Record<number, boolean> = {}
    next.ops.forEach((op, index) => {
      map[index] = op.selected && op.risk !== 'overwrite'
    })
    setSelectedOps(map)
  }, [])

  const organize = useOrganizeWizard({
    libraries,
    tab,
    collision,
    hasPlan: planState?.source === 'organize',
    setError,
    setNotice,
    setBusy,
    applyPlan: (plan) => applyPlan(plan, 'organize'),
    setPlanState,
  })
  const rename = useRenameWizard({
    libraries,
    tab,
    collision,
    renamePlan: planState?.source === 'rename' ? planState.plan : null,
    setError,
    setNotice,
    setBusy,
    applyPlan: (plan) => applyPlan(plan, 'rename'),
    setPlanState,
  })
  const duplicate = useDuplicateWizard({
    libraries,
    tab,
    planState,
    duplicatePlan: planState?.source === 'duplicates' ? planState.plan : null,
    setError,
    setNotice,
    setBusy,
    applyPlan: (plan) => applyPlan(plan, 'duplicates'),
    setPlanState,
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
    organize.organizeDirectory,
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
    setPlanState((current) =>
      current && current.source === tab && current.fingerprint !== planFingerprint ? null : current,
    )
  }, [planFingerprint, tab])

  useEffect(() => {
    if (!planState) setSelectedOps({})
  }, [planState])

  const activePlan = planState?.source === tab ? planState.plan : null
  const selectedCount = useMemo(() => Object.values(selectedOps).filter(Boolean).length, [selectedOps])

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
    planState,
    selectedOps,
    selectedCount,
    selectedLibrary,
    selectedLibraryId,
    libraryForDuplicates: duplicate.libraryForDirectory,
    libraryForRename: rename.libraryForRename,
    libraryForOrganize: organize.libraryForOrganize,
    query,
    requestConfirmation,
    runSearch,
    loadJobs,
    loadJobOps,
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
