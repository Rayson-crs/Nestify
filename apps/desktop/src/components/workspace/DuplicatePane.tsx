import { Copy, FolderOpen, History, Loader2, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { PlanTable } from '@/components/workspace/PlanTable'
import type { ChangePlan, DuplicateGroup, DuplicateScope, KeepStrategy } from '@/lib/ipc'
import { formatBytes } from '@/lib/utils'
import { DUPLICATE_SCOPE_LABEL, KEEP_LABEL } from '@/lib/workspace'

export function DuplicatePane({
  groups,
  keepStrategy,
  scope,
  directory,
  searchSelectedCount,
  canUseSelectedDirectory,
  busy,
  onKeepStrategy,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onAnalyze,
  plan,
  selectedOps,
  onToggleOp,
  selectedCount,
  busyExecute,
  busyRollback,
  lastExecuteJobId,
  onExecute,
  onRollback,
}: {
  groups: DuplicateGroup[]
  keepStrategy: KeepStrategy
  scope: DuplicateScope
  directory: string
  searchSelectedCount: number
  canUseSelectedDirectory: boolean
  busy: boolean
  onKeepStrategy: (value: KeepStrategy) => void
  onScope: (value: DuplicateScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onAnalyze: () => void
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  onToggleOp: (index: number, checked: boolean) => void
  selectedCount: number
  busyExecute: boolean
  busyRollback: boolean
  lastExecuteJobId: string | null
  onExecute: () => void
  onRollback: () => void
}) {
  const wasted = groups.reduce((sum, group) => sum + group.wastedBytes, 0)
  const anyBusy = busy || busyExecute || busyRollback
  const needsDirectory = scope === 'directory' || keepStrategy === 'preferred_dir'
  const canAnalyze =
    !anyBusy &&
    (!needsDirectory || directory.trim().length > 0) &&
    (scope !== 'selection' || searchSelectedCount > 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="w-32">
          <Select value={scope} disabled={anyBusy} onValueChange={(value) => onScope(value as DuplicateScope)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
            {(Object.keys(DUPLICATE_SCOPE_LABEL) as DuplicateScope[]).map((key) => (
              <SelectItem key={key} value={key}>
                {DUPLICATE_SCOPE_LABEL[key]}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Select value={keepStrategy} disabled={anyBusy} onValueChange={(value) => onKeepStrategy(value as KeepStrategy)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
            {(Object.keys(KEEP_LABEL) as KeepStrategy[]).map((key) => (
              <SelectItem key={key} value={key}>
                {KEEP_LABEL[key]}
              </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {needsDirectory ? (
          <div className="flex min-w-[18rem] flex-1 items-center gap-2">
            <Input
              value={directory}
              disabled={anyBusy}
              onChange={(event) => onDirectory(event.target.value)}
              placeholder="D:\\目录"
            />
            <Button
              variant="outline"
              size="icon"
              title="使用当前选中文件所在目录"
              disabled={!canUseSelectedDirectory || anyBusy}
              onClick={onUseSelectedDirectory}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        <Button onClick={onAnalyze} disabled={!canAnalyze}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          分析重复
        </Button>
        <Button onClick={onExecute} disabled={anyBusy || selectedCount === 0}>
          {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          隔离选中
        </Button>
        {lastExecuteJobId ? (
          <Button variant="outline" onClick={onRollback} disabled={anyBusy}>
            {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            回滚
          </Button>
        ) : null}
        {scope === 'selection' ? <Badge variant="outline">已选 {searchSelectedCount}</Badge> : null}
        {groups.length > 0 ? <Badge>{groups.length} 组 / {formatBytes(wasted)}</Badge> : null}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)]">
        <ScrollArea className="border-r p-2">
          {groups.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">先分析重复候选</div>
          ) : (
            <div className="space-y-2">
              {groups.map((group, index) => (
                <div key={group.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{group.id}</span>
                    <Badge>{formatBytes(group.wastedBytes)} 可释放</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">SHA256 {group.hash.slice(0, 16)}...</div>
                  <div className="mt-2 space-y-1">
                    {group.files.map((file) => (
                      <div key={file.entryId} className="truncate text-xs" title={file.path}>
                        {file.keep ? '保留 · ' : '隔离 · '}
                        {file.path}
                      </div>
                    ))}
                  </div>
                  {index < groups.length - 1 ? <Separator /> : null}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} />
      </div>
    </div>
  )
}

