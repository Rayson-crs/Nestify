import { ChevronRight, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableCell } from '@/components/ui/table'
import type { SearchHit } from '@/lib/ipc'

export function FileActionCell({
  hit,
  width,
  actionsEnabled,
  actionBusy,
  onOpen,
  onCopyPath,
  onEnterDirectory,
}: {
  hit: SearchHit
  width: number
  actionsEnabled: boolean
  actionBusy: boolean
  onOpen: (hit: SearchHit) => void
  onCopyPath: (hit: SearchHit) => void
  onEnterDirectory: (hit: SearchHit) => void
}) {
  return (
    <TableCell className="overflow-hidden" style={{ width, minWidth: 0, maxWidth: width }}>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {hit.kind === 'dir' ? (
          <Button
            variant="outline"
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
            variant="outline"
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
        <Button
          variant="outline"
          size="icon"
          title="复制完整路径"
          disabled={!actionsEnabled}
          onClick={(event) => {
            event.stopPropagation()
            onCopyPath(hit)
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </TableCell>
  )
}