import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowDown, ArrowUp, Eye, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { MagicParameterInput } from '@/components/rules/MagicParameterInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { OrganizeRuleAction, OrganizeRuleInput, OrganizeRuleStep } from '@/lib/ipc'

const ACTION_OPTIONS: Array<{ value: OrganizeRuleAction; label: string; hint: string }> = [
  { value: 'move', label: '移动到目标目录', hint: '改变对象所在位置，文件名默认保持不变' },
  { value: 'rename_file', label: '重命名文件', hint: '只改变文件名，不改变所在目录' },
  { value: 'rename_dir', label: '重命名文件夹', hint: '只改变文件夹名称，子项会跟随新路径' },
  { value: 'flatten_dir', label: '拍平单层文件夹', hint: '把唯一子文件夹中的内容提到当前目录' },
]

const TARGET_OPTIONS = [
  { value: 'files', label: '文件' },
  { value: 'directories', label: '文件夹' },
  { value: 'both', label: '文件和文件夹' },
] as const

const SCOPE_OPTIONS = [
  { value: 'current', label: '当前文件夹直属对象', hint: '只处理整理根目录直属对象' },
  { value: 'descendants', label: '所有子文件夹对象', hint: '只处理整理根目录下的后代对象' },
  { value: 'all', label: '当前文件夹及所有子文件夹', hint: '批量整理整棵目录树' },
] as const

type EditorState = { mode: 'edit'; index: number; rule: OrganizeRuleInput } | { mode: 'view'; rule: OrganizeRuleInput }

function actionInfo(action: OrganizeRuleAction) { return ACTION_OPTIONS.find((item) => item.value === action) }
function actionOptionsFor(action: OrganizeRuleAction) {
  if (action !== 'delete_to_quarantine') return ACTION_OPTIONS
  return [...ACTION_OPTIONS, { value: 'delete_to_quarantine' as const, label: '移入隔离区（兼容旧规则）', hint: '旧规则动作仍会被保留；新动作请使用移动或重命名' }]
}
function actionLabel(action: OrganizeRuleAction): string { return actionInfo(action)?.label ?? (action === 'delete_to_quarantine' ? '移入隔离区' : action) }
function targetValue(rule: OrganizeRuleInput): NonNullable<OrganizeRuleInput['target']> { return rule.target ?? (rule.action === 'rename_dir' || rule.action === 'flatten_dir' ? 'directories' : 'files') }
function scopeValue(rule: OrganizeRuleInput): NonNullable<OrganizeRuleInput['scope']> { return rule.scope ?? 'all' }
function conditionSummary(rule: OrganizeRuleInput): string { return rule.filter?.trim() || '范围内全部对象' }
function templateSummary(action: OrganizeRuleAction, template?: string): string { if (action === 'flatten_dir') return '提取唯一子文件夹内容'; if (action === 'delete_to_quarantine') return '移入隔离区，不直接删除'; return template?.trim() || '未设置模板' }
function normalizeSteps(rule: OrganizeRuleInput): OrganizeRuleStep[] { return rule.steps?.length ? rule.steps : [{ id: `${rule.id}-action-1`, action: rule.action, template: rule.template }] }
function copyWithOrder(rules: OrganizeRuleInput[]): OrganizeRuleInput[] { return rules.map((rule, index) => ({ ...rule, priority: index + 1 })) }

