import { ArrowDown, ArrowUp, Copy, Download, Ellipsis, FileSearch, FolderOpen, History, Loader2, Play, Plus, Power, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import { RuleSetEditor, type RuleSetEditorValue } from '@/components/RuleSetEditor'
import { RuleStepChainReadOnly } from '@/components/rules/RuleStepChainReadOnly'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { PlanTable } from '@/components/workspace/PlanTable'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ChangePlan, Collision, DuplicateScope, RuleDefinitionSummary, RuleStepSummary, RuleSetSummary } from '@/lib/ipc'
import { opLabel } from '@/lib/labels'
import { COLLISION_LABEL, DUPLICATE_SCOPE_LABEL } from '@/lib/workspace'

type Props = {
  ruleSets: RuleSetSummary[]; selectedRuleSet: RuleSetSummary | null; collision: Collision; scope: DuplicateScope; directory: string; searchSelectedCount: number; canPreview: boolean; canUseSelectedDirectory: boolean; busy: boolean; actionBusy: string | null; ruleDraft: RuleSetEditorValue
  onSelectRuleSet: (id: string) => void; onCollision: (value: Collision) => void; onScope: (value: DuplicateScope) => void; onDirectory: (value: string) => void; onUseSelectedDirectory: () => void; onRuleDraft: (value: RuleSetEditorValue) => void
  onCreateRuleSet: () => void | Promise<void>; onUpdateRuleSet: () => void | Promise<void>; onRefreshRuleSet: () => void | Promise<void>; onToggleRuleSet: () => void | Promise<void>; onRuleSetPriority: (delta: number) => void | Promise<void>; onCloneRuleSet: () => void | Promise<void>; onDeleteRuleSet: () => void; onExportRuleSet: () => void | Promise<void>; onImportRuleSet: () => void | Promise<void>; onPreview: () => void
  plan: ChangePlan | null; selectedOps: Record<number, boolean>; onToggleOp: (index: number, checked: boolean) => void; selectedCount: number; busyExecute: boolean; busyRollback: boolean; lastExecuteJobId: string | null; onExecute: () => void; onRollback: () => void
}

