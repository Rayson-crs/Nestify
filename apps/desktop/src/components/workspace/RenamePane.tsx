import { FileText, FolderOpen, History, Loader2, Play, Workflow } from 'lucide-react'
import { MagicWandInput } from '@/components/rules/RuleBuilderDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlanTable } from '@/components/workspace/PlanTable'
import type { ChangePlan, Collision, DuplicateScope, RuleSetSummary, SearchHit } from '@/lib/ipc'
import { COLLISION_LABEL, DUPLICATE_SCOPE_LABEL } from '@/lib/workspace'

type RenamePaneProps = {
  template: string
  collision: Collision
  scope: DuplicateScope
  directory: string
  searchSelectedCount: number
  canPreview: boolean
  canUseSelectedDirectory: boolean
  busy: boolean
  onTemplate: (value: string) => void
  onCollision: (value: Collision) => void
  onScope: (value: DuplicateScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onPreview: () => void
  ruleSets: RuleSetSummary[]
  selectedRuleSetId: string
  onRuleSet: (id: string) => void
  onPreviewRules: () => void
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  onToggleOp: (index: number, checked: boolean) => void
  selectedCount: number
  busyExecute: boolean
  busyRollback: boolean
  lastExecuteJobId: string | null
  onExecute: () => void
  onRollback: () => void
  sampleHits: SearchHit[]
}

function previewName(template: string, hit: SearchHit): string {
  const ext = hit.ext ? (hit.ext.startsWith('.') ? hit.ext : `.${hit.ext}`) : ''
  const stem = ext && hit.name.endsWith(ext) ? hit.name.slice(0, -ext.length) : hit.name
  return template.replaceAll('{name}', stem).replaceAll('{stem}', stem).replaceAll('{filename}', hit.name).replaceAll('{ext}', ext).replaceAll('{parent}', hit.parent?.split(/[\\/]/).filter(Boolean).at(-1) ?? '')
}

export function RenamePane(props: RenamePaneProps) {
  const { template, collision, scope, directory, searchSelectedCount, canPreview, canUseSelectedDirectory, busy, onTemplate, onCollision, onScope, onDirectory, onUseSelectedDirectory, onPreview, ruleSets, selectedRuleSetId, onRuleSet, onPreviewRules, plan, selectedOps, onToggleOp, selectedCount, busyExecute, busyRollback, lastExecuteJobId, onExecute, onRollback, sampleHits } = props
  const anyBusy = busy || busyExecute || busyRollback
  const samples = sampleHits.slice(0, 5)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 gap-3 border-b px-3 py-3 xl:grid-cols-[minmax(18rem,1fr)_minmax(22rem,1.3fr)]">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2"><FileText className="h-4 w-4" /><span className="text-sm font-medium">当前对象</span><Badge variant="outline">{samples.length}{sampleHits.length > samples.length ? ` / ${sampleHits.length}` : ''}</Badge></div>
          {samples.length > 0 ? <div className="max-h-28 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">{samples.map((hit) => <div key={hit.entryId} className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0 truncate" title={hit.path}>{hit.name}</span><span className="shrink-0 text-muted-foreground">{hit.kind === 'dir' ? '目录' : '文件'}</span></div>)}</div> : <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">先在“文件”页面选择或搜索文件，再回来设置改名模板。</div>}
          <p className="text-xs text-muted-foreground">范围：{scope === 'selection' ? `已选 ${searchSelectedCount} 项` : scope === 'directory' ? directory || '未指定目录' : '当前资料库'}</p>
        </div>
        <div className="min-w-0 space-y-2">
          <div className="text-sm font-medium">改名模板与预览</div>
          <MagicWandInput mode="rename" value={template} disabled={anyBusy} onApply={onTemplate} placeholder="{name}{ext}" />
          {samples.length > 0 ? <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs"><div className="font-medium">示例结果</div>{samples.slice(0, 3).map((hit) => <div key={hit.entryId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"><span className="truncate" title={hit.name}>{hit.name}</span><span className="text-muted-foreground">→</span><span className="truncate font-medium" title={previewName(template, hit)}>{previewName(template, hit)}</span></div>)}</div> : null}
        </div>
        <div className="space-y-2 xl:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-32"><Select value={scope} disabled={anyBusy} onValueChange={(value) => onScope(value as DuplicateScope)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(DUPLICATE_SCOPE_LABEL) as DuplicateScope[]).map((key) => <SelectItem key={key} value={key}>{DUPLICATE_SCOPE_LABEL[key]}</SelectItem>)}</SelectContent></Select></div>
            <div className="w-36"><Select value={collision} disabled={anyBusy} onValueChange={(value) => onCollision(value as Collision)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => <SelectItem key={key} value={key}>{COLLISION_LABEL[key]}</SelectItem>)}</SelectContent></Select></div>
            {scope === 'directory' ? <div className="flex min-w-[16rem] flex-1 items-center gap-2"><Input value={directory} disabled={anyBusy} onChange={(event) => onDirectory(event.target.value)} placeholder="D:\\目录" /><Button variant="outline" size="icon" title="使用当前选中文件所在目录" disabled={!canUseSelectedDirectory || anyBusy} onClick={onUseSelectedDirectory}><FolderOpen className="h-4 w-4" /></Button></div> : null}
            {scope === 'selection' ? <Badge variant="outline">已选 {searchSelectedCount}</Badge> : null}
            <Button onClick={onPreview} disabled={anyBusy || !template.trim() || !canPreview}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}预览改名</Button>
            <Select value={selectedRuleSetId} disabled={anyBusy || ruleSets.length === 0} onValueChange={onRuleSet}><SelectTrigger className="w-44"><SelectValue placeholder="多规则集" /></SelectTrigger><SelectContent>{ruleSets.map((set) => <SelectItem key={set.id} value={set.id}>{set.name}</SelectItem>)}</SelectContent></Select>
            <Button variant="outline" onClick={onPreviewRules} disabled={anyBusy || !selectedRuleSetId || !canPreview} title="按规则集中的多条规则统一预览"><Workflow className="h-4 w-4" />预览规则集</Button>
            <Button onClick={onExecute} disabled={anyBusy || selectedCount === 0}>{busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}执行选中</Button>
            {lastExecuteJobId ? <Button variant="outline" onClick={onRollback} disabled={anyBusy}>{busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}回滚</Button> : null}
            {plan ? <Badge>{selectedCount}/{plan.ops.length} 勾选</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground">复杂函数和冲突处理以“预览改名”生成的变更计划为准。</div>
        </div>
      </div>
      <PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} />
    </div>
  )
}