export function OrganizeRulesEditor({ rules, onChange, disabled, previewName }: { rules: OrganizeRuleInput[]; onChange: (rules: OrganizeRuleInput[]) => void; disabled?: boolean; previewName?: string }) {
  const [listOpen, setListOpen] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const openEditor = (state: EditorState) => { setListOpen(false); setEditor(state) }
  const closeEditor = () => { setEditor(null); setListOpen(true) }
  const addRule = () => {
    const used = new Set(rules.map((rule) => rule.id))
    let number = rules.length + 1
    while (used.has(`organize-rule-${number}`)) number += 1
    const id = `organize-rule-${number}`
    openEditor({ mode: 'edit', index: -1, rule: { id, name: `整理规则 ${number}`, enabled: true, priority: rules.length + 1, target: 'files', scope: 'all', filter: '', action: 'move', template: '分类/{name}{ext}', steps: [{ id: `${id}-action-1`, action: 'move', template: '分类/{name}{ext}' }] } })
  }
  const saveRule = (rule: OrganizeRuleInput) => { const next = editor?.mode === 'edit' && editor.index >= 0 ? rules.map((item, index) => index === editor.index ? rule : item) : [...rules, rule]; onChange(copyWithOrder(next)); closeEditor() }
  const deleteRule = (index: number) => onChange(copyWithOrder(rules.filter((_, ruleIndex) => ruleIndex !== index)))
  const moveRule = (index: number, offset: -1 | 1) => { const target = index + offset; if (target < 0 || target >= rules.length) return; const next = [...rules]; const current = next[index]!; next[index] = next[target]!; next[target] = current; onChange(copyWithOrder(next)) }

  return <>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => setListOpen(true)}><Settings2 className="h-4 w-4" />设置规则</Button>
    <Dialog open={listOpen} onOpenChange={setListOpen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" />设置整理规则</DialogTitle><DialogDescription>规则只属于本次整理，按列表顺序处理；越靠前越优先。每条规则可以设置自己的目录范围和多个动作。</DialogDescription></DialogHeader>
        <div className="space-y-2">{rules.length === 0 ? <div className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">还没有规则，先添加一条规则开始整理。</div> : rules.map((rule, index) => <RuleListRow key={rule.id} rule={rule} index={index} total={rules.length} disabled={disabled} onMove={moveRule} onToggle={(checked) => onChange(copyWithOrder(rules.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: checked } : item)))} onView={() => openEditor({ mode: 'view', rule })} onEdit={() => openEditor({ mode: 'edit', index, rule })} onDelete={() => deleteRule(index)} />)}</div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:space-x-0"><Button type="button" variant="outline" disabled={disabled} onClick={addRule}><Plus className="h-4 w-4" />添加规则</Button><Button type="button" onClick={() => setListOpen(false)}>完成</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <OrganizeRuleDialog state={editor} disabled={disabled} previewName={previewName} onClose={closeEditor} onSave={saveRule} />
  </>
}

function RuleListRow({ rule, index, total, disabled, onMove, onToggle, onView, onEdit, onDelete }: { rule: OrganizeRuleInput; index: number; total: number; disabled?: boolean; onMove: (index: number, offset: -1 | 1) => void; onToggle: (checked: boolean) => void; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const steps = normalizeSteps(rule)
  return <div className={`rounded-md border p-3 ${rule.enabled ? 'bg-background' : 'bg-muted/30'}`}><div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center"><div className="flex shrink-0 items-center gap-1 lg:flex-col"><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="上移规则" disabled={disabled || index === 0} onClick={() => onMove(index, -1)}><ArrowUp className="h-4 w-4" /></Button><span className="w-7 text-center text-xs font-medium text-muted-foreground">{index + 1}</span><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="下移规则" disabled={disabled || index === total - 1} onClick={() => onMove(index, 1)}><ArrowDown className="h-4 w-4" /></Button></div><div className="min-w-0 flex-1 space-y-2"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="min-w-0 max-w-full truncate text-sm font-medium">{rule.name || `规则 ${index + 1}`}</span>{!rule.enabled ? <Badge variant="outline">已停用</Badge> : null}<Badge variant="secondary">处理{targetValue(rule) === 'both' ? '文件和文件夹' : targetValue(rule) === 'directories' ? '文件夹' : '文件'}</Badge><Badge variant="outline">{steps.length > 1 ? `${steps.length} 个动作` : actionLabel(steps[0]?.action ?? rule.action)}</Badge></div><div className="grid min-w-0 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2"><div className="min-w-0 truncate" title={conditionSummary(rule)}>条件：{conditionSummary(rule)}</div><div className="min-w-0 truncate">范围：{SCOPE_OPTIONS.find((item) => item.value === scopeValue(rule))?.label}</div><div className="min-w-0 truncate" title={steps.map((step) => templateSummary(step.action, step.template)).join('；')}>动作：{steps.map((step) => actionLabel(step.action)).join(' -> ')}</div><div className="min-w-0 truncate">命中后：停止检查后续规则</div></div></div><div className="flex shrink-0 flex-wrap items-center justify-end gap-1 border-t pt-2 lg:border-t-0 lg:pt-0"><label className="mr-1 flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={rule.enabled} disabled={disabled} onCheckedChange={(checked) => onToggle(checked === true)} />启用</label><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onView}><Eye className="h-3.5 w-3.5" />查看</Button><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onEdit}><Pencil className="h-3.5 w-3.5" />设置</Button><Button type="button" variant="ghost" size="icon" title="删除规则" disabled={disabled} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button></div></div></div>
}

