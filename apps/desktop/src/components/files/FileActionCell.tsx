import { ChevronRight, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableCell } from '@/components/ui/table'
import { FileMoreMenu } from '@/components/files/FileMoreMenu'
import type { SearchHit } from '@/lib/ipc'

export function FileActionCell({
  hit,
  width,
  actionsEnabled,
  actionBusy,
  onOpen,
  onCopyPath,
  onEnterDirectory,
  onRename,
  onMove,
  onDelete,
}: {
  hit: SearchHit
  width: number
  actionsEnabled: boolean
  actionBusy: boolean
  onOpen: (hit: SearchHit) => void
  onCopyPath: (hit: SearchHit) => void
  onEnterDirectory: (hit: SearchHit) => void
  onRename: (hit: SearchHit) => void
  onMove: (hit: SearchHit) => void
  onDelete: (hit: SearchHit) => void
}) {
  return (
    <TableCell className="overflow-hidden" style={{ width, minWidth: 0, maxWidth: width }}>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {hit.kind === 'dir' ? (
          <Button
            variant="ghost"
            size="icon"
            title="进入目录"
            disabled={!actionsEnabled}
            onClick={(event) => {
              event.stopPropagation()
              onEnterDirectory(hit)
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            title="打开"
            disabled={!actionsEnabled || actionBusy}
            onClick={(event) => {
              event.stopPropagation()
              onOpen(hit)
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )}
        <FileMoreMenu
          hit={hit}
          disabled={!actionsEnabled || actionBusy}
          onOpen={onOpen}
          onCopyPath={onCopyPath}
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>
    </TableCell>
  )
}
