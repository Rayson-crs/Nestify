import { ArrowLeft, ArrowUp, FileSearch, FileText, FolderSearch, HelpCircle, History, Loader2, Play, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MagicParameterInput } from '@/components/rules/MagicParameterInput'
import { RenameGroupsEditor, type RenameRuleGroup } from '@/components/rules/RenameGroupsEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { kindFromPath, KindIcon } from '@/components/files/kind'
import { PlainResizableHead, ResizableTable, ResizableTableHead, SearchSortHeader, TruncatedCell, useColumnWidths } from '@/components/files/ResizableTable'
import type { ChangePlan, Collision, ExecutionProgress, SearchHit, SearchSortField } from '@/lib/ipc'
import { ExecutionProgressOverlay } from '@/components/workspace/ExecutionProgressOverlay'
import { kindLabel } from '@/lib/labels'
import { formatBytes, formatTime } from '@/lib/utils'
import { COLLISION_LABEL, type TriStateSortDirection } from '@/lib/workspace'
import { PreviewPagination } from './PreviewPagination'

type WizardStep = 'pick' | 'filter' | 'rules' | 'result'

const STEP_LABELS: Array<{ key: WizardStep; label: string }> = [
  { key: 'pick', label: '1 选择目录' },
  { key: 'filter', label: '2 配置搜索范围' },
  { key: 'rules', label: '3 设置改名规则' },
  { key: 'result', label: '4 预览执行' },
]

