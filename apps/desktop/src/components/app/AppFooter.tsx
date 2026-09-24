import { Progress } from '@/components/ui/progress'
import type { ExecutionProgress, LibraryRemovalProgress, ScanProgress } from '@/lib/ipc'
import type { FileOperationProgress } from '@/app/types'

export function AppFooter({
  scan,
  scanPhaseLabel,
  scanPercentDisplay,
  scanCompleted,
  scanning,
  searchElapsed,
  hitTotal,
  executeProgress,
  removalProgress,
  fileOperationProgress,
}: {
  scan: ScanProgress
  scanPhaseLabel: string
  scanPercentDisplay: number | null
  scanCompleted: boolean
  scanning: boolean
  searchElapsed: number | null
  hitTotal: number
  executeProgress: ExecutionProgress | null
  removalProgress: LibraryRemovalProgress | null
  fileOperationProgress: FileOperationProgress | null
}) {
  if (removalProgress) {
    const percent = removalProgress.total > 0 ? Math.min(100, (removalProgress.current / removalProgress.total) * 100) : 0
    return (
      <footer className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground" role="status" aria-live="polite">
        <span className="w-16 shrink-0">移除资料库</span>
        <Progress value={percent} className="w-40" indicatorClassName={removalProgress.status === 'failed' ? 'bg-destructive' : undefined} />
        <span className="w-10 text-right">{Math.round(percent)}%</span>
        <span className="max-w-52 truncate" title={removalProgress.libraryName}>{removalProgress.libraryName}</span>
        <span className="shrink-0">{removalProgress.current} / {removalProgress.total}</span>
        <span className="min-w-0 flex-1 truncate" title={removalProgress.stage}>{removalProgress.stage}</span>
      </footer>
    )
  }
  if (fileOperationProgress) {
    const percent = fileOperationProgress.percent
    const operation = fileOperationProgress.operation === 'rename' ? '重命名' : fileOperationProgress.operation === 'move' ? '移动' : '删除'
    return (
      <footer className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground" role="status" aria-live="polite">
        <span className="w-16 shrink-0">文件操作</span>
        <Progress
          value={percent}
          className="w-40"
          indicatorClassName={fileOperationProgress.status === 'failed' ? 'bg-destructive' : undefined}
        />
        <span className="w-10 text-right">{Math.round(percent)}%</span>
        <span className="shrink-0">{operation}</span>
        <span className="min-w-0 flex-1 truncate" title={fileOperationProgress.path}>{fileOperationProgress.stage}</span>
        {searchElapsed != null ? <span>搜索 {searchElapsed}ms / {hitTotal}</span> : null}
      </footer>
    )
  }
  if (executeProgress) {
    const percent = executeProgress.total > 0 ? (executeProgress.current / executeProgress.total) * 100 : 100
    return (
      <footer className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
        <span className="w-16">执行中</span>
        <Progress value={percent} className="w-40" />
        <span className="w-10 text-right">{Math.round(percent)}%</span>
        <span>当前 {executeProgress.current}</span>
        <span>总数 {executeProgress.total}</span>
        <span>成功 {executeProgress.ok}</span>
        {executeProgress.failed ? <span className="text-destructive">失败 {executeProgress.failed}</span> : null}
        <span className="min-w-0 flex-1 truncate" title={executeProgress.path ?? undefined}>{executeProgress.path || '正在准备…'}</span>
        {searchElapsed != null ? <span>搜索 {searchElapsed}ms / {hitTotal}</span> : null}
      </footer>
    )
  }
  return (
    <footer className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
      <span className="w-16">{scanPhaseLabel}</span>
      <Progress
        value={scanPercentDisplay}
        className="w-40"
        indeterminate={scanning && !scanCompleted}
        indicatorClassName={scanCompleted ? 'bg-green-600' : undefined}
      />
      <span className="w-10 text-right">{scanPercentDisplay == null ? '--' : `${Math.round(scanPercentDisplay)}%`}</span>
      <span>文件 {scan.filesScanned}</span>
      <span>目录 {scan.dirsScanned}</span>
      {scan.filesPerSecond ? <span>{Math.round(scan.filesPerSecond)}/s</span> : null}
      {scan.errors ? <span className="text-destructive">错误 {scan.errors}</span> : null}
      <span className="min-w-0 flex-1 truncate">{scan.currentPath || '就绪'}</span>
      {searchElapsed != null ? <span>搜索 {searchElapsed}ms / {hitTotal}</span> : null}
    </footer>
  )
}
