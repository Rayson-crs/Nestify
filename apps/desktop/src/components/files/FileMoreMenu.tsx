import { Copy, ExternalLink, FolderInput, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { SearchHit } from '@/lib/ipc'

export function FileMoreMenu({
  hit,
  disabled,
  onOpen,
  onCopyPath,
  onRename,
  onMove,
  onDelete,
}: {
  hit: SearchHit
  disabled: boolean
  onOpen: (hit: SearchHit) => void
  onCopyPath: (hit: SearchHit) => void
  onRename: (hit: SearchHit) => void
  onMove: (hit: SearchHit) => void
  onDelete: (hit: SearchHit) => void
}) {
  const run = (action: () => void) => (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="更多操作"
          aria-label={`更多操作：${hit.name}`}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={run(() => onOpen(hit))}>
          <ExternalLink className="h-4 w-4" />
          {hit.kind === 'dir' ? '进入目录' : '打开'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run(() => onCopyPath(hit))}>
          <Copy className="h-4 w-4" />
          复制路径
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={run(() => onRename(hit))}>
          <Pencil className="h-4 w-4" />
          重命名
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run(() => onMove(hit))}>
          <FolderInput className="h-4 w-4" />
          移动到目录
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={run(() => onDelete(hit))}>
          <Trash2 className="h-4 w-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
