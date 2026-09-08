import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSearch,
  Folder,
  FolderOpen,
  Layers,
  Pencil,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { FileActionCell } from '@/components/files/FileActionCell'
import { KindIcon } from '@/components/files/kind'
import { PlainResizableHead, ResizableTable, SearchSortHeader, TruncatedCell, useColumnWidths } from '@/components/files/ResizableTable'
import type { SearchHit, SearchScope, SearchSortField } from '@/lib/ipc'
import { kindLabel } from '@/lib/labels'
import { formatBytes, formatTime } from '@/lib/utils'
import {
  SEARCH_KIND_OPTIONS,
  SEARCH_SCOPE_LABEL,
  type SearchKindFilter,
  type TriStateSortDirection,
  type WorkspaceTab,
} from '@/lib/workspace'

export function SearchPane({
  hits,
  total,
  selected,
  selectedIds,
  kind,
  sort,
  sortDirection,
  scope,
  directory,
  offset,
  busy,
  actionsEnabled,
  actionBusy,
  canUseSelectedDirectory,
  onSelect,
  onKind,
  onSort,
  onSortDirection,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onPage,
  onToggleSelect,
  onOpen,
  onCopyPath,
  onEnterDirectory,
  onShowInTree,
  onSendTo,
  empty,
}: {
  hits: SearchHit[]
  total: number
  selected: SearchHit | null
  selectedIds: string[]
  kind: SearchKindFilter
  sort: SearchSortField
  sortDirection: TriStateSortDirection
  scope: SearchScope
  directory: string
  offset: number
  busy: boolean
  actionsEnabled: boolean
  actionBusy: boolean
  canUseSelectedDirectory: boolean
  onSelect: (hit: SearchHit) => void
  onKind: (value: SearchKindFilter) => void
  onSort: (value: SearchSortField) => void
  onSortDirection: (value: TriStateSortDirection) => void
  onScope: (value: SearchScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onPage: (delta: number) => void
  onToggleSelect: (entryId: string, checked: boolean) => void
  onOpen: (hit: SearchHit) => void
  onCopyPath: (hit: SearchHit) => void
  onEnterDirectory: (hit: SearchHit) => void
  onShowInTree: (hit: SearchHit) => void
  onSendTo: (target: Exclude<WorkspaceTab, 'search' | 'jobs'>) => void
  empty: boolean
}) {
  const { widths, resize } = useColumnWidths([44, 220, 56, 88, 136, 220, 96])

  const changeSort = (field: SearchSortField) => {
    if (sort === field) {
      onSortDirection(sortDirection === 'asc' ? 'desc' : sortDirection === 'desc' ? null : 'asc')
      return
    }
    onSort(field)
    onSortDirection(null)
  }

  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        添加资料库并扫描
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="w-28">
          <Select value={kind} disabled={busy} onValueChange={(value) => onKind(value as SearchKindFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEARCH_KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <Select value={scope} disabled={busy} onValueChange={(value) => onScope(value as SearchScope)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SEARCH_SCOPE_LABEL) as SearchScope[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SEARCH_SCOPE_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {scope === 'directory' ? (
          <div className="flex min-w-[16rem] flex-1 items-center gap-2">
            <Input
              value={directory}
              disabled={busy}
              onChange={(event) => onDirectory(event.target.value)}
              placeholder="D:\\目录"
            />
            <Button
              variant="outline"
              size="icon"
              title="使用当前选中文件所在目录"
              disabled={!canUseSelectedDirectory || busy}
              onClick={onUseSelectedDirectory}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {scope === 'selection' ? <Badge variant="outline">已选 {selectedIds.length}</Badge> : null}
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            title="打开 (Enter)"
            disabled={!actionsEnabled || !selected || actionBusy}
            onClick={() => selected && onOpen(selected)}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="复制完整路径"
            disabled={!actionsEnabled || !selected || actionBusy}
            onClick={() => selected && onCopyPath(selected)}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="在目录结构中查看"
            disabled={!actionsEnabled || !selected}
            onClick={() => selected && onShowInTree(selected)}
          >
            <Folder className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="加入规则测试选择"
            disabled={!actionsEnabled || (!selected && selectedIds.length === 0)}
            onClick={() => onSendTo('rules')}
          >
            <FileSearch className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="加入重命名器"
            disabled={!actionsEnabled || (!selected && selectedIds.length === 0)}
            onClick={() => onSendTo('rename')}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="加入重复分析"
            disabled={!actionsEnabled || (!selected && selectedIds.length === 0)}
            onClick={() => onSendTo('duplicates')}
          >
            <Layers className="h-4 w-4" />
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" title="上一页" disabled={busy || offset === 0} onClick={() => onPage(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-24 text-center text-xs text-muted-foreground">
            {hits.length === 0 ? `0 / ${total}` : `${offset + 1}-${offset + hits.length} / ${total}`}
          </span>
          <Button
            variant="outline"
            size="icon"
            title="下一页"
            disabled={busy || offset + hits.length >= total}
            onClick={() => onPage(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ResizableTable widths={widths}>
        <TableHeader>
          <TableRow>
            <PlainResizableHead label="" width={widths[0]} onResize={resize(0, 44, 72)} />
            <SearchSortHeader
              label="名称"
              field="name"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={changeSort}
              width={widths[1]}
              onResize={resize(1, 140, 420)}
            />
            <PlainResizableHead label="类型" width={widths[2]} onResize={resize(2, 48, 96)} />
            <SearchSortHeader
              label="大小"
              field="size"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={changeSort}
              width={widths[3]}
              onResize={resize(3, 72, 160)}
            />
            <SearchSortHeader
              label="修改时间"
              field="mtime"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={changeSort}
              width={widths[4]}
              onResize={resize(4, 112, 220)}
            />
            <SearchSortHeader
              label="路径"
              field="path_mtime"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={changeSort}
              width={widths[5]}
              onResize={resize(5, 140, 420)}
            />
            <PlainResizableHead label="操作" width={widths[6]} onResize={resize(6, 88, 160)} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {hits.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                {total === 0 ? '没有匹配结果。可试 ext:mp4 或 parent:下载' : '没有可见结果'}
              </TableCell>
            </TableRow>
          ) : (
            hits.map((hit) => (
              <TableRow
                key={hit.entryId}
                data-state={selected?.entryId === hit.entryId ? 'selected' : undefined}
                className="cursor-pointer"
                tabIndex={actionsEnabled ? 0 : -1}
                aria-disabled={!actionsEnabled}
                onClick={() => onSelect(hit)}
                onKeyDown={(event) => {
                  if (!actionsEnabled || event.key !== 'Enter') return
                  event.preventDefault()
                  if (hit.kind === 'dir') onEnterDirectory(hit)
                  else onOpen(hit)
                }}
                onDoubleClick={() => {
                  if (!actionsEnabled) return
                  if (hit.kind === 'dir') onEnterDirectory(hit)
                  else onOpen(hit)
                }}
              >
                <TableCell
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="overflow-hidden"
                  style={{ width: widths[0], minWidth: 0, maxWidth: widths[0] }}
                >
                  <Checkbox
                    checked={selectedIds.includes(hit.entryId)}
                    disabled={busy}
                    onCheckedChange={(checked) => onToggleSelect(hit.entryId, checked === true)}
                  />
                </TableCell>
                <TruncatedCell className="font-medium" width={widths[1]} title={hit.name}>
                  {hit.name}
                </TruncatedCell>
                <TruncatedCell width={widths[2]} title={kindLabel(hit.kind)}>
                  <span className="flex w-6 items-center justify-center">
                    <KindIcon kind={hit.kind} />
                  </span>
                </TruncatedCell>
                <TruncatedCell width={widths[3]} title={hit.kind === 'dir' ? '-' : formatBytes(hit.size)}>
                  {hit.kind === 'dir' ? '-' : formatBytes(hit.size)}
                </TruncatedCell>
                <TruncatedCell width={widths[4]} title={formatTime(hit.mtime)}>{formatTime(hit.mtime)}</TruncatedCell>
                <TruncatedCell className="text-muted-foreground" width={widths[5]} title={hit.path}>
                  {hit.path}
                </TruncatedCell>
                <FileActionCell
                  hit={hit}
                  width={widths[6]}
                  actionsEnabled={actionsEnabled}
                  actionBusy={actionBusy}
                  onOpen={onOpen}
                  onCopyPath={onCopyPath}
                  onEnterDirectory={onEnterDirectory}
                />
              </TableRow>
            ))
          )}
        </TableBody>
      </ResizableTable>
    </div>
  )
}
