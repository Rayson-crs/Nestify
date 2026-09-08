import fs from 'node:fs'

function write(path, content) {
  fs.writeFileSync(path, content.replaceAll('\r\n', '\n'))
}

write('apps/desktop/src/components/files/FileTreePane.tsx', `import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { FileActionCell } from '@/components/files/FileActionCell'
import { KindIcon } from '@/components/files/kind'
import { PlainResizableHead, ResizableTable, SearchSortHeader, TruncatedCell, useColumnWidths } from '@/components/files/ResizableTable'
import type { SearchHit, SearchSortField } from '@/lib/ipc'
import { kindLabel } from '@/lib/labels'
import { libraryPathCrumbs } from '@/lib/path-crumbs'
import { formatBytes, formatTime } from '@/lib/utils'
import type { TriStateSortDirection } from '@/lib/workspace'

export function FileTreePane({
  hits,
  total,
  path,
  rootMode,
  rootPath,
  selected,
  busy,
  actionsEnabled,
  actionBusy,
  sort,
  sortDirection,
  onEnterDirectory,
  onSelect,
  onOpen,
  onCopyPath,
  onSort,
  empty,
}: {
  hits: SearchHit[]
  total: number
  path: string
  rootMode: boolean
  rootPath: string | null
  selected: SearchHit | null
  busy: boolean
  actionsEnabled: boolean
  actionBusy: boolean
  sort: SearchSortField
  sortDirection: TriStateSortDirection
  onEnterDirectory: (path: string) => void
  onSelect: (hit: SearchHit) => void
  onOpen: (hit: SearchHit) => void
  onCopyPath: (hit: SearchHit) => void
  onSort: (field: SearchSortField) => void
  empty: boolean
}) {
  const { widths, resize } = useColumnWidths([240, 56, 88, 136, 96])

  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        添加资料库并扫描
      </div>
    )
  }

  const crumbs = libraryPathCrumbs(path, rootPath)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-w-0 items-center gap-1 border-b px-3 py-2">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        {rootMode ? (
          <div className="min-w-0 flex-1 truncate text-sm font-medium">全部资料库</div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1
              return (
                <div key={crumb.path} className="flex min-w-0 items-center gap-1">
                  {index > 0 ? <span className="text-muted-foreground">/</span> : null}
                  <Button
                    variant={last ? 'secondary' : 'ghost'}
                    size="sm"
                    className="min-w-0 max-w-48 truncate"
                    title={crumb.path}
                    onClick={() => onEnterDirectory(crumb.path)}
                  >
                    {crumb.label}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
        <Badge variant="outline">{hits.length} / {total}</Badge>
      </div>
      <ResizableTable widths={widths}>
        <TableHeader>
          <TableRow>
            <SearchSortHeader
              label="名称"
              field="name"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={onSort}
              width={widths[0]}
              onResize={resize(0, 140, 420)}
            />
            <PlainResizableHead label="类型" width={widths[1]} onResize={resize(1, 48, 96)} />
            <SearchSortHeader
              label="大小"
              field="size"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={onSort}
              width={widths[2]}
              onResize={resize(2, 72, 160)}
            />
            <SearchSortHeader
              label="修改时间"
              field="mtime"
              sort={sort}
              direction={sortDirection}
              disabled={busy}
              onSort={onSort}
              width={widths[3]}
              onResize={resize(3, 112, 220)}
            />
            <PlainResizableHead label="操作" width={widths[4]} onResize={resize(4, 88, 160)} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {hits.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                此目录没有已索引内容
              </TableCell>
            </TableRow>
          ) : (
            hits.map((hit) => (
              <TableRow
                key={hit.entryId}
                data-state={selected?.entryId === hit.entryId ? 'selected' : undefined}
                className="cursor-pointer"
                tabIndex={actionsEnabled ? 0 : -1}
                onClick={() => onSelect(hit)}
                onKeyDown={(event) => {
                  if (!actionsEnabled || event.key !== 'Enter') return
                  event.preventDefault()
                  if (hit.kind === 'dir') onEnterDirectory(hit.path)
                  else onOpen(hit)
                }}
                onDoubleClick={() => {
                  if (!actionsEnabled) return
                  if (hit.kind === 'dir') onEnterDirectory(hit.path)
                  else onOpen(hit)
                }}
              >
                <TruncatedCell className="font-medium" width={widths[0]} title={hit.name}>
                  {hit.name}
                </TruncatedCell>
                <TruncatedCell width={widths[1]} title={kindLabel(hit.kind)}>
                  <span className="flex w-6 items-center justify-center">
                    <KindIcon kind={hit.kind} />
                  </span>
                </TruncatedCell>
                <TruncatedCell width={widths[2]} title={formatBytes(hit.size)}>{formatBytes(hit.size)}</TruncatedCell>
                <TruncatedCell width={widths[3]} title={formatTime(hit.mtime)}>{formatTime(hit.mtime)}</TruncatedCell>
                <FileActionCell
                  hit={hit}
                  width={widths[4]}
                  actionsEnabled={actionsEnabled}
                  actionBusy={actionBusy}
                  onOpen={onOpen}
                  onCopyPath={onCopyPath}
                  onEnterDirectory={(item) => onEnterDirectory(item.path)}
                />
              </TableRow>
            ))
          )}
        </TableBody>
      </ResizableTable>
    </div>
  )
}
`)

console.log('wrote tree pane')