import { ChevronLeft, ChevronRight, FolderPlus, Layers, Loader2, Pause, Play, RefreshCw, ScanSearch, Settings2, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { ALL_LIBRARIES_ID, type LibraryRemovalProgress, type LibrarySummary } from '@/lib/ipc'

export function LibrarySidebar({
  libraries,
  selectedLibraryId,
  selectedLibrary,
  allLibrariesSelected,
  ipcReady,
  busy,
  scanning,
  scanPaused,
  scanJobId,
  removingLibrary,
  removalProgress,
  refreshing,
  onSelect,
  onAdd,
  onEdit,
  onRemove,
  onScan,
  onScanControl,
  collapsed,
  onToggleCollapsed,
  onRefresh,
}: {
  libraries: LibrarySummary[]
  selectedLibraryId: string | null
  selectedLibrary: LibrarySummary | null
  allLibrariesSelected: boolean
  ipcReady: boolean
  busy: string | null
  scanning: boolean
  scanPaused: boolean
  scanJobId: string | null
  removingLibrary: boolean
  removalProgress: LibraryRemovalProgress | null
  refreshing: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onEdit: () => void
  onRemove: () => void
  onScan: () => void
  onScanControl: (action: 'pause' | 'resume' | 'cancel') => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onRefresh: () => void
}) {
  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center border-r bg-background py-2">
        <Button variant="ghost" size="icon" title="展开资料库" onClick={onToggleCollapsed}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="添加资料库" disabled={!ipcReady || busy !== null || Boolean(removalProgress)} onClick={onAdd}>
          <FolderPlus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="刷新资料库列表" aria-label="刷新资料库列表" disabled={!ipcReady || refreshing || busy !== null || Boolean(removalProgress)} onClick={onRefresh}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
        {scanning || removalProgress ? <Loader2 className="mt-2 h-4 w-4 animate-spin text-primary" /> : null}
      </aside>
    )
  }
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-background">
      <div className="flex items-center justify-between px-3 py-2">
        <Label className="text-xs font-medium text-muted-foreground">资料库</Label>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" title="收起资料库" onClick={onToggleCollapsed}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" title="刷新资料库列表" aria-label="刷新资料库列表" disabled={!ipcReady || refreshing || busy !== null || Boolean(removalProgress)} onClick={onRefresh}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="outline" onClick={onAdd} disabled={!ipcReady || busy !== null || Boolean(removalProgress)}>
            <FolderPlus className="h-3.5 w-3.5" />
            添加
          </Button>
        </div>
      </div>
      <div className="flex gap-2 px-3 pb-2">
        <Button
          variant="outline"
          className="min-w-0 flex-1"
          disabled={!selectedLibrary || !ipcReady || busy !== null || Boolean(removalProgress) || (scanning && selectedLibraryId === selectedLibrary?.id)}
          onClick={onEdit}
        >
          <Settings2 className="h-3.5 w-3.5" />
          编辑
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="移除资料库"
          disabled={!selectedLibrary || !ipcReady || removingLibrary || Boolean(removalProgress) || (scanning && selectedLibraryId === selectedLibrary?.id)}
          onClick={onRemove}
        >
          {removingLibrary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="space-y-1 pb-3">
          {libraries.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              还没有资料库，点上方「添加」创建第一个
            </div>
          ) : (
            <>
              <LibraryListItem
                active={allLibrariesSelected}
                disabled={busy === 'add' || Boolean(removalProgress)}
                icon={<Layers className="h-3.5 w-3.5" />}
                title="全部资料库"
                subtitle={`共 ${libraries.length} 个资料库`}
                onClick={() => onSelect(ALL_LIBRARIES_ID)}
              />
              {libraries.map((library) => (
                <LibraryListItem
                  key={library.id}
                  active={selectedLibraryId === library.id}
                  disabled={busy === 'add' || Boolean(removalProgress)}
                  title={library.name}
                  subtitle={library.roots[0]}
                  onClick={() => onSelect(library.id)}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>
      <div className="border-t p-2">
        <div className="flex gap-2">
          <Button className="min-w-0 flex-1" onClick={onScan} disabled={!selectedLibrary || scanning || busy === 'scan' || Boolean(removalProgress)}>
            {scanning || busy === 'scan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            {scanning ? (scanPaused ? '已暂停' : '扫描中') : '扫描'}
          </Button>
          {scanning ? (
            <>
              <Button
                variant="outline"
                size="icon"
                title={scanPaused ? '恢复扫描' : '暂停扫描'}
                disabled={!scanJobId || busy === 'scan:pause' || busy === 'scan:resume'}
                onClick={() => onScanControl(scanPaused ? 'resume' : 'pause')}
              >
                {busy === 'scan:pause' || busy === 'scan:resume' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : scanPaused ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="取消扫描"
                disabled={!scanJobId || busy === 'scan:cancel'}
                onClick={() => onScanControl('cancel')}
              >
                {busy === 'scan:cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

function LibraryListItem({
  active,
  disabled,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean
  disabled: boolean
  icon?: React.ReactNode
  title: string
  subtitle?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-50',
        active
          ? 'border-primary/40 bg-primary/10'
          : 'border-transparent hover:border-muted-foreground/25 hover:bg-muted/50',
      )}
    >
      {icon ? (
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-sm', active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', active ? 'font-medium text-foreground' : 'text-foreground/90')}>
          {title}
        </span>
        {subtitle ? (
          <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
    </button>
  )
}
