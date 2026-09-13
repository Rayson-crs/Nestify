import { ArrowLeft, ArrowUp, Copy, FileSearch, FolderSearch, HelpCircle, History, Layers, Loader2, Play, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { KindIcon } from '@/components/files/kind'
import { PlainResizableHead, ResizableTable, SearchSortHeader, TruncatedCell, useColumnWidths } from '@/components/files/ResizableTable'
import { MagicParameterInput } from '@/components/rules/MagicParameterInput'
import type { ChangePlan, DuplicateGroup, DuplicateHashStrategy, DuplicateHit, DuplicateProgress, ExecutionProgress, KeepStrategy, SearchHit, SearchSortField } from '@/lib/ipc'
import { ExecutionProgressOverlay } from '@/components/workspace/ExecutionProgressOverlay'
import { PreviewPagination } from '@/components/workspace/PreviewPagination'
import { kindLabel } from '@/lib/labels'
import { formatBytes, formatTime } from '@/lib/utils'
import { DUPLICATE_HASH_LABEL, KEEP_HINT, KEEP_LABEL, type TriStateSortDirection } from '@/lib/workspace'
import { ENTRY_KINDS } from '@nestify/shared'

type WizardStep = 'pick' | 'filter' | 'analyzing' | 'result'
type ResultKindFilter = 'all' | (typeof ENTRY_KINDS)[number]

const RESULT_KIND_OPTIONS: Array<{ value: ResultKindFilter; label: string }> = [
  { value: 'all', label: '全部类型' },
  ...ENTRY_KINDS.filter((kind) => kind !== 'dir').map((kind) => ({
    value: kind,
    label: kindLabel(kind),
  })),
]

function matchesResultKind(kind: string, filter: ResultKindFilter): boolean {
  if (filter === 'all') return true
  return kind === filter
}

const STEP_LABELS: Array<{ key: WizardStep; label: string }> = [
  { key: 'pick', label: '1 选择目录' },
  { key: 'filter', label: '2 配置规则' },
  { key: 'analyzing', label: '3 扫描重复' },
  { key: 'result', label: '4 查看结果' },
]

export function DuplicatePane({
  step,
  directory,
  matchedLibraryName,
  analyzeBlockReason,
  filter,
  hashStrategy,
  preview,
  previewTotal,
  previewOffset,
  previewHasMore,
  previewBusy,
  previewSort,
  previewSortDirection,
  filterPreview,
  filterPreviewTotal,
  filterPreviewOffset,
  filterPreviewHasMore,
  filterPreviewBusy,
  analysisProgress,
  groups,
  activeGroupId,
  groupsPaneWidth,
  keepStrategy,
  busy,
  onDirectory,
  onPickDirectory,
  onFilter,
  onHashStrategy,
  onPreviewSort,
  onPreviewPage,
  onFilterPreviewPage,
  onEnterDirectory,
  onGoParent,
  canGoParent,
  onAnalyze,
  onBackToPick,
  onEditFilter,
  plan,
  selectedOps,
  onToggleOp,
  onToggleKeep,
  onResetGroup,
  onSelectGroup,
  onGroupsPaneResize,
  selectedCount,
  onKeepStrategy,
  busyExecute,
  executeProgress,
  lastExecuteJobId,
  onExecute,
  onRollback,
}: {
  step: WizardStep
  directory: string
  matchedLibraryName: string | null
  analyzeBlockReason: string | null
  filter: string
  hashStrategy: DuplicateHashStrategy
  preview: SearchHit[] | null
  previewTotal: number
  previewOffset: number
  previewHasMore: boolean
  previewBusy: boolean
  previewSort: 'name' | 'size' | 'mtime'
  previewSortDirection: TriStateSortDirection
  /** 规则即时预览命中（null = 规则为空，展示全量预览）。 */
  filterPreview: SearchHit[] | null
  filterPreviewTotal: number
  filterPreviewOffset: number
  filterPreviewHasMore: boolean
  filterPreviewBusy: boolean
  analysisProgress: DuplicateProgress | null
  groups: DuplicateGroup[]
  activeGroupId: string | null
  groupsPaneWidth: number
  keepStrategy: KeepStrategy
  busy: boolean
  onDirectory: (value: string) => void
  onPickDirectory: () => void
  onFilter: (value: string) => void
  onHashStrategy: (value: DuplicateHashStrategy) => void
  onPreviewSort: (field: 'name' | 'size' | 'mtime') => void
  onPreviewPage: (delta: -1 | 1) => void
  onFilterPreviewPage: (delta: -1 | 1) => void
  onEnterDirectory: (hit: SearchHit) => void
  onGoParent: () => void
  canGoParent: boolean
  onAnalyze: () => void
  onBackToPick: () => void
  /** 结果页"调整规则"：直接回到第 2 步（目录与规则保留）。 */
  onEditFilter: () => void
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  onToggleOp: (index: number, checked: boolean) => void
  /** 组内切换某文件 保留↔删除。 */
  onToggleKeep: (groupId: string, entryId: string) => void
  /** 整组按保留策略重置。 */
  onResetGroup: (groupId: string) => void
  onSelectGroup: (groupId: string | null) => void
  onGroupsPaneResize: (width: number) => void
  selectedCount: number
  onKeepStrategy: (value: KeepStrategy) => void
  busyExecute: boolean
  executeProgress: ExecutionProgress | null
  lastExecuteJobId: string | null
  onExecute: () => void
  onRollback: () => void
}) {
  const wasted = groups.reduce((sum, group) => sum + group.wastedBytes, 0)
  const anyBusy = busy || busyExecute
  const stepIndex = STEP_LABELS.findIndex((item) => item.key === step)
  const [resultKindFilter, setResultKindFilter] = useState<ResultKindFilter>('all')
  const { widths: previewWidths, resize: resizePreview } = useColumnWidths([260, 88, 136])
  const { widths: resultWidths, resize: resizeResult } = useColumnWidths([270, 330, 150, 116, 100])
  const sortAsField: Record<'name' | 'size' | 'mtime', SearchSortField> = { name: 'name', size: 'size', mtime: 'mtime' }
  const changePreviewSort = (field: SearchSortField) => {
    if (field === 'name' || field === 'size' || field === 'mtime') onPreviewSort(field)
  }
  /** 第 2 步展示的预览：规则非空且即时预览可用时显示过滤结果，否则显示目录全量。 */
  const showingFilterPreview = filter.trim().length > 0
  const effectivePreview = showingFilterPreview ? filterPreview : preview
  const effectivePreviewTotal = showingFilterPreview ? filterPreviewTotal : previewTotal
  const effectivePreviewOffset = showingFilterPreview ? filterPreviewOffset : previewOffset
  const effectivePreviewHasMore = showingFilterPreview ? filterPreviewHasMore : previewHasMore
  const effectivePreviewBusy = showingFilterPreview ? filterPreviewBusy : previewBusy
  /** 当前选中分组（null = 全部）。 */
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null
  const visibleGroups = useMemo(
    () => (resultKindFilter === 'all' ? groups : groups.filter((group) => group.files.some((file) => matchesResultKind(file.kind, resultKindFilter)))),
    [groups, resultKindFilter],
  )
  const [resultOffset, setResultOffset] = useState(0)
  /** 结果总数不创建扁平数组；只为当前页生成最多 200 个文件，避免大结果集重复分配内存。 */
  const resultFileTotal = activeGroup
    ? (visibleGroups.some((group) => group.id === activeGroup.id) ? activeGroup.files.length : 0)
    : visibleGroups.reduce((sum, group) => sum + group.files.length, 0)
  const visibleResultFiles = useMemo(() => {
    if (activeGroup) {
      if (!visibleGroups.some((group) => group.id === activeGroup.id)) return []
      return activeGroup.files.slice(resultOffset, resultOffset + 200).map((file) => ({ ...file, groupId: activeGroup.id }))
    }
    const page: Array<DuplicateHit & { groupId: string }> = []
    let skipped = resultOffset
    for (const group of visibleGroups) {
      if (page.length >= 200) break
      if (skipped >= group.files.length) {
        skipped -= group.files.length
        continue
      }
      const take = Math.min(200 - page.length, group.files.length - skipped)
      page.push(...group.files.slice(skipped, skipped + take).map((file) => ({ ...file, groupId: group.id })))
      skipped = 0
    }
    return page
  }, [activeGroup, resultOffset, visibleGroups])
  const visibleItemCount = visibleGroups.reduce((sum, group) => sum + group.files.length, 0)
  const visibleSelectedCount = visibleGroups.reduce((sum, group) => sum + group.files.filter((file) => !file.keep).length, 0)
  const visibleWastedBytes = visibleGroups.reduce(
    (sum, group) => sum + group.files.filter((file) => !file.keep).reduce((groupSum, file) => groupSum + file.size, 0),
    0,
  )
  useEffect(() => setResultOffset(0), [activeGroupId, resultKindFilter, groups])
  /** 左列表拖宽。 */
  const startGroupsPaneResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = groupsPaneWidth
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(480, Math.max(180, startWidth + moveEvent.clientX - startX))
      onGroupsPaneResize(next)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 步骤条 */}
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

      {/* 第 1 步：选目录 */}
      {step === 'pick' ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl space-y-4 text-center">
            <FolderSearch className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <div className="space-y-1">
              <div className="text-sm font-medium">选择要查重的目录</div>
              <div className="text-xs text-muted-foreground">
                目录需已加入资料库{matchedLibraryName ? `（当前匹配：${matchedLibraryName}）` : ''}；选定后会先展示目录内容，再配置查重规则
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

      {/* 第 2 步：配置规则（看文件 + 输入助手规则 + 哈希 + 开始） */}
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

          {/* 目录内容预览（复用文件表格：排序/列宽/目录点击进入） */}
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
                      : `前 ${effectivePreviewOffset + 1}-${Math.min(effectivePreviewTotal, effectivePreviewOffset + 200)} / 共 ${effectivePreviewTotal} 项`}
                </span>
              ) : (
                <span>加载中…</span>
              )}
            </div>
            <ResizableTable widths={previewWidths}>
              <TableHeader>
                <TableRow>
                  <SearchSortHeader
                    label="名称"
                    field={sortAsField.name}
                    sort={sortAsField[previewSort]!}
                    direction={previewSortDirection}
                    disabled={busy}
                    onSort={changePreviewSort}
                    width={previewWidths[0]!}
                    onResize={resizePreview(0, 160, 560)}
                  />
                  <SearchSortHeader
                    label="大小"
                    field={sortAsField.size}
                    sort={sortAsField[previewSort]!}
                    direction={previewSortDirection}
                    disabled={busy}
                    onSort={changePreviewSort}
                    width={previewWidths[1]!}
                    onResize={resizePreview(1, 72, 160)}
                  />
                  <SearchSortHeader
                    label="修改时间"
                    field={sortAsField.mtime}
                    sort={sortAsField[previewSort]!}
                    direction={previewSortDirection}
                    disabled={busy}
                    onSort={changePreviewSort}
                    width={previewWidths[2]!}
                    onResize={resizePreview(2, 112, 220)}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {effectivePreview === null || effectivePreview.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                      {effectivePreviewBusy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label="加载中" /> : showingFilterPreview
                        ? '当前规则没有命中任何文件（查重将只针对命中的文件执行）'
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
                      <TruncatedCell className="font-medium" width={previewWidths[0]!} title={hit.name}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0" title={kindLabel(hit.kind)} aria-label={kindLabel(hit.kind)}>
                            <KindIcon kind={hit.kind} />
                          </span>
                          <span className="min-w-0 truncate">{hit.name}</span>
                        </span>
                      </TruncatedCell>
                      <TruncatedCell width={previewWidths[1]!} title={hit.kind === 'dir' ? '-' : formatBytes(hit.size)}>
                        {hit.kind === 'dir' ? '-' : formatBytes(hit.size)}
                      </TruncatedCell>
                      <TruncatedCell width={previewWidths[2]!} title={formatTime(hit.mtime)}>
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
              busy={effectivePreviewBusy}
              onPage={showingFilterPreview ? onFilterPreviewPage : onPreviewPage}
            />
          </div>

          {/* 规则配置 */}
          <div className="grid grid-cols-[1fr_10rem_10rem] items-start gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                查重范围规则（留空 = 全部文件参与；可组合条件，如 kind:image AND size:&gt;10MB）
              </div>
              <MagicParameterInput
                value={filter}
                onChange={onFilter}
                context="scope-filter"
                placeholder="例：kind:image AND size:>10MB（留空查全部）"
                disabled={anyBusy}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">哈希强度</div>
              <Select value={hashStrategy} disabled={anyBusy} onValueChange={(value) => onHashStrategy(value as DuplicateHashStrategy)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DUPLICATE_HASH_LABEL) as DuplicateHashStrategy[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {DUPLICATE_HASH_LABEL[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex h-full items-end">
              <Button className="w-full" onClick={onAnalyze} disabled={anyBusy || analyzeBlockReason !== null}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                {busy ? '正在扫描…' : '开始扫描重复'}
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

      {/* 第 3 步：分析中（不确定进度条，展示规则与目录摘要） */}
      {step === 'analyzing' ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-lg space-y-4">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <div className="text-center text-sm font-medium">正在扫描重复文件…</div>
            <div className="text-center text-xs text-muted-foreground">
              对「{directory}」{filter ? `按规则「${filter}」` : '（全部文件）'}做哈希比对，大目录可能需要一点时间
            </div>
            <div className="space-y-2 rounded-md border bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium">
                  {analysisProgress?.phase === 'collecting'
                    ? '读取候选文件'
                    : analysisProgress?.phase === 'quick-hash'
                      ? '快速比对文件'
                      : analysisProgress?.phase === 'full-hash'
                        ? '完整校验文件'
                        : '整理重复结果'}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {Math.round(analysisProgress?.percent ?? 0)}%
                </span>
              </div>
              <Progress value={analysisProgress?.percent ?? 0} />
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  当前 {analysisProgress?.phaseCurrent ?? 0} / {analysisProgress?.phaseTotal ?? 0}
                </span>
                <span>{analysisProgress ? '实时更新' : '正在准备扫描…'}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground" title={analysisProgress?.path ?? undefined}>
                {analysisProgress?.path ?? '正在准备文件列表…'}
              </div>
            </div>
            <div className="text-center text-xs text-muted-foreground/70">完成后自动进入下一步</div>
          </div>
        </div>
      ) : null}

      {/* 第 4 步：结果（左：重复分组列表，可拖宽；右：选中组的文件，勾选保留/删除） */}
      {step === 'result' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="w-36">
              <Select
                value={resultKindFilter}
                disabled={anyBusy}
                onValueChange={(value) => {
                  setResultKindFilter(value as ResultKindFilter)
                  onSelectGroup(null)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="全部类型" />
                </SelectTrigger>
                <SelectContent>
                  {RESULT_KIND_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge>{visibleGroups.length} 组重复</Badge>
            <Badge variant="outline">将隔离 {selectedCount} 份，可释放 {formatBytes(wasted)}</Badge>
            <Button onClick={onExecute} disabled={selectedCount === 0 || anyBusy}>
              {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              执行选中
            </Button>
            {lastExecuteJobId ? (
              <Button variant="outline" onClick={onRollback} disabled={anyBusy}>
                <History className="h-4 w-4" />回滚
              </Button>
            ) : null}
            <div className="w-48" title={`每组重复里保留哪一个：${KEEP_HINT[keepStrategy]}`}>
              <div className="mb-1 text-[10px] text-muted-foreground">智能选择</div>
              <Select
                value={keepStrategy}
                disabled={anyBusy}
                onValueChange={(value) => {
                  if (value === '__reset__') {
                    // 重新应用当前策略，统一重置所有分组，避免逐组更新被 React 批量合并后只生效最后一组。
                    onKeepStrategy(keepStrategy)
                    return
                  }
                  onKeepStrategy(value as KeepStrategy)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KEEP_LABEL) as KeepStrategy[]).map((key) => (
                    <SelectItem key={key} value={key} title={KEEP_HINT[key]}>
                      {KEEP_LABEL[key]}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value="__reset__">重置</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={onEditFilter} disabled={anyBusy} title="回到第 2 步调整规则、哈希或目录（结果会保留）">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              调整规则
            </Button>
            <Button variant="ghost" size="sm" onClick={onBackToPick} disabled={anyBusy} title="回到第 1 步重新开始">
              <RotateCcw className="h-3.5 w-3.5" />
              重新查重
            </Button>
          </div>
          <div className="relative flex min-h-0 flex-1">
            {/* 左：重复分组列表（顶部"全部" + 每组一块） */}
            <div style={{ width: groupsPaneWidth }} className="flex min-h-0 shrink-0 flex-col border-r">
              <div className="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">重复分组</div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="p-1.5">
                  <button
                    type="button"
                    className={
                      activeGroupId === null
                        ? 'mb-1 flex w-full items-center justify-between rounded bg-primary/10 px-2 py-1.5 text-left text-xs font-medium text-primary'
                        : 'mb-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60'
                    }
                    onClick={() => onSelectGroup(null)}
                  >
                    <span className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />
                      全部
                    </span>
                      <span className="text-muted-foreground">{visibleGroups.reduce((sum, group) => sum + group.files.length, 0)} 份</span>
                  </button>
                  {visibleGroups.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">没有发现重复文件 🎉</div>
                  ) : (
                    <div className="space-y-1">
                      {visibleGroups.map((group, index) => {
                        const selected = group.id === activeGroupId
                        const selectedFileCount = group.files.filter((file) => !file.keep).length
                        return (
                          <button
                            key={group.id}
                            type="button"
                            className={
                              selected
                                ? 'block w-full rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-left'
                                : 'block w-full rounded border border-transparent px-2 py-1.5 text-left hover:bg-muted/60'
                            }
                            onClick={() => onSelectGroup(group.id)}
                            title={`第 ${index + 1} 组：${group.files[0]?.name ?? ''}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                {index + 1}. {group.files[0]?.name ?? group.hash.slice(0, 12)}
                              </span>
                              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{selectedFileCount} / {group.files.length}</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span>{formatBytes(group.size)}</span>
                              <span>·</span>
                              <span>{group.files[0]?.name ?? '重复文件'}</span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
            {/* 拖宽把手 */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整分组列表宽度"
              className="absolute left-[var(--pane-width)] top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize select-none hover:bg-primary/20"
              style={{ ['--pane-width' as string]: `${groupsPaneWidth}px` }}
              onPointerDown={startGroupsPaneResize}
            />
            {/* 右：文件操作表格 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                  {activeGroup
                    ? `${activeGroup.files[0]?.name ?? ''}（${activeGroup.files.length} 份完全相同）`
                    : `全部重复文件（跨 ${groups.length} 组）`}
                </span>
                {activeGroup && visibleGroups.some((group) => group.id === activeGroup.id) ? (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" disabled={anyBusy} onClick={() => onResetGroup(activeGroup.id)}>
                    <RotateCcw className="mr-1 h-3 w-3" />
                    按策略重置本组
                  </Button>
                ) : null}
              </div>
              <ResizableTable widths={resultWidths}>
                <TableHeader>
                  <TableRow>
                    <PlainResizableHead label="文件" width={resultWidths[0]!} onResize={resizeResult(0, 220, 560)} />
                    <PlainResizableHead label="路径" width={resultWidths[1]!} onResize={resizeResult(1, 240, 720)} />
                    <PlainResizableHead label="修改时间" width={resultWidths[2]!} onResize={resizeResult(2, 112, 220)} />
                    <PlainResizableHead label="大小" width={resultWidths[3]!} onResize={resizeResult(3, 72, 160)} />
                    <PlainResizableHead label="状态" width={resultWidths[4]!} onResize={resizeResult(4, 72, 140)} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultFileTotal === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                        没有重复文件
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleResultFiles.map((file) => {
                      const disabled = anyBusy
                      return (
                        <TableRow
                          key={file.entryId}
                          className="cursor-pointer"
                          data-state={file.keep ? undefined : 'deleting'}
                          onClick={() => !disabled && onToggleKeep(file.groupId, file.entryId)}
                          title={`${file.path}\n点击切换：${file.keep ? '保留 → 删除' : '删除 → 保留'}（每组至少保留一份）`}
                        >
                          <TruncatedCell className={file.keep ? 'font-medium' : 'font-medium text-muted-foreground line-through'} width={resultWidths[0]!} title={file.path}>
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0" title={file.keep ? '保留' : '删除'}>
                                {file.keep ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                              </span>
                              <span className="shrink-0" title={kindLabel(file.kind)} aria-label={kindLabel(file.kind)}>
                                <KindIcon kind={file.kind} />
                              </span>
                              <span className="min-w-0 truncate">{file.name ?? file.path.split(/[\\/]/).pop()}</span>
                              {activeGroup ? null : (
                                <Badge variant="outline" className="ml-1 shrink-0 text-[10px] font-normal">
                                  组 {groups.findIndex((group) => group.id === file.groupId) + 1}
                                </Badge>
                              )}
                            </span>
                          </TruncatedCell>
                          <TruncatedCell width={resultWidths[1]!} title={file.path} className={file.keep ? 'text-muted-foreground' : 'text-muted-foreground line-through'}>
                            {file.path}
                          </TruncatedCell>
                          <TruncatedCell width={resultWidths[2]!} title={formatTime(file.mtime)} className={file.keep ? undefined : 'text-muted-foreground line-through'}>
                            {formatTime(file.mtime)}
                          </TruncatedCell>
                          <TruncatedCell width={resultWidths[3]!} title={formatBytes(file.size)} className={file.keep ? undefined : 'text-muted-foreground line-through'}>
                            {formatBytes(file.size)}
                          </TruncatedCell>
                          <TruncatedCell width={resultWidths[4]!} className={file.keep ? 'text-emerald-600' : 'text-destructive'}>
                            {file.keep ? '保留' : '待处理'}
                          </TruncatedCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </ResizableTable>
              <PreviewPagination
                offset={resultOffset}
                pageSize={200}
                total={resultFileTotal}
                hasMore={resultOffset + 200 < resultFileTotal}
                busy={anyBusy}
                onPage={(delta) => setResultOffset((current) => Math.max(0, current + delta * 200))}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
            <span>潜在重复文件：共 {visibleGroups.length} 组，{visibleItemCount} 项，{formatBytes(visibleWastedBytes)}</span>
            <span className="text-foreground">已选择：{visibleSelectedCount} 项，{formatBytes(visibleWastedBytes)}</span>
          </div>
        </div>
      ) : null}
      {busyExecute && executeProgress ? <ExecutionProgressOverlay progress={executeProgress} /> : null}
    </div>
  )
}
