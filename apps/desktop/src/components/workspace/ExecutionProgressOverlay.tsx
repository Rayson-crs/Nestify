import { Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import type { ExecutionProgress } from '@/lib/ipc'

const MODULE_LABEL: Record<ExecutionProgress['module'], string> = {
  organize: '正在执行整理',
  rename: '正在执行改名',
  duplicates: '正在处理重复文件',
  rules: '正在执行规则',
}

export function ExecutionProgressOverlay({ progress }: { progress: ExecutionProgress }) {
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 100
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/90 p-6 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md space-y-4 rounded-md border bg-background p-5 shadow-lg">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>{MODULE_LABEL[progress.module]}</span>
        </div>
        <Progress value={percent} className="h-2.5" />
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>已处理 {progress.current} / {progress.total}</span>
          <span className="font-medium text-foreground">{Math.round(percent)}%</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>成功 {progress.ok} · 跳过 {progress.skipped} · 失败 {progress.failed}</span>
          <span className="min-w-0 truncate" title={progress.path ?? undefined}>{progress.path ?? '正在准备…'}</span>
        </div>
        <div className="text-xs text-muted-foreground">执行期间当前模块暂不可操作，请等待完成。</div>
      </div>
    </div>
  )
}
