import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  FileSearch,
  FolderOpen,
  History,
  Loader2,
  Play,
  Plus,
  Power,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react'
import { RuleSetEditor, type RuleSetEditorValue } from '@/components/RuleSetEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { PlanTable } from '@/components/workspace/PlanTable'
import type { ChangePlan, Collision, DuplicateScope, RuleSetSummary } from '@/lib/ipc'
import { opLabel } from '@/lib/labels'
import { COLLISION_LABEL, DUPLICATE_SCOPE_LABEL } from '@/lib/workspace'

export function RulesPane({
  ruleSets,
  selectedRuleSet,
  collision,
  scope,
  directory,
  searchSelectedCount,
  canPreview,
  canUseSelectedDirectory,
  busy,
  actionBusy,
  ruleDraft,
  onSelectRuleSet,
  onCollision,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onRuleDraft,
  onCreateRuleSet,
  onUpdateRuleSet,
  onRefreshRuleSet,
  onToggleRuleSet,
  onRuleSetPriority,
  onCloneRuleSet,
  onDeleteRuleSet,
  onExportRuleSet,
  onImportRuleSet,
  onPreview,
  plan,
  selectedOps,
  onToggleOp,
  selectedCount,
  busyExecute,
  busyRollback,
  lastExecuteJobId,
  onExecute,
  onRollback,
}: {
  ruleSets: RuleSetSummary[]
  selectedRuleSet: RuleSetSummary | null
  collision: Collision
  scope: DuplicateScope
  directory: string
  searchSelectedCount: number
  canPreview: boolean
  canUseSelectedDirectory: boolean
  busy: boolean
  actionBusy: string | null
  ruleDraft: RuleSetEditorValue
  onSelectRuleSet: (id: string) => void
  onCollision: (value: Collision) => void
  onScope: (value: DuplicateScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onRuleDraft: (value: RuleSetEditorValue) => void
  onCreateRuleSet: () => void
  onUpdateRuleSet: () => void
  onRefreshRuleSet: () => void
  onToggleRuleSet: () => void
  onRuleSetPriority: (delta: number) => void
  onCloneRuleSet: () => void
  onDeleteRuleSet: () => void
  onExportRuleSet: () => void
  onImportRuleSet: () => void
  onPreview: () => void
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  onToggleOp: (index: number, checked: boolean) => void
  selectedCount: number
  busyExecute: boolean
  busyRollback: boolean
  lastExecuteJobId: string | null
  onExecute: () => void
  onRollback: () => void
}) {
  const anyRuleAction = actionBusy !== null
  const anyBusy = anyRuleAction || busy || busyExecute || busyRollback
  const ruleActionPending = (key: string) => actionBusy === key
  const draftDirty =
    selectedRuleSet &&
    !selectedRuleSet.builtin &&
    (ruleDraft.name.trim() !== selectedRuleSet.name ||
      ruleDraft.description.trim() !== (selectedRuleSet.description ?? '') ||
      ruleDraft.dryRunDefault !== selectedRuleSet.dryRunDefault ||
      ruleDraft.collision !== selectedRuleSet.collision ||
      JSON.stringify(ruleDraft.rules) !== JSON.stringify(selectedRuleSet.rules))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="w-64">
          <Select value={selectedRuleSet?.id} disabled={anyBusy} onValueChange={onSelectRuleSet}>
            <SelectTrigger>
              <SelectValue placeholder="选择规则集" />
            </SelectTrigger>
            <SelectContent>
            {ruleSets.map((set) => (
              <SelectItem key={set.id} value={set.id}>
                {`${set.name}${set.builtin ? '（内置）' : set.enabled ? '' : '（禁用）'} · P${set.priority}`}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Select value={collision} disabled={anyBusy} onValueChange={(value) => onCollision(value as Collision)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
            {(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => (
              <SelectItem key={key} value={key}>
                {COLLISION_LABEL[key]}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <Select value={scope} disabled={anyBusy} onValueChange={(value) => onScope(value as DuplicateScope)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
            {(Object.keys(DUPLICATE_SCOPE_LABEL) as DuplicateScope[]).map((key) => (
              <SelectItem key={key} value={key}>
                {DUPLICATE_SCOPE_LABEL[key]}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </div>
        {scope === 'directory' ? (
          <div className="flex min-w-[16rem] flex-1 items-center gap-2">
            <Input
              value={directory}
              onChange={(event) => onDirectory(event.target.value)}
              placeholder="D:\\目录"
            />
            <Button
              variant="outline"
              size="icon"
              title="使用当前选中文件所在目录"
              disabled={!canUseSelectedDirectory || anyBusy}
              onClick={onUseSelectedDirectory}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {scope === 'selection' ? <Badge variant="outline">已选 {searchSelectedCount}</Badge> : null}
        <Button
          onClick={onPreview}
          disabled={!selectedRuleSet || !selectedRuleSet.enabled || anyBusy || !canPreview}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
          Dry-run
        </Button>
        <Button onClick={onExecute} disabled={anyBusy || selectedCount === 0}>
          {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          执行选中
        </Button>
        {lastExecuteJobId ? (
          <Button variant="outline" onClick={onRollback} disabled={anyBusy}>
            {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            回滚
          </Button>
        ) : null}
        {plan ? <Badge>{selectedCount}/{plan.ops.length} 勾选</Badge> : null}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)]">
        <ScrollArea className="border-r p-3">
          {selectedRuleSet ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{selectedRuleSet.name}</div>
                  <div className="text-sm text-muted-foreground">优先级 P{selectedRuleSet.priority}</div>
                </div>
                <Badge variant={selectedRuleSet.enabled ? 'default' : 'outline'}>
                  {selectedRuleSet.builtin ? '内置只读' : selectedRuleSet.enabled ? '启用' : '禁用'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" size="icon" title="新建自定义规则集" disabled={anyBusy} onClick={onCreateRuleSet}>
                  {ruleActionPending('rules:create') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="刷新当前规则集"
                  disabled={anyBusy}
                  onClick={onRefreshRuleSet}
                >
                  {ruleActionPending('rules:get') ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="克隆当前规则集"
                  disabled={!selectedRuleSet || anyBusy}
                  onClick={onCloneRuleSet}
                >
                  {ruleActionPending('rules:clone') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title={selectedRuleSet.enabled ? '禁用规则集' : '启用规则集'}
                  disabled={selectedRuleSet.builtin || anyBusy}
                  onClick={onToggleRuleSet}
                >
                  {ruleActionPending('rules:enable') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="提高优先级（数字更小）"
                  disabled={selectedRuleSet.builtin || anyBusy}
                  onClick={() => onRuleSetPriority(-1)}
                >
                  {ruleActionPending('rules:priority') ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="降低优先级（数字更大）"
                  disabled={selectedRuleSet.builtin || anyBusy}
                  onClick={() => onRuleSetPriority(1)}
                >
                  {ruleActionPending('rules:priority') ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDown className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="导出 YAML"
                  disabled={!selectedRuleSet || anyBusy}
                  onClick={onExportRuleSet}
                >
                  {ruleActionPending('rules:export') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" title="导入 YAML" disabled={anyBusy} onClick={onImportRuleSet}>
                  {ruleActionPending('rules:import') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="删除自定义规则集"
                  disabled={selectedRuleSet.builtin || anyBusy}
                  onClick={onDeleteRuleSet}
                >
                  {ruleActionPending('rules:delete') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
              {selectedRuleSet.builtin ? (
                <p className="text-sm text-muted-foreground">内置规则集只读。需要修改时先克隆为自定义规则集。</p>
              ) : (
                <div className="space-y-2 border-b pb-3">
                  <RuleSetEditor value={ruleDraft} disabled={anyBusy} onChange={onRuleDraft} />
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={anyBusy || !draftDirty || !ruleDraft.name.trim()}
                    onClick={onUpdateRuleSet}
                  >
                    {ruleActionPending('rules:update') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    保存信息
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{selectedRuleSet.description || '按优先级匹配后生成变更计划'}</p>
              {selectedRuleSet.builtin
                ? selectedRuleSet.rules.map((rule, index) => (
                    <div key={rule.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{rule.id}</span>
                        <Badge variant={rule.enabled ? 'default' : 'outline'}>{rule.enabled ? '启用' : '禁用'}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        P{rule.priority} · {opLabel(rule.action)}
                      </div>
                      {rule.template ? <code className="block break-all text-xs">{rule.template}</code> : null}
                      {index < selectedRuleSet.rules.length - 1 ? <Separator /> : null}
                    </div>
                  ))
                : null}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">没有规则方案</div>
          )}
        </ScrollArea>
        <PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} />
      </div>
    </div>
  )
}

