import { ArrowRight, Film, Images, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { formatBytes, formatTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { baseName } from './merge-pane-shared'

export function MergePickStep({
  merge,
  ipcReady,
}: {
  merge: MediaMergeController
  ipcReady: boolean
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button
          disabled={!ipcReady || merge.busy || merge.running}
          onClick={() => void merge.selectFiles()}
        >
          {merge.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          添加图片 / 视频
        </Button>
        <span className="text-xs text-muted-foreground">
          支持多选；已选 {merge.items.length} 个文件
        </span>
        <Button
          className="ml-auto"
          disabled={!merge.canArrange || merge.running}
          onClick={() => void merge.goNext()}
        >
          下一步
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {merge.items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-lg space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Images className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">选择要合并的媒体</div>
              <div className="text-xs text-muted-foreground">
                先选图片时做长图，不能再加入视频。先选视频时做拼接，可以加入图片，图片按停留时长出现。
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-3">
            {merge.items.map((item, index) => (
              <div
                key={item.id}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-md border px-3 py-2',
                  item.kind === merge.kind ? 'bg-background' : 'bg-destructive/5',
                )}
              >
                <span className="w-6 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
                {item.kind === 'image' ? (
                  <Images className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" title={item.path}>{baseName(item.path)}</div>
                  <div className="truncate text-xs text-muted-foreground" title={item.path}>
                    {formatBytes(item.size)} · {formatTime(item.mtime)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  title="移除"
                  disabled={merge.running}
                  onClick={() => merge.removeItem(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
