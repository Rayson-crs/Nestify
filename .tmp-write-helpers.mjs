import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replaceAll("\r\n", "\n"));
  console.log("wrote", path);
}

function replace(path, replacements) {
  let text = readFileSync(path, "utf8");
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`missing in ${path}: ${from.slice(0, 80)}`);
    text = text.replace(from, to);
  }
  writeFileSync(path, text.replaceAll("\r\n", "\n"));
  console.log("patched", path);
}

write("apps/desktop/src/app/useRuleSetActions.ts", `import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
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
        name: \`自定义规则 \${new Date().toISOString().slice(0, 10)}\`,
        description: '用户自定义规则集',
        dryRunDefault: true,
        collision: 'suffix',
        rules: [],
        enabled: true,
        priority: 100,
      })
      return { notice: \`已创建 \${ruleSet.name}\`, preferredId: ruleSet.id }
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
        setError(\`规则 ID 重复：\${id}\`)
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
      return { notice: \`已保存 \${ruleSet.name}\`, preferredId: ruleSet.id }
    })
  }

  const handleRefreshRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:get', async (api) => {
      const { ruleSet } = await api.rulesGet({ id: selectedRuleSet.id })
      setRuleSets((current) => current.map((item) => (item.id === ruleSet.id ? ruleSet : item)))
      return { notice: \`已刷新 \${ruleSet.name}\` }
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
        notice: ruleSet.enabled ? \`已启用 \${ruleSet.name}\` : \`已禁用 \${ruleSet.name}\`,
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
      return { notice: \`\${ruleSet.name} 优先级已更新为 \${ruleSet.priority}\`, preferredId: ruleSet.id }
    })
  }

  const handleCloneRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:clone', async (api) => {
      const { ruleSet } = await api.rulesClone({
        sourceId: selectedRuleSet.id,
        name: \`\${selectedRuleSet.name} Copy\`,
      })
      return { notice: \`已克隆为 \${ruleSet.name}\`, preferredId: ruleSet.id }
    })
  }

  const handleDeleteRuleSet = () => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    requestConfirmation({
      title: '删除规则集',
      description: \`将删除自定义规则集 \${selectedRuleSet.name}。\`,
      confirmLabel: '删除',
      action: () =>
        runRuleAction('rules:delete', async (api) => {
          await api.rulesDelete({ id: selectedRuleSet.id })
          return { notice: \`已删除 \${selectedRuleSet.name}\` }
        }),
    })
  }

  const handleExportRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:export', async (api) => {
      const result = await api.rulesExport({ id: selectedRuleSet.id })
      return { notice: result.path ? \`已导出到 \${result.path}\` : '已取消导出' }
    })
  }

  const handleImportRuleSet = () =>
    runRuleAction('rules:import', async (api) => {
      const result = await api.rulesImport()
      if (!result) return { notice: '已取消导入' }
      return { notice: \`已导入 \${result.ruleSet.name}\`, preferredId: result.ruleSet.id }
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
`);

write("apps/desktop/src/components/rules/RuleSetJsonField.tsx", `import { useEffect, useId, useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { RuleDefinitionSummary } from '@/lib/ipc'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function serializeJson(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

export function parseUnknownJson(text: string): ParseResult<unknown> {
  if (text.trim() === '') return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'JSON 格式错误',
    }
  }
}

export function parseExtractJson(text: string): ParseResult<RuleDefinitionSummary['extract']> {
  const result = parseUnknownJson(text)
  if (!result.ok) return result
  if (result.value === undefined) return { ok: true, value: undefined }
  if (typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) {
    return { ok: false, error: '必须是 JSON 对象，且格式为 { 变量: { from: "..." } }' }
  }

  for (const [key, extractor] of Object.entries(result.value)) {
    if (
      typeof extractor !== 'object' ||
      extractor === null ||
      Array.isArray(extractor) ||
      typeof (extractor as { from?: unknown }).from !== 'string'
    ) {
      return {
        ok: false,
        error: \`变量 "\${key}" 必须是 { from: "..." } 格式\`,
      }
    }
  }
  return { ok: true, value: result.value as RuleDefinitionSummary['extract'] }
}

export function RuleSetJsonField({
  label,
  value,
  placeholder,
  disabled,
  parse,
  onCommit,
}: {
  label: string
  value: unknown
  placeholder: string
  disabled?: boolean
  parse: (text: string) => ParseResult<unknown>
  onCommit: (value: unknown) => void
}) {
  const textareaId = useId()
  const serialized = useMemo(() => serializeJson(value), [value])
  const [text, setText] = useState(serialized)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setText(serialized)
  }, [serialized, dirty])

  return (
    <div className="grid gap-2">
      <Label htmlFor={textareaId}>{label}</Label>
      <Textarea
        id={textareaId}
        value={text}
        disabled={disabled}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setText(event.target.value)
          setDirty(true)
          if (error) setError(null)
        }}
        onBlur={() => {
          const result = parse(text)
          if (!result.ok) {
            setError(result.error)
            return
          }
          setError(null)
          setDirty(false)
          onCommit(result.value)
        }}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
`);
console.log("created helper files");
