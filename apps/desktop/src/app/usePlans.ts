import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import {
  callNestify,
  getNestifyApi,
  type ChangePlan,
  type Collision,
  type DuplicateGroup,
  type DuplicateHashStrategy,
  type DuplicateScope,
  type KeepStrategy,
  type LibrarySummary,
  type RuleSetSummary,
} from '@/lib/ipc'
import { isWithinDirectory } from '@/lib/path-crumbs'
import { canRollbackJob, errorMessage } from '@/lib/labels'
import { formatBytes } from '@/lib/utils'
import type { PlanSource, WorkspaceTab } from '@/lib/workspace'
import type { ConfirmationRequest } from '@/app/types'
import { useRuleSetActions } from '@/app/useRuleSetActions'
import type { JobRecord } from '@nestify/shared'

type PlanState = {
  plan: ChangePlan
  source: PlanSource
  fingerprint: string
}

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
  const [template, setTemplate] = useState("{parent}_{name.regex_replace('\\\\[.*?\\\\]', '').trim()}{ext}")
  const [planState, setPlanState] = useState<PlanState | null>(null)
  const [selectedOps, setSelectedOps] = useState<Record<number, boolean>>({})
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [keepStrategy, setKeepStrategy] = useState<KeepStrategy>('newest')
  const [duplicateHashStrategy, setDuplicateHashStrategy] = useState<DuplicateHashStrategy>('duplicate-candidate-only')
  const [duplicateScope, setDuplicateScope] = useState<DuplicateScope>('library')
  const [duplicateDirectory, setDuplicateDirectory] = useState('')
  const [lastExecuteJobId, setLastExecuteJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const selectedRuleSet = ruleSets.find((item) => item.id === selectedRuleSetId) ?? null
  const selectionKey = selectedEntryIds.join(',')
  const planFingerprint = useMemo(() => {
    const common = [selectedLibraryId ?? '', duplicateScope, duplicateDirectory.trim(), selectionKey]
    if (tab === 'rules') return [...common, selectedRuleSetId, collision, JSON.stringify(ruleDraft)].join('\n')
    if (tab === 'rename') return [...common, template, collision].join('\n')
    if (tab === 'duplicates') return [...common, keepStrategy, duplicateHashStrategy].join('\n')
    return ''
  }, [
    collision,
    duplicateDirectory,
    duplicateHashStrategy,
    duplicateScope,
    keepStrategy,
    ruleDraft,
    selectedLibraryId,
    selectedRuleSetId,
    selectionKey,
    tab,
    template,
  ])

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
      current && (current.source !== tab || current.fingerprint !== planFingerprint) ? null : current,
    )
  }, [planFingerprint, tab])

  useEffect(() => {
    setDuplicateGroups([])
  }, [planFingerprint])

  useEffect(() => {
    if (!planState) setSelectedOps({})
  }, [planState])

  const activePlan = planState?.source === tab ? planState.plan : null
  const selectedCount = useMemo(() => Object.values(selectedOps).filter(Boolean).length, [selectedOps])
  const directoryForDuplicates = duplicateDirectory.trim()
  /** 分析前按目录自动匹配资料库：目录在某个库的 roots 内（或就是某个 root）即命中。 */
  const libraryForDirectory = useMemo(() => {
    if (!directoryForDuplicates) return null
    return (
      libraries.find((library) => library.roots.some((root) => isWithinDirectory(directoryForDuplicates, root))) ?? null
    )
  }, [libraries, directoryForDuplicates])
  const canPreviewScope =
    directoryForDuplicates.length > 0 &&
    libraryForDirectory !== null &&
    (keepStrategy !== 'preferred_dir' || duplicateDirectory.trim().length > 0)
  /** 重复分析固定目录模式：置灰原因（人话）；null = 可以分析。 */
  const analyzeBlockReason = (() => {
    if (libraries.length === 0) return '还没有任何资料库，先去左侧「资料库」里添加一个'
    if (directoryForDuplicates.length === 0) return '先在上面填入或选择要分析的目录'
    if (libraryForDirectory === null)
      return `目录不在任何资料库范围内（现有资料库：${libraries.map((library) => library.name).join('、')}），请把该目录加入某个资料库后再分析`
    return null
  })()

  const applyPlan = (next: ChangePlan, source: PlanSource) => {
    setPlanState({ plan: next, source, fingerprint: planFingerprint })
    setLastExecuteJobId(null)
    const map: Record<number, boolean> = {}
    next.ops.forEach((op, index) => {
      map[index] = op.selected && op.risk !== 'overwrite'
    })
    setSelectedOps(map)
  }

  const {
    handleCreateRuleSet,
    handleUpdateRuleSet,
    handleRefreshRuleSet,
    handleToggleRuleSet,
    handleRuleSetPriority,
    handleCloneRuleSet,
    handleDeleteRuleSet,
    handleExportRuleSet,
    handleImportRuleSet,
  } = useRuleSetActions({
    selectedRuleSet,
    ruleDraft,
    setError,
    setNotice,
    setRuleSets,
    setRuleActionBusy,
    loadRules,
    requestConfirmation,
  })

  const handleSendSelectionTo = (target: Exclude<WorkspaceTab, 'search' | 'jobs'>) => {
    const entryIds = selectedEntryIds.length > 0 ? selectedEntryIds : []
    if (entryIds.length === 0 && target !== 'duplicates') {
      setError('请先选择搜索结果')
      return
    }
    setDuplicateScope('selection')
    setTab(target)
    setNotice(`已加入 ${entryIds.length} 条记录`)
  }

  const handleRulesPreview = async () => {
    if (!selectedLibrary || !selectedRuleSetId || !canPreviewScope) return
    setBusy('rules')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.rulesPreview({
          libraryId: selectedLibrary.id,
          ruleSetId: selectedRuleSetId,
          scope: duplicateScope,
          entryIds: duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory: duplicateScope === 'directory' ? duplicateDirectory.trim() || undefined : undefined,
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
  }

  const handleRenamePreview = async () => {
    if (!selectedLibrary || !canPreviewScope) return
    setBusy('rename')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.renamePreview({
          libraryId: selectedLibrary.id,
          template,
          scope: duplicateScope,
          entryIds: duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory: duplicateScope === 'directory' ? duplicateDirectory.trim() || undefined : undefined,
          collision,
        }),
      )
      applyPlan(next, 'rename')
      setNotice(`改名预览完成，${next.ops.length} 条变更`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleAnalyzeDuplicates = async () => {
    // 置灰原因三选一；按钮可点时 libraryForDirectory 必非空。
    if (libraries.length === 0) {
      setError('还没有任何资料库，先去左侧「资料库」里添加一个')
      setNotice(null)
      return
    }
    if (!directoryForDuplicates) {
      setError('请先填入或选择要分析的目录')
      setNotice(null)
      return
    }
    if (!libraryForDirectory) {
      setError('该目录不在任何资料库范围内，请先把目录加入某个资料库再分析')
      setNotice(null)
      return
    }
    void getNestifyApi()?.logEvent?.('renderer.duplicates.request', {
      libraryId: libraryForDirectory.id,
      scope: 'directory',
      directory: directoryForDuplicates,
      keepStrategy,
    })
    setBusy('duplicates')
    setError(null)
    try {
      const next = await callNestify((api) =>
        api.duplicatesAnalyze({
          libraryId: libraryForDirectory.id,
          scope: 'directory',
          directory: directoryForDuplicates,
          hashStrategy: duplicateHashStrategy,
          keepStrategy,
        }),
      )
      setDuplicateGroups(next.groups)
      applyPlan(next.plan, 'duplicates')
      setNotice(
        `重复分析完成（资料库「${libraryForDirectory.name}」），${next.groups.length} 组 / 可释放 ${formatBytes(
          next.groups.reduce((sum, group) => sum + group.wastedBytes, 0),
        )}`,
      )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  /** 系统目录选择对话框 → 填入重复分析目录框。 */
  const handlePickDuplicateDirectory = async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (picked?.path) setDuplicateDirectory(picked.path)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const performExecutePlan = async () => {
    // 重复分析固定目录模式：执行计划用目录匹配到的库（左侧选"全部资料库"也能执行）。
    const executeLibrary = planState?.source === 'duplicates' ? libraryForDirectory : selectedLibrary
    if (!executeLibrary || !activePlan) return
    const selected = activePlan.ops.map((op, index) => (selectedOps[index] ? index : -1)).filter((index) => index >= 0)
    setBusy('execute')
    setError(null)
    try {
      const result = await callNestify((api) =>
        api.planExecute({ libraryId: executeLibrary.id, plan: activePlan, selectedOps: selected }),
      )
      setLastExecuteJobId(result.jobId)
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`执行存在失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      } else {
        setPlanState(null)
      }
      setNotice(`执行结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await loadJobOps(result.jobId)
      await runSearch(query, selectedLibraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleExecutePlan = () => {
    if (!selectedLibraryId || !activePlan) return
    requestConfirmation({
      title: '执行变更计划',
      description: `将执行 ${selectedCount} 个已勾选操作。此操作会修改磁盘文件，请确认预览内容。`,
      confirmLabel: '执行',
      action: performExecutePlan,
    })
  }

  const handleRollback = async () => {
    if (!lastExecuteJobId) return
    setBusy('rollback')
    setError(null)
    try {
      const result = await callNestify((api) => api.planRollback({ jobId: lastExecuteJobId }))
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`回滚存在失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      } else {
        setLastExecuteJobId(null)
        setPlanState(null)
      }
      setNotice(`回滚结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await loadJobOps(result.jobId)
      await runSearch(query, selectedLibraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleJobRollback = async (job: JobRecord) => {
    if (!canRollbackJob(job)) return
    setBusy(`rollback:${job.id}`)
    setError(null)
    try {
      const result = await callNestify((api) => api.planRollback({ jobId: job.id }))
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`任务 ${job.id.slice(0, 8)} 回滚失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      }
      setNotice(`任务 ${job.id.slice(0, 8)} 回滚结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await loadJobOps(result.jobId)
      if (job.libraryId) await runSearch(query, job.libraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

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
    template,
    setTemplate,
    selectedOps,
    setSelectedOps,
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
    lastExecuteJobId,
    planBusy: busy,
    loadRules,
    handleCreateRuleSet,
    handleUpdateRuleSet,
    handleRefreshRuleSet,
    handleToggleRuleSet,
    handleRuleSetPriority,
    handleCloneRuleSet,
    handleDeleteRuleSet,
    handleExportRuleSet,
    handleImportRuleSet,
    handleSendSelectionTo,
    activePlan,
    handleRulesPreview,
    handleRenamePreview,
    handleAnalyzeDuplicates,
    handleExecutePlan,
    handleRollback,
    handleJobRollback,
    selectedCount,
    canPreviewScope,
    analyzeBlockReason,
    libraryForDirectory,
  }
}
