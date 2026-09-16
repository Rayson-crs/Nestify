import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowUp, Check, FileSearch, FolderSearch, HelpCircle, History, Loader2, Play, RotateCcw, Settings2, ShieldCheck } from 'lucide-react'
import { MagicParameterInput } from '@/components/rules/MagicParameterInput'
import { OrganizeRulesEditor } from '@/components/organize/OrganizeRulesEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { kindFromPath, KindIcon } from '@/components/files/kind'
import { ResizableTable, SearchSortHeader, TruncatedCell, useColumnWidths } from '@/components/files/ResizableTable'
import { PlanTable } from '@/components/workspace/PlanTable'
import type { ChangePlan, Collision, ExecutionProgress, OrganizePreviewPayload, OrganizeRuleInput, SearchHit, SearchSortField } from '@/lib/ipc'
import { ExecutionProgressOverlay } from '@/components/workspace/ExecutionProgressOverlay'
import type { OrganizeStep } from '@/app/types'
import { COLLISION_LABEL, type TriStateSortDirection } from '@/lib/workspace'
import { PreviewPagination } from './PreviewPagination'

const STEP_LABELS: Array<{ key: OrganizeStep; label: string }> = [
  { key: 'pick', label: '1 选择文件夹' },
  { key: 'filter', label: '2 加载并筛选' },
  { key: 'rules', label: '3 设置规则和预览' },
  { key: 'result', label: '4 确认执行' },
]

function fileName(path: string | null | undefined): string {
  if (!path) return '-'
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

const PREVIEW_ACTION_LABEL: Record<string, string> = {
  mkdir: '创建目录',
  move: '移动',
  rename: '重命名',
  flatten: '拍平目录',
  quarantine: '移入隔离区',
  delete: '删除',
}

function previewActionClass(action: string): string {
  if (action === 'quarantine' || action === 'delete') return 'border-red-200 bg-red-50 text-red-700'
  if (action === 'move' || action === 'rename') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (action === 'mkdir' || action === 'flatten') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return ''
}

function displayPath(path: string): string {
  return path.replace(/[\\/]+/g, '/').replace(/\/$/, '') || path
}

function pathKey(path: string): string {
  return displayPath(path).toLocaleLowerCase()
}

function applyPathChange(current: string, from: string, to: string): string | null {
  const currentKey = pathKey(current)
  const fromKey = pathKey(from)
  if (currentKey !== fromKey && !currentKey.startsWith(`${fromKey}/`)) return null
  const suffix = currentKey === fromKey ? '' : displayPath(current).slice(displayPath(from).length)
  return `${displayPath(to)}${suffix}`
}

function projectOrganizeEntryPath(
  entryPath: string,
  entryId: string,
  ops: ChangePlan['ops'],
): { path: string; ops: ChangePlan['ops'] } {
  let current = displayPath(entryPath)
  const matchedOps: ChangePlan['ops'] = []
  for (const op of ops) {
    if (op.op === 'mkdir') continue
    if (op.entryId === entryId) {
      matchedOps.push(op)
      if (op.to) current = displayPath(op.to)
      continue
    }
    if (!op.to) continue
    const changed = applyPathChange(current, op.from, op.to)
    if (changed === null) continue
    current = changed
    matchedOps.push(op)
  }
  return { path: current, ops: matchedOps }
}

const PREVIEW_PAGE_SIZE = 200

function describeHitRules(ops: ChangePlan['ops'], names: Map<string, string>): string {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const op of ops) {
    if (op.op === 'mkdir') continue
    const name = (op.ruleId && names.get(op.ruleId)) || op.ruleId || '整理规则'
    const text = `${name}：${op.reason}`
    if (seen.has(text)) continue
    seen.add(text)
    parts.push(text)
  }
  return parts.join('；')
}