function OrganizeRuleDialog({ state, disabled, previewName, onClose, onSave }: { state: EditorState | null; disabled?: boolean; previewName?: string; onClose: () => void; onSave: (rule: OrganizeRuleInput) => void }) {
  const readOnly = state?.mode === 'view'
  const [draft, setDraft] = useState<OrganizeRuleInput | null>(null)
  const [dialogContent, setDialogContent] = useState<HTMLDivElement | null>(null)
  useEffect(() => { if (!state) { setDraft(null); return }; setDraft({ ...state.rule, target: targetValue(state.rule), scope: scopeValue(state.rule), filter: state.rule.filter ?? '', steps: normalizeSteps(state.rule) }) }, [state])
  const updateDraft = (patch: Partial<OrganizeRuleInput>) => setDraft((current) => current ? { ...current, ...patch } : current)
  const updateSteps = (steps: OrganizeRuleStep[]) => { const first = steps[0]; updateDraft({ steps, action: first?.action ?? 'move', template: first?.template }) }
  const save = () => { if (!draft || !draft.name.trim()) return; const steps = normalizeSteps(draft).map((step, index) => ({ ...step, id: step.id || `${draft.id}-action-${index + 1}`, template: step.template?.trim() })); onSave({ ...draft, name: draft.name.trim(), filter: draft.filter?.trim() ?? '', steps, action: steps[0]?.action ?? draft.action, template: steps[0]?.template }) }
  return <Dialog open={state !== null} onOpenChange={(open) => { if (!open) onClose() }}><DialogContent ref={setDialogContent} className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><Button type="button" variant="ghost" size="icon" className="-ml-2 h-7 w-7" title="返回规则列表" onClick={onClose}><ArrowLeft className="h-4 w-4" /></Button>{readOnly ? '查看整理规则' : '设置整理规则'}</DialogTitle><DialogDescription>{readOnly ? '查看这条规则处理的对象、条件、范围和动作。' : '用“当……时，依次执行……”配置一条规则。系统只在预览中计算，确认后才会改变真实文件。'}</DialogDescription></DialogHeader>{readOnly && state ? <RuleSummary rule={state.rule} /> : draft ? <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start"><div className="space-y-1.5"><Label>规则名称</Label><Input value={draft.name} disabled={disabled} placeholder="例如：图片归类" onChange={(event) => updateDraft({ name: event.target.value })} /></div><div className="space-y-1.5"><Label>规则状态</Label><label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm"><Checkbox checked={draft.enabled} disabled={disabled} onCheckedChange={(checked) => updateDraft({ enabled: checked === true })} />启用这条规则</label></div></div><section className="space-y-3 rounded-md border p-3"><div><div className="text-sm font-medium">1. 选择处理对象</div><div className="mt-1 text-xs text-muted-foreground">先决定规则作用于文件、文件夹，还是两者；再决定覆盖当前目录还是整棵目录树。</div></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>处理对象</Label><Select value={targetValue(draft)} disabled={disabled} onValueChange={(value) => updateDraft({ target: value as OrganizeRuleInput['target'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TARGET_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>处理范围</Label><Select value={scopeValue(draft)} disabled={disabled} onValueChange={(value) => updateDraft({ scope: value as OrganizeRuleInput['scope'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SCOPE_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent><div className="text-xs text-muted-foreground">{SCOPE_OPTIONS.find((item) => item.value === scopeValue(draft))?.hint}</div></Select></div></div></section><section className="space-y-3 rounded-md border p-3"><div><div className="text-sm font-medium">2. 设置“当什么条件成立”</div><div className="mt-1 text-xs text-muted-foreground">留空表示处理上面范围中的全部对象。空格分隔的关键词默认是“或者”，需要同时满足时在输入助手中插入“并且”。</div></div><MagicParameterInput context="scope-filter" value={draft.filter ?? ''} onChange={(value) => updateDraft({ filter: value })} disabled={disabled} placeholder="例：kind:image ext:jpg|png" portalContainer={dialogContent} /></section><ActionChainEditor steps={normalizeSteps(draft)} disabled={disabled} previewName={previewName} portalContainer={dialogContent} onChange={updateSteps} /><RuleExample rule={draft} /></div> : null}<DialogFooter><Button variant="outline" onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly ? <Button onClick={save} disabled={disabled || !draft?.name.trim()}>保存规则</Button> : null}</DialogFooter></DialogContent></Dialog>
}

function ActionChainEditor({ steps, disabled, previewName, portalContainer, onChange }: { steps: OrganizeRuleStep[]; disabled?: boolean; previewName?: string; portalContainer: HTMLElement | null; onChange: (steps: OrganizeRuleStep[]) => void }) {
  const update = (index: number, patch: Partial<OrganizeRuleStep>) => onChange(steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step))
  const move = (index: number, offset: -1 | 1) => { const target = index + offset; if (target < 0 || target >= steps.length) return; const next = [...steps]; const current = next[index]!; next[index] = next[target]!; next[target] = current; onChange(next) }
  const add = () => onChange([...steps, { id: `action-${Date.now()}-${steps.length + 1}`, action: 'rename_file', template: '{name}{ext}' }])
  const remove = (index: number) => onChange(steps.length <= 1 ? steps : steps.filter((_, stepIndex) => stepIndex !== index))
  return <section className="space-y-3 rounded-md border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-medium">3. 设置执行动作</div><div className="mt-1 text-xs text-muted-foreground">一个规则可以包含多个动作，按这里的顺序执行；后一步会读取前一步完成后的虚拟路径。</div></div><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={add}><Plus className="h-3.5 w-3.5" />添加动作</Button></div><div className="space-y-2">{steps.map((step, index) => { const info = actionInfo(step.action); return <div key={step.id} className="rounded-md bg-muted/30 p-3"><div className="flex items-center gap-2"><Badge variant="secondary">动作 {index + 1}</Badge><span className="text-sm font-medium">{info?.label ?? actionLabel(step.action)}</span><div className="ml-auto flex items-center gap-1"><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="上移动作" disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="下移动作" disabled={disabled || index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="删除动作" disabled={disabled || steps.length <= 1} onClick={() => remove(index)}><Trash2 className="h-3.5 w-3.5" /></Button></div></div><div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"><div className="space-y-1.5"><Label>动作</Label><Select value={step.action} disabled={disabled} onValueChange={(value) => update(index, { action: value as OrganizeRuleAction })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{actionOptionsFor(step.action).map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><div className="text-xs text-muted-foreground">{info?.hint}</div></div><div className="space-y-1.5"><Label>{step.action === 'move' ? '目标路径模板' : '名称模板'}</Label><MagicParameterInput context="rename-template" value={step.template ?? ''} onChange={(value) => update(index, { template: value })} disabled={disabled || step.action === 'flatten_dir'} placeholder={step.action === 'move' ? '例：图片/{name}{ext}' : '例：{name.trim().upper()}{ext}'} portalContainer={portalContainer} previewName={previewName} /><div className="text-xs text-muted-foreground">{step.action === 'move' ? '相对资料库根目录；目标目录不存在时会在预览中创建。' : step.action === 'flatten_dir' ? '根据目录结构拍平，不需要模板。' : '文件夹改名后，子项路径会跟随父目录变化。'}</div></div></div></div> })}</div></section>
}

function RuleSummary({ rule }: { rule: OrganizeRuleInput }) { const steps = normalizeSteps(rule); return <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Badge variant={rule.enabled ? 'default' : 'outline'}>{rule.enabled ? '已启用' : '已停用'}</Badge><Badge variant="secondary">{targetValue(rule) === 'directories' ? '文件夹' : targetValue(rule) === 'both' ? '文件和文件夹' : '文件'}</Badge><Badge variant="outline">{scopeValue(rule) === 'current' ? '当前文件夹直属对象' : scopeValue(rule) === 'descendants' ? '所有子文件夹对象' : '当前文件夹及所有子文件夹'}</Badge></div><div className="grid gap-3 sm:grid-cols-2"><SummaryField label="匹配条件" value={conditionSummary(rule)} /><SummaryField label="动作顺序" value={steps.map((step) => actionLabel(step.action)).join(' -> ')} /><SummaryField label="模板" value={steps.map((step) => templateSummary(step.action, step.template)).join('；')} code /></div></div> }
function SummaryField({ label, value, code }: { label: string; value: string; code?: boolean }) { return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label><div className="min-h-9 rounded-md border bg-muted/30 px-3 py-2 text-sm break-all">{code ? <code>{value}</code> : value}</div></div> }
function RuleExample({ rule }: { rule: OrganizeRuleInput }) { const steps = normalizeSteps(rule); return <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs"><div className="font-medium">效果示例</div><div className="mt-1 break-all text-muted-foreground">照片.jpg → {steps.map((step) => `${actionLabel(step.action)}：${templateSummary(step.action, step.template)}`).join('；')}</div></div> }
