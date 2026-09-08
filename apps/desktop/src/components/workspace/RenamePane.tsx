import { FolderOpen, History, Loader2, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlanTable } from '@/components/workspace/PlanTable'
import type { ChangePlan, Collision, DuplicateScope } from '@/lib/ipc'
import { COLLISION_LABEL, DUPLICATE_SCOPE_LABEL } from '@/lib/workspace'

export function RenamePane({
  template,
  collision,
  scope,
  directory,
  searchSelectedCount,
  canPreview,
  canUseSelectedDirectory,
  busy,
  onTemplate,
  onCollision,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onPreview,
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
  template: string
  collision: Collision
  scope: DuplicateScope
  directory: string
  searchSelectedCount: number
  canPreview: boolean
  canUseSelectedDirectory: boolean
  busy: boolean
  onTemplate: (value: string) => void
  onCollision: (value: Collision) => void
  onScope: (value: DuplicateScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onPreview: () => void
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
  const anyBusy = busy || busyExecute || busyRollback

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b px-3 py-2">
        <Input value={template} disabled={anyBusy} onChange={(event) => onTemplate(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="w-36">
            <Select value={collision} disabled={anyBusy} onValueChange={(value) => onCollision(value as Collision)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
              {(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {COLLISION_LABEL[key]}
                </SelectItem>
              ))}
              </SelectContent>
            </Select>
          </div>
          {scope === 'directory' ? (
            <div className="flex min-w-[16rem] flex-1 items-center gap-2">
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
          {scope === 'selection' ? <Badge variant="outline">已选 {searchSelectedCount}</Badge> : null}
          <Button onClick={onPreview} disabled={anyBusy || !template.trim() || !canPreview}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            预览改名
          </Button>
          <Button onClick={onExecute} disabled={anyBusy || selectedCount === 0}>
            {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            执行选中
          </Button>
          {lastExecuteJobId ? (
            <Button variant="outline" onClick={onRollback} disabled={anyBusy}>
              {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
              回滚
            </Button>
          ) : null}
          {plan ? <Badge>{selectedCount}/{plan.ops.length} 勾选</Badge> : null}
        </div>
        <div className="text-sm text-muted-foreground">
          例：a/b/c/a.txt 用 {'{parent}{ext}'} 得到 c.txt，用 {'{grandparent}{ext}'} 得到 b.txt
        </div>
      </div>
      <PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} />
    </div>
  )
}