function fileName(path: string | null | undefined): string {
  if (!path) return '-'
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

export function RenamePane({
  step,
  directory,
  matchedLibraryName,
  analyzeBlockReason,
  filter,
  groups,
  ruleSelected,
  collision,
  preview,
  previewTotal,
  previewOffset,
  previewHasMore,
  previewLoading,
  previewSort,
  previewSortDirection,
  filterPreview,
  filterPreviewTotal,
  filterPreviewOffset,
  filterPreviewHasMore,
  filterPreviewLoading,
  canGoParent,
  busy,
  previewBusy,
  onDirectory,
  onPickDirectory,
  onFilter,
  onGroups,
  onToggleRule,
  onToggleAllRules,
  onCollision,
  onPreviewSort,
  onPreviewPage,
  onFilterPreviewPage,
  onEnterDirectory,
  onGoParent,
  onNextFromFilter,
  onNextFromRules,
  onBackToPick,
  onEditFilter,
  onEditRules,
  plan,
  selectedOps,
  onToggleOp,
  selectedCount,
  busyExecute, executeProgress,
  busyRollback,
  lastExecuteJobId,
  onExecute,
  onRollback,
}: {
  step: WizardStep
  directory: string
  matchedLibraryName: string | null
  analyzeBlockReason: string | null
  filter: string
  groups: RenameRuleGroup[]
  ruleSelected: Record<string, boolean>
  collision: Collision
  preview: SearchHit[] | null
  previewTotal: number
  previewOffset: number
  previewHasMore: boolean
  previewLoading: boolean
  previewSort: 'name' | 'size' | 'mtime'
  previewSortDirection: TriStateSortDirection
  filterPreview: SearchHit[] | null
  filterPreviewTotal: number
  filterPreviewOffset: number
  filterPreviewHasMore: boolean
  filterPreviewLoading: boolean
  canGoParent: boolean
  busy: boolean
  previewBusy: boolean
  onDirectory: (value: string) => void
  onPickDirectory: () => void
  onFilter: (value: string) => void
  onGroups: (groups: RenameRuleGroup[]) => void
  onToggleRule: (entryId: string, checked: boolean) => void
  onToggleAllRules: (checked: boolean) => void
  onCollision: (value: Collision) => void
  onPreviewSort: (field: 'name' | 'size' | 'mtime') => void
  onPreviewPage: (delta: -1 | 1) => void
  onFilterPreviewPage: (delta: -1 | 1) => void
  onEnterDirectory: (hit: SearchHit) => void
  onGoParent: () => void
  onNextFromFilter: () => void
  onNextFromRules: () => void
  onBackToPick: () => void
  onEditFilter: () => void
  onEditRules: () => void
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  onToggleOp: (index: number, checked: boolean) => void
  selectedCount: number
  busyExecute: boolean
  executeProgress: ExecutionProgress | null
  busyRollback: boolean
  lastExecuteJobId: string | null
  onExecute: () => void
  onRollback: () => void
}) {
  const anyBusy = busy || busyExecute || busyRollback
  const stepIndex = STEP_LABELS.findIndex((item) => item.key === step)
  const { widths, resize } = useColumnWidths([260, 88, 136])
  const ruleWidths = useColumnWidths([36, 220, 28, 220, 88])
  const resultWidths = useColumnWidths([36, 220, 28, 220, 88])
  const [planOffset, setPlanOffset] = useState(0)
  useEffect(() => setPlanOffset(0), [plan])
  const sortAsField: Record<'name' | 'size' | 'mtime', SearchSortField> = { name: 'name', size: 'size', mtime: 'mtime' }
  const changePreviewSort = (field: SearchSortField) => {
    if (field === 'name' || field === 'size' || field === 'mtime') onPreviewSort(field)
  }
  const showingFilterPreview = filter.trim().length > 0
  const effectivePreview = showingFilterPreview ? filterPreview : preview
  const effectivePreviewTotal = showingFilterPreview ? filterPreviewTotal : previewTotal
  const effectivePreviewHasMore = showingFilterPreview ? filterPreviewHasMore : previewHasMore
  const effectivePreviewOffset = showingFilterPreview ? filterPreviewOffset : previewOffset
  const effectivePreviewLoading = showingFilterPreview ? filterPreviewLoading : previewLoading
  const previewKinds = new Map(
    [...(preview ?? []), ...(filterPreview ?? [])].map((hit) => [hit.entryId, hit.kind]),
  )
  const operationKind = (entryId: string | undefined, path: string | null | undefined) => {
    const indexedKind = entryId ? previewKinds.get(entryId) : undefined
    const pathKind = kindFromPath(path)
    // The index can contain the generic `file` kind for a newly added extension.
    // Use the path classifier in that case so the preview still shows a useful icon.
    if (indexedKind && indexedKind !== 'file' && indexedKind !== 'unknown') return indexedKind
    if (pathKind !== 'file' && pathKind !== 'unknown') return pathKind
    return indexedKind ?? pathKind
  }
  const changedOps = plan?.ops.filter((op) => fileName(op.from) !== fileName(op.to)) ?? []
  const hasTemplate = groups.some((group) => group.template.trim())
  const trialName = fileName(plan?.ops.find((op) => op.entryId && ruleSelected[op.entryId] !== false)?.from)
    || effectivePreview?.[0]?.name
    || undefined
  const assistantPreviewName = trialName && trialName !== '-' ? trialName : undefined
  const selectedRuleIds = (plan?.ops ?? [])
    .map((op) => op.entryId)
    .filter((id): id is string => Boolean(id) && ruleSelected[id] !== false)
  const allRulesSelected = Boolean(plan?.ops.length) && selectedRuleIds.length === (plan?.ops.length ?? 0)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        {STEP_LABELS.map((item, index) => {
          const active = item.key === step
          const done = index < stepIndex
          return (
            <div key={item.key} className="flex items-center gap-1">
              {index > 0 ? <Separator className="mx-1 w-4" /> : null}
              <span
                className={
                  active
                    ? 'rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                    : done
                      ? 'rounded-md px-2 py-0.5 text-xs text-muted-foreground'
                      : 'rounded-md px-2 py-0.5 text-xs text-muted-foreground/60'
                }
              >
                {item.label}
              </span>
            </div>
          )
        })}
      </div>

      {step === 'pick' ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl space-y-4 text-center">
            <FolderSearch className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <div className="space-y-1">
              <div className="text-sm font-medium">选择要改名的目录</div>
              <div className="text-xs text-muted-foreground">
                目录需已加入资料库{matchedLibraryName ? `（当前匹配：${matchedLibraryName}）` : ''}；选定后会先配置搜索范围，再设置改名规则
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button className="mx-auto min-w-44" title="打开系统对话框选择目录" onClick={onPickDirectory}>
                <FolderSearch className="h-4 w-4" />选择文件夹
              </Button>
            </div>
            {analyzeBlockReason ? (
              <div className="flex items-center justify-center gap-1.5 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                {analyzeBlockReason}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {busyExecute && executeProgress ? <ExecutionProgressOverlay progress={executeProgress} /> : null}

      {step === 'filter' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="max-w-[24rem] truncate" title={directory}>
              {directory}
            </Badge>
            {matchedLibraryName ? <Badge variant="outline">{matchedLibraryName}</Badge> : null}
            <Button variant="ghost" size="sm" onClick={onBackToPick} disabled={anyBusy}>
              <ArrowLeft className="h-3.5 w-3.5" />
              重选目录
            </Button>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5">
                {canGoParent ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    title="返回上一级目录"
                    onClick={onGoParent}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                <FileSearch className="h-3.5 w-3.5" />
                <span className="truncate" title={directory}>
                  目录内容（双击文件夹进入；点击表头排序，拖动表头边缘调列宽）
                </span>
              </span>
              {effectivePreview ? (
                <span className="shrink-0">
                  {showingFilterPreview
                    ? effectivePreviewTotal === 0 ? '规则没有命中对象' : `规则命中 ${effectivePreviewOffset + 1}-${Math.min(effectivePreviewTotal, effectivePreviewOffset + 200)} / 共 ${effectivePreviewTotal} 项`
                    : effectivePreview.length >= effectivePreviewTotal
                      ? `${effectivePreviewTotal} 项`
                      : `前 ${effectivePreview.length} / 共 ${effectivePreviewTotal} 项`}
                </span>
              ) : (
                <span>加载中…</span>
              )}
            </div>
            <ResizableTable widths={widths}>
              <TableHeader>
                <TableRow>
                  <SearchSortHeader
                    label="名称"
                    field={sortAsField.name}
                    sort={sortAsField[previewSort]!}
                    direction={previewSortDirection}
                    disabled={busy}
                    onSort={changePreviewSort}
                    width={widths[0]!}
                    onResize={resize(0, 160, 560)}
                  />
                  <SearchSortHeader
                    label="大小"
                    field={sortAsField.size}
                    sort={sortAsField[previewSort]!}
                    direction={previewSortDirection}
                    disabled={busy}
                    onSort={changePreviewSort}
                    width={widths[1]!}
                    onResize={resize(1, 72, 160)}
                  />
                  <SearchSortHeader
                    label="修改时间"
                    field={sortAsField.mtime}
                    sort={sortAsField[previewSort]!}
                    direction={previewSortDirection}
                    disabled={busy}
                    onSort={changePreviewSort}
                    width={widths[2]!}
                    onResize={resize(2, 112, 220)}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {effectivePreview === null || effectivePreview.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                      {effectivePreviewLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label="加载中" /> : showingFilterPreview
                        ? '当前规则没有命中任何文件或目录（改名将只针对命中项执行）'
                        : '目录为空或尚未扫描，可先对资料库执行一次扫描'}
                    </TableCell>
                  </TableRow>
                ) : (
                  effectivePreview.map((hit) => (
                    <TableRow
                      key={hit.entryId}
                      className={hit.kind === 'dir' ? 'cursor-pointer' : undefined}
                      title={hit.kind === 'dir' ? `双击进入 ${hit.name}` : hit.path}
                      onDoubleClick={() => {
                        if (hit.kind === 'dir') onEnterDirectory(hit)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && hit.kind === 'dir') onEnterDirectory(hit)
                      }}
                      tabIndex={hit.kind === 'dir' ? 0 : -1}
                    >
                      <TruncatedCell className="font-medium" width={widths[0]!} title={hit.name}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0" title={kindLabel(hit.kind)} aria-label={kindLabel(hit.kind)}>
                            <KindIcon kind={hit.kind} />
                          </span>
                          <span className="min-w-0 truncate">{hit.name}</span>
                        </span>
                      </TruncatedCell>
                      <TruncatedCell width={widths[1]!} title={hit.kind === 'dir' ? '-' : formatBytes(hit.size)}>
                        {hit.kind === 'dir' ? '-' : formatBytes(hit.size)}
                      </TruncatedCell>
                      <TruncatedCell width={widths[2]!} title={formatTime(hit.mtime)}>
                        {formatTime(hit.mtime)}
                      </TruncatedCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </ResizableTable>
            <PreviewPagination
              offset={effectivePreviewOffset}
              pageSize={200}
              total={effectivePreviewTotal}
              hasMore={effectivePreviewHasMore}
              busy={effectivePreviewLoading}
              onPage={showingFilterPreview ? onFilterPreviewPage : onPreviewPage}
            />
          </div>

          <div className="grid grid-cols-[1fr_10rem] items-start gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                搜索范围规则（留空 = 目录内全部文件；改目录用 kind:dir，可组合条件如 kind:dir AND dir_count:&gt;=1）
              </div>
              <MagicParameterInput
                value={filter}
                onChange={onFilter}
                context="scope-filter"
                placeholder="例：kind:dir 或 kind:video AND size:>10MB（留空只改文件）"
                disabled={anyBusy}
              />
            </div>
            <div className="flex h-full items-end">
              <Button className="w-full" onClick={onNextFromFilter} disabled={anyBusy || analyzeBlockReason !== null}>
                <FileText className="h-4 w-4" />
                下一步：改名规则
              </Button>
            </div>
          </div>
          {analyzeBlockReason ? (
            <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              {analyzeBlockReason}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 'rules' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="max-w-[24rem] truncate" title={directory}>
              {directory}
            </Badge>
            {matchedLibraryName ? <Badge variant="outline">{matchedLibraryName}</Badge> : null}
            {filter.trim() ? <Badge variant="outline">范围：{filter}</Badge> : <Badge variant="outline">范围：全部文件（不含目录）</Badge>}
            <Button variant="ghost" size="sm" onClick={onEditFilter} disabled={anyBusy}>
              <ArrowLeft className="h-3.5 w-3.5" />
              返回搜索范围
            </Button>
          </div>

          <div className="grid gap-2 xl:grid-cols-[minmax(0,1.6fr)_10rem]">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">改名规则组（组之间为 OR；同一项命中多组时按顺序优先）</div>
              <RenameGroupsEditor groups={groups} onChange={onGroups} disabled={anyBusy} previewName={assistantPreviewName} />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">冲突处理</div>
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
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
              <span>改名预览（红色是修改前，绿色是修改后；默认全选，取消勾选的不会进入执行）</span>
              <span>
                {previewBusy
                  ? '正在生成预览…'
                  : plan
                    ? `已选 ${selectedRuleIds.length} / ${plan.ops.length} 项，其中 ${changedOps.length} 项将改名`
                    : '等待模板'}
              </span>
            </div>
            <ResizableTable widths={ruleWidths.widths}>
              <TableHeader>
                <TableRow>
                  <ResizableTableHead width={ruleWidths.widths[0]!} onResize={ruleWidths.resize(0, 32, 48)} aria-sort="none">
                    <Checkbox
                      checked={allRulesSelected}
                      disabled={anyBusy || !plan || plan.ops.length === 0}
                      onCheckedChange={(checked) => onToggleAllRules(checked)}
                      aria-label="全选改名项"
                    />
                  </ResizableTableHead>
                  <PlainResizableHead label="修改前" width={ruleWidths.widths[1]!} onResize={ruleWidths.resize(1, 160, 480)} />
                  <PlainResizableHead label="" width={ruleWidths.widths[2]!} onResize={ruleWidths.resize(2, 24, 40)} />
                  <PlainResizableHead label="修改后" width={ruleWidths.widths[3]!} onResize={ruleWidths.resize(3, 160, 480)} />
                  <PlainResizableHead label="风险" width={ruleWidths.widths[4]!} onResize={ruleWidths.resize(4, 72, 160)} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewBusy || !plan || plan.ops.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      {previewBusy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label="正在生成预览" /> : '当前范围和规则组没有产生改名结果'}
                    </TableCell>
                  </TableRow>
                ) : (
                  plan.ops.slice(planOffset, planOffset + 200).map((op, pageIndex) => {
                    const index = planOffset + pageIndex
                    const fromName = fileName(op.from)
                    const toName = fileName(op.to)
                    const fromKind = operationKind(op.entryId, op.from)
                    const toKind = operationKind(op.entryId, op.to ?? op.from)
                    const changed = fromName !== toName
                    const checked = op.entryId ? ruleSelected[op.entryId] !== false : true
                    return (
                      <TableRow key={`${op.entryId ?? op.from}-${index}`}>
                        <TruncatedCell width={ruleWidths.widths[0]!} title={checked ? '执行此项' : '跳过此项'}>
                          <Checkbox
                            checked={checked}
                            disabled={anyBusy || !op.entryId}
                            onCheckedChange={(value) => {
                              if (op.entryId) onToggleRule(op.entryId, value)
                            }}
                          />
                        </TruncatedCell>
                        <TruncatedCell
                          className={changed ? 'font-medium text-red-600' : 'text-muted-foreground'}
                          width={ruleWidths.widths[1]!}
                          title={op.from}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <KindIcon kind={fromKind} />
                            <span className="min-w-0 truncate">{fromName}</span>
                          </span>
                        </TruncatedCell>
                        <TruncatedCell width={ruleWidths.widths[2]!} title="">
                          →
                        </TruncatedCell>
                        <TruncatedCell
                          className={changed ? 'font-medium text-emerald-600' : 'text-muted-foreground'}
                          width={ruleWidths.widths[3]!}
                          title={op.to ?? ''}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <KindIcon kind={toKind} />
                            <span className="min-w-0 truncate">{toName}</span>
                          </span>
                        </TruncatedCell>
                        <TruncatedCell width={ruleWidths.widths[4]!} title={op.reason}>
                          {op.risk === 'none' ? '-' : op.risk}
                        </TruncatedCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </ResizableTable>
            <PreviewPagination
              offset={planOffset}
              pageSize={200}
              total={plan?.ops.length ?? 0}
              hasMore={planOffset + 200 < (plan?.ops.length ?? 0)}
              busy={previewBusy}
              onPage={(delta) => setPlanOffset((current) => Math.max(0, current + delta * 200))}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onEditFilter} disabled={anyBusy}>
              返回上一步
            </Button>
            <Button onClick={onNextFromRules} disabled={anyBusy || (Boolean(plan) && selectedRuleIds.length === 0) || !hasTemplate}>
              {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              下一步：选择执行项
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'result' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <Badge>{selectedCount} 项将改名</Badge>
            {plan ? <Badge variant="outline">共 {plan.ops.length} 项预览</Badge> : null}
            <Button onClick={onExecute} disabled={anyBusy || selectedCount === 0}>
              {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              执行选中{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
            {lastExecuteJobId ? (
              <Button variant="outline" onClick={onRollback} disabled={anyBusy}>
                {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                回滚
              </Button>
            ) : null}
            <Button variant="outline" onClick={onEditRules} disabled={anyBusy} title="回到第 3 步调整改名模板">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              调整规则
            </Button>
            <Button variant="ghost" size="sm" onClick={onBackToPick} disabled={anyBusy}>
              <RotateCcw className="h-3.5 w-3.5" />
              重新开始
            </Button>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ResizableTable widths={resultWidths.widths}>
              <TableHeader>
                <TableRow>
                  <PlainResizableHead label="" width={resultWidths.widths[0]!} onResize={resultWidths.resize(0, 32, 48)} />
                  <PlainResizableHead label="修改前" width={resultWidths.widths[1]!} onResize={resultWidths.resize(1, 160, 480)} />
                  <PlainResizableHead label="" width={resultWidths.widths[2]!} onResize={resultWidths.resize(2, 24, 40)} />
                  <PlainResizableHead label="修改后" width={resultWidths.widths[3]!} onResize={resultWidths.resize(3, 160, 480)} />
                  <PlainResizableHead label="风险" width={resultWidths.widths[4]!} onResize={resultWidths.resize(4, 72, 160)} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!plan || plan.ops.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      没有可执行的改名项
                    </TableCell>
                  </TableRow>
                ) : (
                  plan.ops.slice(planOffset, planOffset + 200).map((op, pageIndex) => {
                    const index = planOffset + pageIndex
                    const fromName = fileName(op.from)
                    const toName = fileName(op.to)
                    const fromKind = operationKind(op.entryId, op.from)
                    const toKind = operationKind(op.entryId, op.to ?? op.from)
                    const changed = fromName !== toName
                    const checked = Boolean(selectedOps[index])
                    return (
                      <TableRow key={`${op.from}-${index}`}>
                        <TruncatedCell width={resultWidths.widths[0]!} title={checked ? '执行此项' : '跳过此项'}>
                          <Checkbox
                            checked={checked}
                            disabled={anyBusy || op.risk === 'overwrite'}
                            onCheckedChange={(value) => onToggleOp(index, Boolean(value))}
                          />
                        </TruncatedCell>
                        <TruncatedCell
                          className={changed ? 'font-medium text-red-600' : 'text-muted-foreground'}
                          width={resultWidths.widths[1]!}
                          title={op.from}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <KindIcon kind={fromKind} />
                            <span className="min-w-0 truncate">{fromName}</span>
                          </span>
                        </TruncatedCell>
                        <TruncatedCell width={resultWidths.widths[2]!} title="">
                          →
                        </TruncatedCell>
                        <TruncatedCell
                          className={changed ? 'font-medium text-emerald-600' : 'text-muted-foreground'}
                          width={resultWidths.widths[3]!}
                          title={op.to ?? ''}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <KindIcon kind={toKind} />
                            <span className="min-w-0 truncate">{toName}</span>
                          </span>
                        </TruncatedCell>
                        <TruncatedCell width={resultWidths.widths[4]!} title={op.reason}>
                          {op.risk === 'none' ? '-' : op.risk}
                        </TruncatedCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
              </ResizableTable>
            <PreviewPagination
              offset={planOffset}
              pageSize={200}
              total={plan.ops.length}
              hasMore={planOffset + 200 < plan.ops.length}
              onPage={(delta) => setPlanOffset((current) => Math.max(0, current + delta * 200))}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
