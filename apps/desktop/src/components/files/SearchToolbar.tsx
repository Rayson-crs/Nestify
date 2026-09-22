import {
  ChevronLeft,
  ChevronRight,
  Combine,
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
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SearchHit, SearchScope } from '@/lib/ipc'
import {
  SEARCH_KIND_OPTIONS,
  SEARCH_SCOPE_LABEL,
  type SearchKindFilter,
  type WorkspaceSendTarget,
} from '@/lib/workspace'

export function SearchToolbar({
  selected,
  selectedIds,
  kind,
  scope,
  directory,
  offset,
  hasMore,
  total,
  hitsLength,
  busy,
  actionsEnabled,
  actionBusy,
  canUseSelectedDirectory,
  onKind,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onPage,
  onOpen,
  onCopyPath,
  onShowInTree,
  onSendTo,
}: {
  selected: SearchHit | null
  selectedIds: string[]
  kind: SearchKindFilter
  scope: SearchScope
  directory: string
  offset: number
  hasMore: boolean
  total: number
  hitsLength: number
  busy: boolean
  actionsEnabled: boolean
  actionBusy: boolean
  canUseSelectedDirectory: boolean
  onKind: (value: SearchKindFilter) => void
  onScope: (value: SearchScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onPage: (delta: number) => void
  onOpen: (hit: SearchHit) => void
  onCopyPath: (hit: SearchHit) => void
  onShowInTree: (hit: SearchHit) => void
  onSendTo: (target: WorkspaceSendTarget) => void
}) {
  return (
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
          onClick={() => onSendTo('organize')}
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
          title="在选中文件所在目录查重复"
          disabled={!actionsEnabled || !selected}
          onClick={() => onSendTo('duplicates')}
        >
          <Layers className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="加入媒体合并"
          disabled={!actionsEnabled || (!selected && selectedIds.length === 0)}
          onClick={() => onSendTo('merge')}
        >
          <Combine className="h-4 w-4" />
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="outline" size="icon" title="上一页" disabled={busy || offset === 0} onClick={() => onPage(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-24 text-center text-xs text-muted-foreground">
          {hitsLength === 0 ? '0' : `${offset + 1}-${offset + hitsLength}${hasMore ? '+' : ` / ${total}`}`}
        </span>
        <Button
          variant="outline"
          size="icon"
          title="下一页"
          disabled={busy || !hasMore}
          onClick={() => onPage(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
