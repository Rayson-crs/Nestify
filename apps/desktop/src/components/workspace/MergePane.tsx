import { TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { cn } from '@/lib/utils'
import { MergeArrangeStep } from './MergeArrangeStep'
import { MergeOutputStep } from './MergeOutputStep'
import { MergePickStep } from './MergePickStep'
import { STEP_LABELS } from './merge-pane-shared'

export function MergePane({
  merge,
  ipcReady,
}: {
  merge: MediaMergeController
  ipcReady: boolean
}) {
  const stepIndex = STEP_LABELS.findIndex((item) => item.step === merge.step)
  const customTrimCount = merge.items.filter((item) => item.trimSource === 'custom').length
  const manualOrderCount = merge.items.filter((item) => item.manualOrder).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {STEP_LABELS.map((item, index) => (
          <div key={item.step} className="flex items-center gap-2">
            {index > 0 ? <Separator className="w-4" /> : null}
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-xs',
                item.step === merge.step
                  ? 'bg-primary/10 font-medium text-primary'
                  : index < stepIndex
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/60',
              )}
            >
              {item.step} {item.title}
            </span>
          </div>
        ))}
        <Badge variant="outline" className="ml-auto">
          {merge.kind === 'image' ? '图片长图' : merge.kind === 'video' ? '视频拼接' : '待选择'}
        </Badge>
        {merge.kind === 'video' ? (
          <Badge variant={customTrimCount > 0 ? 'default' : 'outline'}>
            自定义裁剪 {customTrimCount}
          </Badge>
        ) : null}
      </div>

      {merge.hasMixedMedia ? (
        <div className="flex items-center gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          图片合并不能加入视频。请先移除视频，或改用视频合并。
        </div>
      ) : null}

      {merge.step === 1 ? (
        <MergePickStep merge={merge} ipcReady={ipcReady} />
      ) : null}
      {merge.step === 2 ? (
        <MergeArrangeStep
          merge={merge}
          ipcReady={ipcReady}
          customTrimCount={customTrimCount}
          manualOrderCount={manualOrderCount}
        />
      ) : null}
      {merge.step === 3 ? (
        <MergeOutputStep merge={merge} />
      ) : null}
    </div>
  )
}
