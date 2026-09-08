import { FolderPlus, Loader2, Pause, Play, ScanSearch, Settings2, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ALL_LIBRARIES_ID, type LibrarySummary } from '@/lib/ipc'

const EMPTY_LIBRARY_SELECT_VALUE = '__empty__'

export function LibrarySidebar({
  libraries,
  selectedLibraryId,
  selectedLibrary,
  allLibrariesSelected,
  libraryRootCount,
  ipcReady,
  busy,
  scanning,
  scanPaused,
  scanJobId,
  removingLibrary,
  onSelect,
  onAdd,
  onEdit,
  onRemove,
  onScan,
  onScanControl,
}: {
  libraries: LibrarySummary[]
  selectedLibraryId: string | null
  selectedLibrary: LibrarySummary | null
  allLibrariesSelected: boolean
  libraryRootCount: number
  ipcReady: boolean
  busy: string | null
  scanning: boolean
  scanPaused: boolean
  scanJobId: string | null
  removingLibrary: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onEdit: () => void
  onRemove: () => void
  onScan: () => void
  onScanControl: (action: 'pause' | 'resume' | 'cancel') => void
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-background">
      <div className="flex items-center justify-between px-3 py-2">
        <Label className="text-xs font-medium text-muted-foreground">资料库</Label>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={!ipcReady || busy !== null}>
          <FolderPlus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
      <div className="space-y-2 px-3 pb-3">
        <Select
          value={libraries.length === 0 ? EMPTY_LIBRARY_SELECT_VALUE : selectedLibraryId ?? ALL_LIBRARIES_ID}
          disabled={libraries.length === 0 || busy === 'add' || busy?.startsWith('remove:')}
          onValueChange={onSelect}
        >
          <SelectTrigger id="library-select">
            <SelectValue placeholder="选择资料库" />
          </SelectTrigger>
          <SelectContent>
            {libraries.length === 0 ? (
              <SelectItem value={EMPTY_LIBRARY_SELECT_VALUE}>未添加</SelectItem>
            ) : (
              <>
                <SelectItem value={ALL_LIBRARIES_ID}>全部资料库</SelectItem>
                {libraries.map((library) => (
                  <SelectItem key={library.id} value={library.id}>
                    <span className="min-w-0 flex-1 truncate">{library.name}</span>
                    <span className="ml-2 min-w-0 truncate text-xs text-muted-foreground">{library.roots[0]}</span>
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-w-0 flex-1"
            disabled={!selectedLibrary || !ipcReady || busy !== null || (scanning && selectedLibraryId === selectedLibrary?.id)}
            onClick={onEdit}
          >
            <Settings2 className="h-3.5 w-3.5" />
            编辑
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="移除资料库"
            disabled={!selectedLibrary || !ipcReady || removingLibrary || (scanning && selectedLibraryId === selectedLibrary?.id)}
            onClick={onRemove}
          >
            {removingLibrary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-3">
        <div className="pb-3 text-xs text-muted-foreground">
          {allLibrariesSelected
            ? `${libraries.length} 个资料库 / ${libraryRootCount} 个根目录`
            : selectedLibrary
              ? selectedLibrary.roots.join('\n')
              : '添加资料库并扫描'}
        </div>
      </ScrollArea>
      <div className="border-t p-2">
        <div className="flex gap-2">
          <Button className="min-w-0 flex-1" onClick={onScan} disabled={!selectedLibrary || scanning || busy === 'scan'}>
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
