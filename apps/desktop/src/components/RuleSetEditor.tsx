import { useId } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RuleSetJsonField, parseExtractJson, parseUnknownJson } from '@/components/rules/RuleSetJsonField'
import { MagicWandInput } from '@/components/rules/RuleBuilderDialog'
import { RuleStepChainSection } from '@/components/rules/RuleStepChainSection'
import { cn } from '@/lib/utils'
import type {
  Collision,
  RuleAction,
  RuleDefinitionSummary,
  RuleSetSummary,
  RuleStepSummary,
} from '@/lib/ipc'

export type RuleSetEditorValue = Pick<
  RuleSetSummary,
  'name' | 'description' | 'dryRunDefault' | 'collision' | 'rules'
>

export type RuleSetEditorProps = {
  value: RuleSetEditorValue
  onChange: (value: RuleSetEditorValue) => void
  disabled?: boolean
  className?: string
}

const COLLISION_OPTIONS: Array<{ value: Collision; label: string }> = [
  { value: 'suffix', label: '冲突追加序号' },
  { value: 'skip', label: '冲突跳过' },
  { value: 'overwrite', label: '冲突覆盖' },
]

const ACTION_OPTIONS: Array<{ value: RuleAction; label: string }> = [
  { value: 'rename_dir', label: '重命名目录' },
  { value: 'flatten_dir', label: '拍平目录' },
  { value: 'rename_file', label: '重命名文件' },
  { value: 'move', label: '移动' },
  { value: 'delete_to_quarantine', label: '移入隔离区' },
]

type RuleEditMode = 'classic' | 'steps'

/** 数据里已有步骤链 → steps 模式；否则 classic 模式。 */
function ruleMode(rule: RuleDefinitionSummary): RuleEditMode {
  return Array.isArray(rule.steps) && rule.steps.length > 0 ? 'steps' : 'classic'
}

/** 经典字段 → 等价步骤链：match 变 filter 节点，action + template + reason 变 action 节点。 */
function classicToSteps(rule: RuleDefinitionSummary): RuleStepSummary[] {
  const base = rule.id || 'rule'
  const steps: RuleStepSummary[] = []
  if (rule.match && typeof rule.match === 'object' && Object.keys(rule.match).length > 0) {
    steps.push({ id: `${base}:filter-1`, kind: 'filter', when: rule.match, target: { kind: 'self' } })
  }
  steps.push({
    id: `${base}:action-1`,
    kind: 'action',
    action: rule.action,
    target: { kind: 'self' },
    template: rule.template,
    reason: rule.reason,
  })
  return steps
}

/** 步骤链 → 经典字段：取最后一条 action 回填（高级节点保留在数据里，切回步骤链不丢失）。 */
function stepsToClassicPatch(rule: RuleDefinitionSummary): Partial<RuleDefinitionSummary> {
  const actions = (rule.steps ?? []).filter(
    (step): step is Extract<RuleStepSummary, { kind: 'action' }> => step.kind === 'action',
  )
  const last = actions[actions.length - 1]
  if (!last) return {}
  return { action: last.action, template: last.template ?? rule.template }
}

