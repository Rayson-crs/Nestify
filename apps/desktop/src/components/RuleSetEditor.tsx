import { useEffect, useId, useMemo, useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  Collision,
  RuleAction,
  RuleDefinitionSummary,
  RuleSetSummary,
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

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function serializeJson(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

function parseUnknownJson(text: string): ParseResult<unknown> {
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

function parseExtractJson(text: string): ParseResult<RuleDefinitionSummary['extract']> {
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
        error: `变量 "${key}" 必须是 { from: "..." } 格式`,
      }
    }
  }
  return { ok: true, value: result.value as RuleDefinitionSummary['extract'] }
}

function JsonTextArea({
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
    const [rule] = rules.splice(index, 1)
    rules.splice(target, 0, rule)
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
                    <Input
                      id={`${fieldId}-rule-${index}-template`}
                      value={rule.template ?? ''}
                      disabled={disabled}
                      placeholder="{name}{ext}"
                      onChange={(event) => updateRule(index, { template: event.target.value })}
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

                  <JsonTextArea
                    label="Match JSON"
                    value={rule.match}
                    placeholder={'{"kind":"image"}'}
                    disabled={disabled}
                    parse={parseUnknownJson}
                    onCommit={(match) => updateRule(index, { match })}
                  />
                  <JsonTextArea
                    label="Extract JSON"
                    value={rule.extract}
                    placeholder={'{"date":{"from":"..."}}'}
                    disabled={disabled}
                    parse={parseExtractJson}
                    onCommit={(extract) => updateRule(index, { extract: extract as RuleDefinitionSummary['extract'] })}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