export function OrganizePane({
  step, directory, matchedLibraryName, blockReason, filter, filterPreview, directoryPreview, directoryPreviewTotal,
  directoryPreviewOffset, directoryPreviewHasMore, directoryPreviewBusy, filterPreviewTotal, filterPreviewOffset, filterPreviewHasMore, filterPreviewBusy,
  previewSort, previewSortDirection, ruleDraft, collision, preview, plan, selectedOps, selectedCount, busy,
  previewBusy, busyExecute, busyRollback, executeProgress, lastExecuteJobId, canGoParent, canPick, canRules, onDirectory, onPickDirectory,
  onFilter, onRuleDraft, onCollision, onPreviewSort, onDirectoryPreviewPage, onFilterPreviewPage, onEnterDirectory, onGoParent, onNextFromFilter,
  onNextFromRules, onBackToPick, onEditFilter, onEditRules, onToggleOp, onExecute, onRollback,
}: {
  step: OrganizeStep
  directory: string
  matchedLibraryName: string | null
  blockReason: string | null
  filter: string
  filterPreview: SearchHit[] | null
  directoryPreview: SearchHit[] | null
  directoryPreviewTotal: number
  directoryPreviewOffset: number
  directoryPreviewHasMore: boolean
  directoryPreviewBusy: boolean
  filterPreviewTotal: number
  filterPreviewOffset: number
  filterPreviewHasMore: boolean
  filterPreviewBusy: boolean
  previewSort: 'name' | 'size' | 'mtime'
  previewSortDirection: TriStateSortDirection
  ruleDraft: OrganizeRuleInput[]
  collision: Collision
  preview: OrganizePreviewPayload | null
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  selectedCount: number
  busy: boolean
  previewBusy: boolean
  busyExecute: boolean
  busyRollback: boolean
  executeProgress: ExecutionProgress | null
  lastExecuteJobId: string | null
  canGoParent: boolean
  canPick: boolean
  canRules: boolean
  onDirectory: (value: string) => void
  onPickDirectory: () => void
  onFilter: (value: string) => void
  onRuleDraft: (value: OrganizeRuleInput[]) => void
  onCollision: (value: Collision) => void
  onPreviewSort: (field: 'name' | 'size' | 'mtime') => void
  onDirectoryPreviewPage: (delta: -1 | 1) => void
  onFilterPreviewPage: (delta: -1 | 1) => void
  onEnterDirectory: (hit: SearchHit) => void
  onGoParent: () => void
  onNextFromFilter: () => void
  onNextFromRules: () => void
  onBackToPick: () => void
  onEditFilter: () => void
  onEditRules: () => void
  onToggleOp: (index: number, checked: boolean) => void
  onExecute: () => void
  onRollback: () => void
}) {
  const anyBusy = busy || busyExecute || busyRollback
  const tableBusy = previewBusy || busy
  const stepIndex = STEP_LABELS.findIndex((item) => item.key === step)
  const { widths, resize } = useColumnWidths([280, 96, 150])
  const showingFilterPreview = filter.trim().length > 0
  const effectiveDirectoryPreview = showingFilterPreview ? filterPreview : directoryPreview
  const effectiveDirectoryTotal = showingFilterPreview ? filterPreviewTotal : directoryPreviewTotal
  const sortField: Record<'name' | 'size' | 'mtime', SearchSortField> = { name: 'name', size: 'size', mtime: 'mtime' }
  const enabledRuleCount = ruleDraft.filter((rule) => rule.enabled).length
  const ruleNames = useMemo(() => new Map(ruleDraft.map((rule) => [rule.id, rule.name.trim() || rule.id])), [ruleDraft])
  const hitRows = useMemo(() => {
    if (!preview) return []
    const candidateIds = new Set(preview.candidateEntryIds)
    return preview.snapshot.entries.flatMap((entry) => {
      if (!candidateIds.has(entry.id)) return []
      const projected = projectOrganizeEntryPath(entry.path, entry.id, preview.plan.ops)
      const ops = projected.ops.filter((op) => op.op !== 'mkdir')
      if (ops.length === 0) return []
      return [{
        entry,
        before: entry.path,
        after: projected.path,
        ops,
        hitRules: describeHitRules(ops, ruleNames),
      }]
    })
  }, [preview, ruleNames])
  const [previewOffset, setPreviewOffset] = useState(0)
  useEffect(() => setPreviewOffset(0), [preview, hitRows.length])

  const effectivePreviewOffset = showingFilterPreview ? filterPreviewOffset : directoryPreviewOffset
  const effectivePreviewHasMore = showingFilterPreview ? filterPreviewHasMore : directoryPreviewHasMore
  const effectivePreviewBusy = showingFilterPreview ? filterPreviewBusy : directoryPreviewBusy
  const effectivePreviewTotal = showingFilterPreview ? filterPreviewTotal : directoryPreviewTotal

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        {STEP_LABELS.map((item, index) => {
          const active = item.key === step
          const done = index < stepIndex
          return <div key={item.key} className="flex items-center gap-1">
            {index > 0 ? <Separator className="mx-1 w-4" /> : null}
            <span className={active ? 'rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary' : done ? 'rounded-md px-2 py-0.5 text-xs text-muted-foreground' : 'rounded-md px-2 py-0.5 text-xs text-muted-foreground/60'}>{item.label}</span>
          </div>
        })}
      </div>

      {step === 'pick' ? <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-xl space-y-4 text-center">
          <FolderSearch className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <div className="space-y-1">
            <div className="text-sm font-medium">选择要整理的文件夹</div>
            <div className="text-xs text-muted-foreground">整理模块只从这里确定文件夹边界；规则在后续步骤独立配置{matchedLibraryName ? `（当前匹配：${matchedLibraryName}）` : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button className="mx-auto min-w-44" onClick={onPickDirectory} disabled={anyBusy}><FolderSearch className="h-4 w-4" />选择文件夹</Button>
          </div>
          {blockReason ? <div className="flex items-center justify-center gap-1.5 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><HelpCircle className="h-3.5 w-3.5 shrink-0" />{blockReason}</div> : null}
        </div>
      </div> : null}

      {step === 'filter' ? <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="max-w-[24rem] truncate" title={directory}>{directory}</Badge>
          {matchedLibraryName ? <Badge variant="outline">{matchedLibraryName}</Badge> : null}
          <Button variant="ghost" size="sm" onClick={onBackToPick} disabled={anyBusy}><ArrowLeft className="h-3.5 w-3.5" />重新选择文件夹</Button>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">{canGoParent ? <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="返回上一级文件夹" onClick={onGoParent}><ArrowUp className="h-3.5 w-3.5" /></Button> : null}<FileSearch className="h-3.5 w-3.5" /><span className="truncate" title={directory}>文件夹内容（双击子文件夹进入，点击表头排序）</span></span>
            <span className="shrink-0">{effectivePreviewBusy ? '正在加载…' : effectiveDirectoryPreview ? (showingFilterPreview ? effectiveDirectoryTotal === 0 ? '筛选没有命中对象' : `筛选命中 ${filterPreviewOffset + 1}-${Math.min(effectiveDirectoryTotal, filterPreviewOffset + 200)} / 共 ${effectiveDirectoryTotal} 项` : effectiveDirectoryPreview.length >= effectiveDirectoryTotal ? `${effectiveDirectoryTotal} 项` : `前 ${directoryPreviewOffset + 1}-${Math.min(directoryPreviewTotal, directoryPreviewOffset + 200)} / 共 ${directoryPreviewTotal} 项`) : '尚未加载'}</span>
          </div>
          <ResizableTable widths={widths}>
            <TableHeader><TableRow>
              {(['name', 'size', 'mtime'] as const).map((field, index) => <SearchSortHeader key={field} label={field === 'name' ? '名称' : field === 'size' ? '大小' : '修改时间'} field={sortField[field]} sort={sortField[previewSort]!} direction={previewSortDirection} disabled={anyBusy} onSort={(value) => { if (value === 'name' || value === 'size' || value === 'mtime') onPreviewSort(value) }} width={widths[index]!} onResize={resize(index, index === 0 ? 160 : index === 1 ? 72 : 112, index === 0 ? 560 : index === 1 ? 160 : 220)} />)}
            </TableRow></TableHeader>
            <TableBody>{effectiveDirectoryPreview === null || effectiveDirectoryPreview.length === 0 ? <TableRow><TableCell colSpan={3} className="py-10 text-center text-muted-foreground">{effectivePreviewBusy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label="加载中" /> : filter.trim() ? '当前筛选没有命中对象' : '文件夹为空或尚未扫描，请先对资料库执行扫描'}</TableCell></TableRow> : effectiveDirectoryPreview.map((hit) => <TableRow key={hit.entryId} className={hit.kind === 'dir' ? 'cursor-pointer' : undefined} title={hit.kind === 'dir' ? `双击进入 ${hit.name}` : hit.path} onDoubleClick={() => { if (hit.kind === 'dir') onEnterDirectory(hit) }}>
              <TruncatedCell className="font-medium" width={widths[0]!} title={hit.name}><span className="flex min-w-0 items-center gap-2"><span className="shrink-0" title={hit.kind}><KindIcon kind={hit.kind} /></span><span className="truncate">{hit.name}</span></span></TruncatedCell>
              <TruncatedCell width={widths[1]!} title={hit.kind === 'dir' ? '-' : String(hit.size)}>{hit.kind === 'dir' ? '-' : hit.size}</TruncatedCell>
              <TruncatedCell width={widths[2]!} title={hit.mtime ? new Date(hit.mtime).toLocaleString() : '-'}>{hit.mtime ? new Date(hit.mtime).toLocaleString() : '-'}</TruncatedCell>
            </TableRow>)}</TableBody>
            </ResizableTable>
            <PreviewPagination
              offset={effectivePreviewOffset}
              pageSize={200}
              total={effectivePreviewTotal}
              hasMore={effectivePreviewHasMore}
              busy={effectivePreviewBusy}
              onPage={showingFilterPreview ? onFilterPreviewPage : onDirectoryPreviewPage}
            />
        </div>
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1"><div className="text-xs text-muted-foreground">输入助手筛选（留空 = 当前文件夹及后代的全部对象；可组合条件）</div><MagicParameterInput value={filter} onChange={onFilter} context="scope-filter" placeholder="例：kind:image OR kind:video AND size:>10MB" disabled={anyBusy} /></div>
          <Button className="min-h-10 w-full whitespace-nowrap sm:w-auto" onClick={onNextFromFilter} disabled={anyBusy || !canPick}><Check className="h-4 w-4 shrink-0" />下一步：设置整理规则</Button>
        </div>
        {blockReason ? <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"><HelpCircle className="h-3.5 w-3.5 shrink-0" />{blockReason}</div> : null}
      </div> : null}

      {step === 'rules' ? <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="max-w-[24rem] truncate" title={directory}>{directory}</Badge>{matchedLibraryName ? <Badge variant="outline">{matchedLibraryName}</Badge> : null}<Badge variant="outline">{filter.trim() ? `筛选：${filter}` : '筛选：全部对象'}</Badge><Button variant="ghost" size="sm" onClick={onEditFilter} disabled={anyBusy}><ArrowLeft className="h-3.5 w-3.5" />返回筛选</Button></div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <section className="space-y-3 rounded-md border p-3"><div><div className="flex items-center gap-2 text-sm font-medium"><Settings2 className="h-4 w-4 text-primary" />整理规则</div><div className="mt-1 text-xs text-muted-foreground">规则只属于本次整理，不读取或修改规则页面的规则集。先设置具体规则，再设置范围更大的规则。</div></div><OrganizeRulesEditor rules={ruleDraft} onChange={onRuleDraft} disabled={anyBusy} /></section>
          <section className="space-y-2 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-medium"><FileSearch className="h-4 w-4 text-primary" />筛选结果与修改预览</div><div className="flex items-center gap-2"><Select value={collision} disabled={anyBusy} onValueChange={(value) => onCollision(value as Collision)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => <SelectItem key={key} value={key}>{COLLISION_LABEL[key]}</SelectItem>)}</SelectContent></Select><Badge variant="outline">{preview ? `${hitRows.length} 项命中` : '等待加载'}</Badge>{tableBusy ? <Badge variant="outline">刷新中</Badge> : null}<Badge variant="outline">已启用 {enabledRuleCount} 条</Badge></div></div><div className="relative max-h-[32rem] overflow-auto rounded-md border">{tableBusy && preview ? <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/50 pt-16"><Loader2 className="h-5 w-5 animate-spin" aria-label="正在刷新筛选和修改预览" /></div> : null}<Table className="table-fixed" style={{ width: '100%', minWidth: 980, tableLayout: 'fixed' }}><colgroup><col style={{ width: '24%' }} /><col style={{ width: '24%' }} /><col style={{ width: '13%' }} /><col style={{ width: '39%' }} /></colgroup><TableHeader><TableRow><TableHead>修改前位置</TableHead><TableHead>修改后位置</TableHead><TableHead>操作</TableHead><TableHead>命中规则</TableHead></TableRow></TableHeader><TableBody>{tableBusy && !preview ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label="正在生成筛选和修改预览" /></TableCell></TableRow> : !preview ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">进入第三步后会自动加载筛选和修改前后预览</TableCell></TableRow> : hitRows.length === 0 ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">当前规则没有命中对象</TableCell></TableRow> : hitRows.slice(previewOffset, previewOffset + PREVIEW_PAGE_SIZE).map(({ entry, before, after, ops, hitRules }) => { const lastOp = ops[ops.length - 1]; const action = lastOp?.op; return <TableRow key={entry.id}><TruncatedCell title={before}><span className="flex min-w-0 items-center gap-2"><KindIcon kind={entry.isDir ? 'dir' : kindFromPath(before)} /><span className="min-w-0 truncate">{before}</span></span></TruncatedCell><TruncatedCell title={after}>{after}</TruncatedCell><TruncatedCell title={action ? PREVIEW_ACTION_LABEL[action] ?? action : '保持不变'}><Badge variant="outline" className={action ? previewActionClass(action) : ''}>{action ? PREVIEW_ACTION_LABEL[action] ?? action : '保持不变'}</Badge></TruncatedCell><TruncatedCell className="text-xs text-muted-foreground" title={hitRules}>{hitRules}</TruncatedCell></TableRow> })}</TableBody></Table></div><PreviewPagination offset={previewOffset} pageSize={PREVIEW_PAGE_SIZE} total={hitRows.length} hasMore={previewOffset + PREVIEW_PAGE_SIZE < hitRows.length} busy={tableBusy} onPage={(delta) => setPreviewOffset((current) => Math.max(0, current + delta * PREVIEW_PAGE_SIZE))} /><div className="text-xs text-muted-foreground">{preview ? `只显示命中规则的 ${hitRows.length} 项对象；冲突 ${preview.summary.conflicts} 项` : '修改规则后会生成命中对象的前后位置预览'}</div></section>
          <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>直接删除动作已禁用；普通清理使用“移入隔离区”。冲突策略会进入预览，覆盖项不会默认勾选。</span></div>
        </div>
        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-muted-foreground">当前规则将作用于第 2 步筛选后的快照；规则顺序就是处理优先级</span><Button className="w-full whitespace-nowrap sm:w-auto" onClick={onNextFromRules} disabled={anyBusy || tableBusy || !canRules}>{tableBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}生成预览并进入确认</Button></div>
      </div> : null}

      {step === 'result' ? <div className="flex min-h-0 flex-1 flex-col"><div className="flex flex-wrap items-center gap-2 border-b px-3 py-2"><Badge>{selectedCount} / {plan?.ops.length ?? 0} 项已选</Badge><Badge variant="outline">快照已固定，执行前可再次取消单项</Badge><Button onClick={onExecute} disabled={!plan || selectedCount === 0 || anyBusy}>{busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}执行选中</Button>{lastExecuteJobId ? <Button variant="outline" onClick={onRollback} disabled={anyBusy}>{busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}回滚</Button> : null}<Button variant="outline" onClick={onEditRules} disabled={anyBusy}><Settings2 className="h-3.5 w-3.5" />调整规则</Button><Button variant="ghost" size="sm" onClick={onBackToPick} disabled={anyBusy}><RotateCcw className="h-3.5 w-3.5" />重新选择文件夹</Button></div><div className="flex min-h-0 flex-1 flex-col"><PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} /></div></div> : null}
      {busyExecute && executeProgress ? <ExecutionProgressOverlay progress={executeProgress} /> : null}
    </div>
  )
}