export function RulesPane(props: Props) {
  const { ruleSets, selectedRuleSet, collision, scope, directory, searchSelectedCount, canPreview, canUseSelectedDirectory, busy, actionBusy, ruleDraft, onSelectRuleSet, onCollision, onScope, onDirectory, onUseSelectedDirectory, onRuleDraft, onCreateRuleSet, onUpdateRuleSet, onRefreshRuleSet, onToggleRuleSet, onRuleSetPriority, onCloneRuleSet, onDeleteRuleSet, onExportRuleSet, onImportRuleSet, onPreview, plan, selectedOps, onToggleOp, selectedCount, busyExecute, busyRollback, lastExecuteJobId, onExecute, onRollback } = props
  const anyBusy = Boolean(actionBusy || busy || busyExecute || busyRollback)
  const pending = (key: string) => actionBusy === key
  const dirty = Boolean(selectedRuleSet && !selectedRuleSet.builtin && (ruleDraft.name.trim() !== selectedRuleSet.name || ruleDraft.description?.trim() !== (selectedRuleSet.description ?? '') || ruleDraft.dryRunDefault !== selectedRuleSet.dryRunDefault || ruleDraft.collision !== selectedRuleSet.collision || JSON.stringify(ruleDraft.rules) !== JSON.stringify(selectedRuleSet.rules)))
  return <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
    <div className="border-b px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-base font-semibold">规则工作流</h2><p className="mt-1 text-xs text-muted-foreground">先选择规则集和范围，再预览变更；预览完成后才会允许执行。</p></div><div className="flex flex-wrap items-center gap-2"><Button onClick={onPreview} disabled={!selectedRuleSet?.enabled || !canPreview || anyBusy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}生成预览</Button><Button onClick={onExecute} disabled={!plan || anyBusy || selectedCount === 0}>{busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}执行选中</Button>{lastExecuteJobId ? <Button variant="outline" onClick={onRollback} disabled={anyBusy}>{busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}回滚</Button> : null}{plan ? <Badge>{selectedCount}/{plan.ops.length} 项</Badge> : null}</div></div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(15rem,1.5fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(15rem,2fr)]">
        <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">1. 规则集</Label><Select value={selectedRuleSet?.id} disabled={anyBusy} onValueChange={onSelectRuleSet}><SelectTrigger><SelectValue placeholder="选择规则集" /></SelectTrigger><SelectContent>{ruleSets.map((set) => <SelectItem key={set.id} value={set.id}>{set.name}{set.builtin ? '（内置）' : !set.enabled ? '（禁用）' : ''} · P{set.priority}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">2. 冲突处理</Label><Select value={collision} disabled={anyBusy} onValueChange={(value) => onCollision(value as Collision)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => <SelectItem key={key} value={key}>{COLLISION_LABEL[key]}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">3. 执行范围</Label><Select value={scope} disabled={anyBusy} onValueChange={(value) => onScope(value as DuplicateScope)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(DUPLICATE_SCOPE_LABEL) as DuplicateScope[]).map((key) => <SelectItem key={key} value={key}>{DUPLICATE_SCOPE_LABEL[key]}</SelectItem>)}</SelectContent></Select></div>
        {scope === 'directory' ? <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">目标目录</Label><div className="flex gap-2"><Input value={directory} disabled={anyBusy} onChange={(event) => onDirectory(event.target.value)} placeholder="D:\\目录" /><Button variant="outline" size="icon" title="使用当前选中文件所在目录" disabled={!canUseSelectedDirectory || anyBusy} onClick={onUseSelectedDirectory}><FolderOpen className="h-4 w-4" /></Button></div></div> : <div className="flex items-end pb-1">{scope === 'selection' ? <Badge variant="outline">已选 {searchSelectedCount} 个文件</Badge> : <span className="text-xs text-muted-foreground">当前资料库中的全部内容</span>}</div>}
      </div>
    </div>
    <div className="grid min-h-0 grid-cols-[minmax(20rem,30rem)_minmax(0,1fr)]"><ScrollArea className="border-r"><div className="space-y-4 p-4">
      <section className="space-y-2"><div className="flex items-center justify-between"><div><div className="text-sm font-medium">规则集管理</div><div className="text-xs text-muted-foreground">{selectedRuleSet ? `${selectedRuleSet.rules.length} 条规则 · 优先级 P${selectedRuleSet.priority}` : '请选择规则集'}</div></div>{selectedRuleSet ? <Badge variant={selectedRuleSet.enabled ? 'default' : 'outline'}>{selectedRuleSet.builtin ? '内置只读' : selectedRuleSet.enabled ? '已启用' : '已禁用'}</Badge> : null}</div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={anyBusy} onClick={onCreateRuleSet}>{pending('rules:create') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}新建</Button><Button variant="outline" size="icon" title="刷新" disabled={anyBusy} onClick={onRefreshRuleSet}>{pending('rules:get') ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" title="更多管理操作" disabled={!selectedRuleSet || anyBusy}><Ellipsis className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuLabel>规则集管理</DropdownMenuLabel><DropdownMenuItem onSelect={onCloneRuleSet}><Copy className="h-4 w-4" />克隆当前规则集</DropdownMenuItem><DropdownMenuItem disabled={!selectedRuleSet || selectedRuleSet.builtin} onSelect={onToggleRuleSet}><Power className="h-4 w-4" />{selectedRuleSet?.enabled ? '禁用规则集' : '启用规则集'}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => onRuleSetPriority(-1)}><ArrowUp className="h-4 w-4" />提高优先级</DropdownMenuItem><DropdownMenuItem onSelect={() => onRuleSetPriority(1)}><ArrowDown className="h-4 w-4" />降低优先级</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={onExportRuleSet}><Download className="h-4 w-4" />导出 YAML</DropdownMenuItem><DropdownMenuItem onSelect={onImportRuleSet}><Upload className="h-4 w-4" />导入 YAML</DropdownMenuItem><DropdownMenuItem className="text-destructive focus:text-destructive" disabled={!selectedRuleSet || selectedRuleSet.builtin} onSelect={onDeleteRuleSet}><Trash2 className="h-4 w-4" />删除自定义规则集</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></section>
      <Separator />
      {selectedRuleSet ? (
        <section className="space-y-3">
          <div>
            <div className="text-sm font-medium">4. 编辑规则</div>
            <p className="mt-1 text-xs text-muted-foreground">
              按优先级依次匹配。内置规则只读，点下方"克隆此规则集"即可在编辑器里改动。
            </p>
          </div>
          {selectedRuleSet.builtin ? (
            <BuiltinRuleSetView ruleset={selectedRuleSet} onClone={onCloneRuleSet} busy={anyBusy} />
          ) : (
            <>
              <RuleSetEditor value={ruleDraft} disabled={anyBusy} onChange={onRuleDraft} />
              <Button
                className="w-full"
                disabled={!dirty || anyBusy || !ruleDraft.name.trim()}
                onClick={onUpdateRuleSet}
              >
                {pending('rules:update') ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                保存规则集
              </Button>
            </>
          )}
        </section>
      ) : (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          先在上方选择或新建规则集。右侧预览区会显示不会写盘的变更计划。
        </div>
      )}
    </div></ScrollArea><div className="min-w-0"><PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} /></div></div>
  </div>
}

/**
 * 内置规则只读视图。每个规则卡片显示：
 *   - 编号 / ID / 优先级 / action
 *   - 步骤链胶囊（RuleStepChainReadOnly）：让用户看到规则到底怎么一步步执行
 *   - 一键克隆按钮（profile 级）
 */
function BuiltinRuleSetView({
  ruleset,
  onClone,
  busy,
}: {
  ruleset: RuleSetSummary
  onClone: () => void | Promise<void>
  busy: boolean
}) {
  const stepRuleCount = ruleset.rules.filter(
    (rule) => Array.isArray(rule.steps) && rule.steps.length > 0,
  ).length
  return (
    <div className="space-y-3 rounded-md border p-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{ruleset.name}</div>
          {ruleset.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{ruleset.description}</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant="outline">P{ruleset.priority}</Badge>
            <Badge variant="outline">{ruleset.rules.length} 条规则</Badge>
            {stepRuleCount > 0 ? (
              <Badge variant="default" className="text-[10px]">
                {stepRuleCount} 条用步骤链
              </Badge>
            ) : null}
          </div>
        </div>
        <Button size="sm" variant="default" disabled={busy} onClick={onClone}>
          <Copy className="h-4 w-4" />
          克隆此规则集
        </Button>
      </header>

      <Separator />

      <ol className="space-y-3">
        {ruleset.rules.map((rule, index) => (
          <li key={rule.id} className="space-y-2 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="truncate text-xs font-medium">
                {index + 1}. {rule.id}
              </span>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  P{rule.priority}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {opLabel(rule.action)}
                </Badge>
                <Badge variant={rule.enabled ? 'default' : 'outline'} className="text-[10px]">
                  {rule.enabled ? '启用' : '禁用'}
                </Badge>
              </div>
            </div>
            {(rule as RuleDefinitionSummary).template ? (
              <code className="block break-all rounded bg-background px-2 py-1 text-[11px]">
                {(rule as RuleDefinitionSummary).template}
              </code>
            ) : null}
            <RuleStepChainReadOnly
              steps={(rule as { steps?: RuleStepSummary[] }).steps}
              defaultOpen
              emptyHint="此规则未启用步骤链，执行器将回退到老 match+action 路径。"
            />
          </li>
        ))}
      </ol>
    </div>
  )
}