function RuleModeSwitch({
  mode,
  disabled,
  onChange,
}: {
  mode: RuleEditMode
  disabled: boolean
  onChange: (mode: RuleEditMode) => void
}) {
  const item = (value: RuleEditMode, label: string, hint: string) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={mode === value}
      disabled={disabled}
      title={hint}
      onClick={() => onChange(value)}
      className={cn(
        'truncate rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
        mode === value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
  return (
    <div role="tablist" aria-label="编辑模式" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      {item('classic', '经典 · 条件 + 动作', '单条件匹配 + 单动作，适合简单场景')}
      {item('steps', '步骤链 · IF / ELSE / FOR', '按顺序编排多个步骤，支持分支、遍历与变量传递')}
    </div>
  )
}

export function RuleSetEditor({ value, onChange, disabled = false, className }: RuleSetEditorProps) {
  const fieldId = useId()

  const updateRule = (index: number, patch: Partial<RuleDefinitionSummary>) => {
    onChange({
      ...value,
      rules: value.rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)),
    })
  }

  const moveRule = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= value.rules.length) return
    const rules = [...value.rules]
    const removed = rules.splice(index, 1)
    if (removed.length === 0) return
    rules.splice(target, 0, removed[0]!)
    onChange({ ...value, rules })
  }

  const addRule = () => {
    const usedIds = new Set(value.rules.map((rule) => rule.id))
    let suffix = value.rules.length + 1
    while (usedIds.has(`rule-${suffix}`)) suffix += 1
    const priority = value.rules.length === 0 ? 100 : Math.max(...value.rules.map((rule) => rule.priority)) + 1

    onChange({
      ...value,
      rules: [
        ...value.rules,
        {
          id: `rule-${suffix}`,
          enabled: true,
          priority,
          action: 'rename_file',
          match: {},
          template: '{name}{ext}',
          extract: {},
          reason: '',
        },
      ],
    })
  }

  const hasCustomCollision = !COLLISION_OPTIONS.some((option) => option.value === value.collision)

  return (
    <div className={cn('space-y-6', className)}>
      <section className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${fieldId}-name`}>规则集名称</Label>
          <Input
            id={`${fieldId}-name`}
            value={value.name}
            disabled={disabled}
            placeholder="规则集名称"
            onChange={(event) => onChange({ ...value, name: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${fieldId}-description`}>描述</Label>
          <Input
            id={`${fieldId}-description`}
            value={value.description ?? ''}
            disabled={disabled}
            placeholder="描述（可选）"
            onChange={(event) => onChange({ ...value, description: event.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-collision`}>冲突策略</Label>
            <Select
              value={value.collision}
              disabled={disabled}
              onValueChange={(collision) => onChange({ ...value, collision: collision as Collision })}
            >
              <SelectTrigger id={`${fieldId}-collision`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hasCustomCollision ? (
                  <SelectItem value={value.collision}>{value.collision}</SelectItem>
                ) : null}
                {COLLISION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-dry-run`}>默认 Dry-run</Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${fieldId}-dry-run`}
                checked={value.dryRunDefault}
                disabled={disabled}
                onCheckedChange={(checked) => onChange({ ...value, dryRunDefault: checked })}
              />
              <span>{value.dryRunDefault ? '开启' : '关闭'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">规则</span>
            <Badge variant="outline">{value.rules.length}</Badge>
          </div>
          <Button size="sm" disabled={disabled} onClick={addRule}>
            <Plus className="h-4 w-4" />
            添加
          </Button>
        </div>

        {value.rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无规则</p>
        ) : (
          <div className="space-y-6">
            {value.rules.map((rule, index) => (
              <article key={`${rule.id}-${index}`} className="space-y-4">
                <header className="flex items-center gap-2">
                  <Checkbox
                    id={`${fieldId}-rule-${index}-enabled`}
                    checked={rule.enabled}
                    disabled={disabled}
                    onCheckedChange={(checked) => updateRule(index, { enabled: checked })}
                  />
                  <Label
                    htmlFor={`${fieldId}-rule-${index}-enabled`}
                    className="min-w-0 flex-1 truncate"
                  >
                    {rule.id || `规则 ${index + 1}`}
                  </Label>
                  <Button
                    variant="outline"
                    size="icon"
                    title="上移规则"
                    disabled={disabled || index === 0}
                    onClick={() => moveRule(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="下移规则"
                    disabled={disabled || index === value.rules.length - 1}
                    onClick={() => moveRule(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="删除规则"
                    disabled={disabled}
                    onClick={() => onChange({ ...value, rules: value.rules.filter((_, ruleIndex) => ruleIndex !== index) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </header>
                <div className="grid gap-4">
                  <RuleModeSwitch
                    mode={ruleMode(rule)}
                    disabled={disabled}
                    onChange={(mode) => {
                      if (mode === ruleMode(rule)) return
                      if (mode === 'steps') {
                        updateRule(index, { steps: classicToSteps(rule) })
                      } else {
                        updateRule(index, { ...stepsToClassicPatch(rule), steps: undefined })
                      }
                    }}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor={`${fieldId}-rule-${index}-id`}>ID</Label>
                      <Input
                        id={`${fieldId}-rule-${index}-id`}
                        value={rule.id}
                        disabled={disabled}
                        placeholder="rule-id"
                        onChange={(event) => updateRule(index, { id: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`${fieldId}-rule-${index}-priority`}>优先级</Label>
                      <Input
                        id={`${fieldId}-rule-${index}-priority`}
                        type="number"
                        step={1}
                        value={rule.priority}
                        disabled={disabled}
                        onChange={(event) => {
                          const priority = Number.parseInt(event.target.value, 10)
                          if (Number.isInteger(priority)) updateRule(index, { priority })
                        }}
                      />
                    </div>
                  </div>

                  {ruleMode(rule) === 'classic' ? (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor={`${fieldId}-rule-${index}-action`}>动作</Label>
                        <Select
                          value={rule.action}
                          disabled={disabled}
                          onValueChange={(action) => updateRule(index, { action: action as RuleAction })}
                        >
                          <SelectTrigger id={`${fieldId}-rule-${index}-action`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACTION_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor={`${fieldId}-rule-${index}-template`}>模板</Label>
                        <MagicWandInput
                          mode="rename"
                          value={rule.template ?? ''}
                          disabled={disabled}
                          placeholder="{name}{ext}"
                          onApply={(template) => updateRule(index, { template })}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor={`${fieldId}-rule-${index}-reason`}>原因</Label>
                        <Input
                          id={`${fieldId}-rule-${index}-reason`}
                          value={rule.reason ?? ''}
                          disabled={disabled}
                          placeholder="变更说明（可选）"
                          onChange={(event) => updateRule(index, { reason: event.target.value })}
                        />
                      </div>

                      <RuleSetJsonField
                        label="Match JSON"
                        value={rule.match}
                        placeholder={'{"kind":"image"}'}
                        disabled={disabled}
                        parse={parseUnknownJson}
                        onCommit={(match) => updateRule(index, { match })}
                      />
                      <RuleSetJsonField
                        label="Extract JSON"
                        value={rule.extract}
                        placeholder={'{"date":{"from":"..."}}'}
                        disabled={disabled}
                        parse={parseExtractJson}
                        onCommit={(extract) => updateRule(index, { extract: extract as RuleDefinitionSummary['extract'] })}
                      />
                    </>
                  ) : (
                    <RuleStepChainSection
                      ruleId={rule.id || `rule-${index + 1}`}
                      steps={rule.steps}
                      disabled={disabled}
                      onChange={(steps) => updateRule(index, { steps })}
                    />
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
