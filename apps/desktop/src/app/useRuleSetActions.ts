import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import { callNestify, type NestifyApi, type RuleSetSummary } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { ConfirmationRequest } from '@/app/types'
import type { Dispatch, SetStateAction } from 'react'

export function useRuleSetActions(options: {
  selectedRuleSet: RuleSetSummary | null
  ruleDraft: RuleSetEditorValue
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  setRuleSets: Dispatch<SetStateAction<RuleSetSummary[]>>
  setRuleActionBusy: (value: string | null) => void
  loadRules: (preferId?: string) => Promise<void>
  requestConfirmation: (request: ConfirmationRequest) => void
}) {
  const {
    selectedRuleSet,
    ruleDraft,
    setError,
    setNotice,
    setRuleSets,
    setRuleActionBusy,
    loadRules,
    requestConfirmation,
  } = options

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

  return {
    handleCreateRuleSet,
    handleUpdateRuleSet,
    handleRefreshRuleSet,
    handleToggleRuleSet,
    handleRuleSetPriority,
    handleCloneRuleSet,
    handleDeleteRuleSet,
    handleExportRuleSet,
    handleImportRuleSet,
  }
}
