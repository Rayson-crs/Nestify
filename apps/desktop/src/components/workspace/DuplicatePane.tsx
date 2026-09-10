import { Copy, FolderSearch, HelpCircle, History, Loader2, ShieldQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { PlanTable } from '@/components/workspace/PlanTable'
import type { ChangePlan, DuplicateGroup, DuplicateHashStrategy, KeepStrategy } from '@/lib/ipc'
import { formatBytes } from '@/lib/utils'
import { DUPLICATE_HASH_LABEL, KEEP_HINT, KEEP_LABEL } from '@/lib/workspace'

export function DuplicatePane({
  groups,
  keepStrategy,
  hashStrategy,
  directory,
  matchedLibraryName,
  busy,
  onKeepStrategy,
  onHashStrategy,
  onDirectory,
  onPickDirectory,
  onAnalyze,
  analyzeBlockReason,
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
  hashStrategy: DuplicateHashStrategy
  directory: string
  matchedLibraryName: string | null
  busy: boolean
  onKeepStrategy: (value: KeepStrategy) => void
  onHashStrategy: (value: DuplicateHashStrategy) => void
  onDirectory: (value: string) => void
  onPickDirectory: () => void
  onAnalyze: () => void
  analyzeBlockReason: string | null
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
  const analyzeDisabled = anyBusy || analyzeBlockReason !== null
  const executeDisabled = anyBusy || selectedCount === 0
  const analyzeHint = analyzeBlockReason
    ? `分析重复（当前不可用）：${analyzeBlockReason}`
    : '分析重复：在指定目录（含子目录）里按哈希把内容相同的文件分组，每组按保留策略留一份，其余生成隔离计划（不会直接删除）'
  const executeHint = busy
    ? '正在分析…'
    : busyExecute
      ? '正在执行…'
      : selectedCount === 0
        ? '隔离选中（当前不可用）：先点「分析重复」生成计划，表格里的条目会自动勾选，确认后这里就能点了'
        : `隔离选中：把勾选的 ${selectedCount} 个重复文件移入隔离区 .nestify-quarantine，可回滚恢复`
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="flex min-w-[18rem] flex-1 items-center gap-1.5">
          <Input
            value={directory}
            disabled={anyBusy}
            onChange={(event) => onDirectory(event.target.value)}
            placeholder="第 1 步：填入或选择要查重的目录"
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            title="打开系统对话框选择目录"
            disabled={anyBusy}
            onClick={onPickDirectory}
          >
            <FolderSearch className="h-4 w-4" />
          </Button>
          {matchedLibraryName ? (
            <Badge variant="secondary" className="shrink-0" title="该目录自动匹配到的资料库">
              {matchedLibraryName}
            </Badge>
          ) : null}
        </div>
        <div className="w-44" title={`每组重复里保留哪一个：${KEEP_HINT[keepStrategy]}`}>
          <Select value={keepStrategy} disabled={anyBusy} onValueChange={(value) => onKeepStrategy(value as KeepStrategy)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KEEP_LABEL) as KeepStrategy[]).map((key) => (
                <SelectItem key={key} value={key} title={KEEP_HINT[key]}>
                  {KEEP_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          className="w-40"
          title="判定“内容相同”的依据：重复候选=先按大小分桶、只对可疑组算哈希（快，推荐）；全量=所有文件都算哈希（最准，大库慢）"
        >
          <Select value={hashStrategy} disabled={anyBusy} onValueChange={(value) => onHashStrategy(value as DuplicateHashStrategy)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DUPLICATE_HASH_LABEL) as DuplicateHashStrategy[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {DUPLICATE_HASH_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onAnalyze} disabled={analyzeDisabled} title={analyzeHint}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          {busy ? '正在分析' : '2. 分析重复'}
        </Button>
        <Button onClick={onExecute} disabled={executeDisabled} title={executeHint}>
          {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldQuestion className="h-4 w-4" />}
          3. 隔离选中{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </Button>
        {lastExecuteJobId ? (
          <Button
            variant="outline"
            onClick={onRollback}
            disabled={anyBusy}
            title="撤销上一次隔离：把文件从隔离区移回原位"
          >
            {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            回滚
          </Button>
        ) : null}
        {groups.length > 0 ? <Badge>{groups.length} 组 / {formatBytes(wasted)}</Badge> : null}
      </div>
      {analyzeBlockReason && groups.length === 0 && !busy ? (
        <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
          {analyzeBlockReason}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)]">
        <ScrollArea className="border-r p-2">
          {groups.length === 0 ? (
            <div className="space-y-1 px-3 py-8 text-center text-xs text-muted-foreground">
              <div>使用步骤：</div>
              <div>① 填入或选择要查重的目录（须已加入资料库）</div>
              <div>② 点「分析重复」，找出内容相同的文件</div>
              <div>③ 确认右侧表格勾选，点「隔离选中」移入隔离区</div>
              <div>隔离不是删除，可随时「回滚」恢复</div>
            </div>
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
