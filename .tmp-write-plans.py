from pathlib import Path
Path('apps/desktop/src/app/usePlans.ts').write_text(r'''import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import {
  callNestify,
  type ChangePlan,
  type Collision,
  type DuplicateGroup,
  type DuplicateScope,
  type KeepStrategy,
  type LibrarySummary,
  type NestifyApi,
  type RuleSetSummary,
} from '@/lib/ipc'
import { canRollbackJob, errorMessage } from '@/lib/labels'
import { formatBytes } from '@/lib/utils'
import type { PlanSource, WorkspaceTab } from '@/lib/workspace'
import type { ConfirmationRequest } from '@/app/types'
import type { JobRecord } from '@nestify/shared'

type PlanState = {
  plan: ChangePlan
  source: PlanSource
  fingerprint: string
}

export function usePlans(options: {
  selectedLibrary: LibrarySummary | null
  selectedLibraryId: string | null
  selectedEntryIds: string[]
  selectedHitParent: string | null
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
    if (tab === 'duplicates') return [...common, keepStrategy].join('\n')
    return ''
  }, [
    collision,
    duplicateDirectory,
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
  const scopeNeedsDirectory = duplicateScope === 'directory'
  const canPreviewScope =
    selectedLibrary !== null &&
    (!scopeNeedsDirectory || duplicateDirectory.trim().length > 0) &&
    (duplicateScope !== 'selection' || selectedEntryIds.length > 0)

  const applyPlan = (next: ChangePlan, source: PlanSource) => {
    setPlanState({ plan: next, source, fingerprint: planFingerprint })
    setLastExecuteJobId(null)
    const map: Record<number, boolean> = {}
    next.ops.forEach((op, index) => {
      map[index] = op.selected && op.risk !== 'overwrite'
    })
    setSelectedOps(map)
  }

  const runRuleAction = async (
    key: string,
    action: (api: NestifyApi) => Promise<{ notice: string; preferredId?: string }>,
  ) => {
    setRuleActionBusy(key)
    setError(null)
    try {
      const result = await callNestify(action)
      await loadRules(result.preferredId)
      setNotice(result.notice)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRuleActionBusy(null)
    }
  }

  const handleCreateRuleSet = () =>
    runRuleAction('rules:create', async (api) => {
      const { ruleSet } = await api.rulesCreate({
        name: `自定义规则 ${new Date().toISOString().slice(0, 10)}`,
        description: '用户自定义规则集',
        dryRunDefault: true,
        collision: 'suffix',
        rules: [],
        enabled: true,
        priority: 100,
      })
      return { notice: `已创建 ${ruleSet.name}`, preferredId: ruleSet.id }
    })

  const handleUpdateRuleSet = () => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    const name = ruleDraft.name.trim()
    if (!name) {
      setError('规则集名称不能为空')
      return
    }
    const ruleIds = new Set<string>()
    for (const rule of ruleDraft.rules) {
      const id = rule.id.trim()
      if (!id) {
        setError('规则 ID 不能为空')
        return
      }
      if (ruleIds.has(id)) {
        setError(`规则 ID 重复：${id}`)
        return
      }
      ruleIds.add(id)
    }
    return runRuleAction('rules:update', async (api) => {
      const { ruleSet } = await api.rulesUpdate({
        id: selectedRuleSet.id,
        patch: {
          name,
          description: ruleDraft.description.trim(),
          dryRunDefault: ruleDraft.dryRunDefault,
          collision: ruleDraft.collision,
          rules: ruleDraft.rules.map((rule) => ({
            ...rule,
            id: rule.id.trim(),
            template: rule.template?.trim() || undefined,
            reason: rule.reason?.trim() || undefined,
          })),
        },
      })
      return { notice: `已保存 ${ruleSet.name}`, preferredId: ruleSet.id }
    })
  }

  const handleRefreshRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:get', async (api) => {
      const { ruleSet } = await api.rulesGet({ id: selectedRuleSet.id })
      setRuleSets((current) => current.map((item) => (item.id === ruleSet.id ? ruleSet : item)))
      return { notice: `已刷新 ${ruleSet.name}` }
    })
  }

  const handleToggleRuleSet = () => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    return runRuleAction('rules:enable', async (api) => {
      const { ruleSet } = await api.rulesEnable({
        id: selectedRuleSet.id,
        enabled: !selectedRuleSet.enabled,
      })
      return {
        notice: ruleSet.enabled ? `已启用 ${ruleSet.name}` : `已禁用 ${ruleSet.name}`,
        preferredId: ruleSet.id,
      }
    })
  }

  const handleRuleSetPriority = (delta: number) => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    return runRuleAction('rules:priority', async (api) => {
      const { ruleSet } = await api.rulesPriority({
        id: selectedRuleSet.id,
        priority: selectedRuleSet.priority + delta,
      })
      return { notice: `${ruleSet.name} 优先级已更新为 ${ruleSet.priority}`, preferredId: ruleSet.id }
    })
  }

  const handleCloneRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:clone', async (api) => {
      const { ruleSet } = await api.rulesClone({
        sourceId: selectedRuleSet.id,
        name: `${selectedRuleSet.name} Copy`,
      })
      return { notice: `已克隆为 ${ruleSet.name}`, preferredId: ruleSet.id }
    })
  }

  const handleDeleteRuleSet = () => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    requestConfirmation({
      title: '删除规则集',
      description: `将删除自定义规则集 ${selectedRuleSet.name}。`,
      confirmLabel: '删除',
      action: () =>
        runRuleAction('rules:delete', async (api) => {
          await api.rulesDelete({ id: selectedRuleSet.id })
          return { notice: `已删除 ${selectedRuleSet.name}` }
        }),
    })
  }

  const handleExportRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:export', async (api) => {
      const result = await api.rulesExport({ id: selectedRuleSet.id })
      return { notice: result.path ? `已导出到 ${result.path}` : '已取消导出' }
    })
  }

  const handleImportRuleSet = () =>
    runRuleAction('rules:import', async (api) => {
      const result = await api.rulesImport()
      if (!result) return { notice: '已取消导入' }
      return { notice: `已导入 ${result.ruleSet.name}`, preferredId: result.ruleSet.id }
    })

  const handleSendSelectionTo = (target: Exclude<WorkspaceTab, 'search' | 'jobs'>) => {
    const entryIds = selectedEntryIds.length > 0 ? selectedEntryIds : []
    if (entryIds.length === 0) {
      setError('请先选择搜索结果')
      return
    }
    setError(null)
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
      applyPlan(next, 'rules')
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
    if (!selectedLibrary) return
    setBusy('duplicates')
    setError(null)
    try {
      const next = await callNestify((api) =>
        api.duplicatesAnalyze({
          libraryId: selectedLibrary.id,
          scope: duplicateScope,
          entryIds: duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory:
            duplicateScope === 'directory' || keepStrategy === 'preferred_dir' ? duplicateDirectory : undefined,
          keepStrategy,
        }),
      )
      setDuplicateGroups(next.groups)
      applyPlan(next.plan, 'duplicates')
      setNotice(
        `重复分析完成，${next.groups.length} 组 / 可释放 ${formatBytes(
          next.groups.reduce((sum, group) => sum + group.wastedBytes, 0),
        )}`,
      )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const performExecutePlan = async () => {
    if (!selectedLibrary || !activePlan) return
    const selected = activePlan.ops.map((op, index) => (selectedOps[index] ? index : -1)).filter((index) => index >= 0)
    setBusy('execute')
    setError(null)
    try {
      const result = await callNestify((api) =>
        api.planExecute({ libraryId: selectedLibrary.id, plan: activePlan, selectedOps: selected }),
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
    duplicateScope,
    setDuplicateScope,
    duplicateDirectory,
    setDuplicateDirectory,
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
  }
}
''', encoding='utf-8')
print('usePlans.ts written', Path('apps/desktop/src/app/usePlans.ts').stat().st_size)
