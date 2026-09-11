import { ArrowLeft, ArrowUp, Copy, FileSearch, FolderSearch, HelpCircle, Layers, Loader2, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { KindIcon } from '@/components/files/kind'
import { PlainResizableHead, ResizableTable, SearchSortHeader, TruncatedCell, useColumnWidths } from '@/components/files/ResizableTable'
import { MagicParameterInput } from '@/components/rules/MagicParameterInput'
import type { ChangePlan, DuplicateGroup, DuplicateHashStrategy, DuplicateHit, KeepStrategy, SearchHit, SearchSortField } from '@/lib/ipc'
import { kindLabel } from '@/lib/labels'
import { formatBytes, formatTime } from '@/lib/utils'
import { DUPLICATE_HASH_LABEL, KEEP_HINT, KEEP_LABEL, type TriStateSortDirection } from '@/lib/workspace'

type WizardStep = 'pick' | 'filter' | 'analyzing' | 'result'

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
  previewSort,
  previewSortDirection,
  filterPreview,
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
  onEnterDirectory,
  onGoParent,
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
  busyExecute,
  lastExecuteJobId,
  onExecute,
  onKeepStrategy,
}: {
  step: WizardStep
  directory: string
  matchedLibraryName: string | null
  analyzeBlockReason: string | null
  filter: string
  hashStrategy: DuplicateHashStrategy
  preview: SearchHit[] | null
  previewTotal: number
  previewSort: 'name' | 'size' | 'mtime'
  previewSortDirection: TriStateSortDirection
  /** 规则即时预览命中（null = 规则为空，展示全量预览）。 */
  filterPreview: SearchHit[] | null
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
  onEnterDirectory: (hit: SearchHit) => void
  onGoParent: () => void
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
  busyExecute: boolean
  lastExecuteJobId: string | null
  onExecute: () => void
  onKeepStrategy: (value: KeepStrategy) => void
}) {
  const wasted = groups.reduce((sum, group) => sum + group.wastedBytes, 0)
  const anyBusy = busy || busyExecute
  const stepIndex = STEP_LABELS.findIndex((item) => item.key === step)
  const { widths, resize } = useColumnWidths([260, 88, 136])
  const sortAsField: Record<'name' | 'size' | 'mtime', SearchSortField> = { name: 'name', size: 'size', mtime: 'mtime' }
  const changePreviewSort = (field: SearchSortField) => {
    if (field === 'name' || field === 'size' || field === 'mtime') onPreviewSort(field)
  }
  /** 第 2 步展示的预览：规则非空且即时预览可用时显示过滤结果，否则显示目录全量。 */
  const effectivePreview = filter.trim() && filterPreview !== null ? filterPreview : preview
  const effectivePreviewTotal = filter.trim() && filterPreview !== null ? filterPreview.length : previewTotal
  /** 当前选中分组（null = 全部）。 */
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null
  /** 右侧表格展示的文件（带所属组 id）：选中组 = 组内文件；全部 = 各组文件串联。 */
  const resultFiles: Array<DuplicateHit & { groupId: string }> = activeGroup
    ? activeGroup.files.map((file) => ({ ...file, groupId: activeGroup.id }))
    : groups.flatMap((group) => group.files.map((file) => ({ ...file, groupId: group.id })))
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
    <div className="flex min-h-0 flex-1 flex-col">
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
              <Input
                value={directory}
                onChange={(event) => onDirectory(event.target.value)}
                placeholder="粘贴目录路径，或点右侧按钮选择"
                className="flex-1"
              />
              <Button variant="outline" size="icon" title="打开系统对话框选择目录" onClick={onPickDirectory}>
                <FolderSearch className="h-4 w-4" />
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  title="返回上一级目录"
                  onClick={onGoParent}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <FileSearch className="h-3.5 w-3.5" />
                <span className="truncate" title={directory}>
                  目录内容（双击文件夹进入；点击表头排序，拖动表头边缘调列宽）
                </span>
              </span>
              {effectivePreview ? (
                <span className="shrink-0">
                  {filter.trim() && filterPreview !== null
                    ? `规则命中 ${effectivePreview.length} 项`
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
                      {filter.trim()
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
                context="duplicate-filter"
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
          <div className="w-full max-w-md space-y-3 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <div className="text-sm font-medium">正在扫描重复文件…</div>
            <div className="text-xs text-muted-foreground">
              对「{directory}」{filter ? `按规则「${filter}」` : '（全部文件）'}做哈希比对，大目录可能需要一点时间
            </div>
            <div className="text-xs text-muted-foreground/70">完成后自动进入下一步</div>
          </div>
        </div>
      ) : null}

      {/* 第 4 步：结果（左：重复分组列表，可拖宽；右：选中组的文件，勾选保留/删除） */}
      {step === 'result' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <Badge>{groups.length} 组重复</Badge>
            <Badge variant="outline">将删除 {selectedCount} 份，可释放 {formatBytes(wasted)}</Badge>
            <div className="w-44" title={`每组重复里保留哪一个：${KEEP_HINT[keepStrategy]}`}>
              <Select value={keepStrategy} disabled={anyBusy} onValueChange={(value) => onKeepStrategy(value as KeepStrategy)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KEEP_LABEL) as KeepStrategy[]).map((key) => (
                    <SelectItem key={key} value={key} title={KEEP_HINT[key]}>
                      {KEEP_LABEL[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={onExecute}
              disabled={anyBusy || selectedCount === 0}
              title={`把勾选的 ${selectedCount} 份重复文件移入系统回收站`}
            >
              {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              执行删除{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
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
                    <span className="text-muted-foreground">{groups.reduce((sum, group) => sum + group.files.length, 0)} 份</span>
                  </button>
                  {groups.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">没有发现重复文件 🎉</div>
                  ) : (
                    <div className="space-y-1">
                      {groups.map((group, index) => {
                        const selected = group.id === activeGroupId
                        const keepCount = group.files.filter((file) => file.keep).length
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
                              <span className="shrink-0 text-[10px] text-muted-foreground">{group.files.length} 份</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span>{formatBytes(group.size)}</span>
                              <span>·</span>
                              <span className={keepCount >= 1 ? '' : 'text-destructive'}>留 {keepCount} 删 {group.files.length - keepCount}</span>
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
                {activeGroup ? (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" disabled={anyBusy} onClick={() => onResetGroup(activeGroup.id)}>
                    <RotateCcw className="mr-1 h-3 w-3" />
                    按策略重置本组
                  </Button>
                ) : null}
              </div>
              <ResizableTable widths={widths}>
                <TableHeader>
                  <TableRow>
                    <PlainResizableHead label="文件" width={widths[0]!} onResize={resize(0, 200, 640)} />
                    <PlainResizableHead label="大小" width={widths[1]!} onResize={resize(1, 72, 160)} />
                    <PlainResizableHead label="修改时间" width={widths[2]!} onResize={resize(2, 112, 220)} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultFiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                        没有重复文件
                      </TableCell>
                    </TableRow>
                  ) : (
                    resultFiles.map((file) => {
                      const disabled = anyBusy
                      return (
                        <TableRow
                          key={file.entryId}
                          className="cursor-pointer"
                          data-state={file.keep ? undefined : 'deleting'}
                          onClick={() => !disabled && onToggleKeep(file.groupId, file.entryId)}
                          title={`${file.path}\n点击切换：${file.keep ? '保留 → 删除' : '删除 → 保留'}（每组至少保留一份）`}
                        >
                          <TruncatedCell className={file.keep ? 'font-medium' : 'font-medium text-muted-foreground line-through'} width={widths[0]!} title={file.path}>
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0" title={file.keep ? '保留' : '删除'}>
                                {file.keep ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                              </span>
                              <span className="min-w-0 truncate">{file.name ?? file.path.split(/[\\/]/).pop()}</span>
                              {activeGroup ? null : (
                                <Badge variant="outline" className="ml-1 shrink-0 text-[10px] font-normal">
                                  组 {groups.findIndex((group) => group.id === file.groupId) + 1}
                                </Badge>
                              )}
                            </span>
                          </TruncatedCell>
                          <TruncatedCell width={widths[1]!} title={formatBytes(file.size)} className={file.keep ? undefined : 'text-muted-foreground line-through'}>
                            {formatBytes(file.size)}
                          </TruncatedCell>
                          <TruncatedCell width={widths[2]!} title={formatTime(file.mtime)} className={file.keep ? undefined : 'text-muted-foreground line-through'}>
                            {formatTime(file.mtime)}
                          </TruncatedCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </ResizableTable>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
