import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { FileActionCell } from '@/components/files/FileActionCell'
import { KindIcon } from '@/components/files/kind'
import { PlainResizableHead, ResizableTable, SearchSortHeader, TruncatedCell, useColumnWidths } from '@/components/files/ResizableTable'
import { SearchToolbar } from '@/components/files/SearchToolbar'
import type { SearchHit, SearchScope, SearchSortField } from '@/lib/ipc'
import { kindLabel } from '@/lib/labels'
import { formatBytes, formatTime } from '@/lib/utils'
import {
  type SearchKindFilter,
  type TriStateSortDirection,
  type WorkspaceSendTarget,
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
  hasMore,
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
  onRename,
  onMove,
  onDelete,
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
  hasMore: boolean
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
  onRename: (hit: SearchHit) => void
  onMove: (hit: SearchHit) => void
  onDelete: (hit: SearchHit) => void
  onShowInTree: (hit: SearchHit) => void
  onSendTo: (target: WorkspaceSendTarget) => void
  empty: boolean
}) {
  const { widths, resize } = useColumnWidths([44, 260, 88, 136, 220, 96])

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
      <SearchToolbar
        selected={selected}
        selectedIds={selectedIds}
        kind={kind}
        scope={scope}
        directory={directory}
        offset={offset}
        hasMore={hasMore}
        total={total}
        hitsLength={hits.length}
        busy={busy}
        actionsEnabled={actionsEnabled}
        actionBusy={actionBusy}
        canUseSelectedDirectory={canUseSelectedDirectory}
        onKind={onKind}
        onScope={onScope}
        onDirectory={onDirectory}
        onUseSelectedDirectory={onUseSelectedDirectory}
        onPage={onPage}
        onOpen={onOpen}
        onCopyPath={onCopyPath}
        onShowInTree={onShowInTree}
        onSendTo={onSendTo}
      />
      <ResizableTable widths={widths}>
        <TableHeader>
          <TableRow>
            <PlainResizableHead label="" width={widths[0]!} onResize={resize(0, 44, 72)} />
            <SearchSortHeader
              label="名称"
              field="name"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={changeSort}
              width={widths[1]!}
              onResize={resize(1, 180, 520)}
            />
            <SearchSortHeader
              label="大小"
              field="size"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={changeSort}
              width={widths[2]!}
              onResize={resize(2, 72, 160)}
            />
            <SearchSortHeader
              label="修改时间"
              field="mtime"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={changeSort}
              width={widths[3]!}
              onResize={resize(3, 112, 220)}
            />
            <SearchSortHeader
              label="路径"
              field="path_mtime"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={changeSort}
              width={widths[4]!}
              onResize={resize(4, 140, 420)}
            />
            <PlainResizableHead label="操作" width={widths[5]!} onResize={resize(5, 88, 160)} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {hits.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
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
                <TruncatedCell className="font-medium" width={widths[1]!} title={hit.name}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0" title={kindLabel(hit.kind)} aria-label={kindLabel(hit.kind)}>
                      <KindIcon kind={hit.kind} />
                    </span>
                    <span className="min-w-0 truncate">{hit.name}</span>
                  </span>
                </TruncatedCell>
                <TruncatedCell width={widths[2]!} title={hit.kind === 'dir' ? '-' : formatBytes(hit.size)}>
                  {hit.kind === 'dir' ? '-' : formatBytes(hit.size)}
                </TruncatedCell>
                <TruncatedCell width={widths[3]!} title={formatTime(hit.mtime)}>{formatTime(hit.mtime)}</TruncatedCell>
                <TruncatedCell className="text-muted-foreground" width={widths[4]!} title={hit.path}>
                  {hit.path}
                </TruncatedCell>
                <FileActionCell
                  hit={hit}
                  width={widths[5]!}
                  actionsEnabled={actionsEnabled}
                  actionBusy={actionBusy}
                  onOpen={onOpen}
                  onCopyPath={onCopyPath}
                  onEnterDirectory={onEnterDirectory}
                  onRename={onRename}
                  onMove={onMove}
                  onDelete={onDelete}
                />
              </TableRow>
            ))
          )}
        </TableBody>
      </ResizableTable>
    </div>
  )
}
