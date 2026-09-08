import { Progress } from '@/components/ui/progress'
import type { ScanProgress } from '@/lib/ipc'

export function AppFooter({
  scan,
  scanPhaseLabel,
  scanPercentDisplay,
  scanCompleted,
  searchElapsed,
  hitTotal,
}: {
  scan: ScanProgress
  scanPhaseLabel: string
  scanPercentDisplay: number
  scanCompleted: boolean
  searchElapsed: number | null
  hitTotal: number
}) {
  return (
    <footer className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
      <span className="w-16">{scanPhaseLabel}</span>
      <Progress
        value={scanPercentDisplay}
        className="w-40"
        indicatorClassName={scanCompleted ? 'bg-green-600' : undefined}
      />
      <span className="w-10 text-right">{Math.round(scanPercentDisplay)}%</span>
      <span>文件 {scan.filesScanned}</span>
      <span>目录 {scan.dirsScanned}</span>
      {scan.filesPerSecond ? <span>{Math.round(scan.filesPerSecond)}/s</span> : null}
      {scan.errors ? <span className="text-destructive">错误 {scan.errors}</span> : null}
      <span className="min-w-0 flex-1 truncate">{scan.currentPath || '就绪'}</span>
      {searchElapsed != null ? <span>搜索 {searchElapsed}ms / {hitTotal}</span> : null}
    </footer>
  )
}
