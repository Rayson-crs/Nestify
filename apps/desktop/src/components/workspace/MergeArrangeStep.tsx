import { useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Film,
  GripVertical,
  Images,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { formatBytes } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { baseName } from './merge-pane-shared'
import { MergeOrderDialog } from './MergeOrderDialog'
import { VideoTrimEditor } from './VideoTrimEditor'
import { ImagePreview } from './ImagePreview'
import { ImageClipControls } from './ImageClipControls'

export function MergeArrangeStep({
  merge,
  ipcReady,
  customTrimCount,
  manualOrderCount,
}: {
  merge: MediaMergeController
  ipcReady: boolean
  customTrimCount: number
  manualOrderCount: number
}) {
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [dropTargetItemId, setDropTargetItemId] = useState<string | null>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <MergeOrderDialog
        profile={merge.orderProfile}
        disabled={merge.running}
        onChange={merge.setOrderCriteria}
        onMove={merge.reorderOrderCriteria}
      />
        <Button
          variant="outline"
          disabled={merge.running || manualOrderCount === 0}
          onClick={merge.clearManualOrder}
        >
          <RotateCcw className="h-4 w-4" />
          清除手工钉选
        </Button>
        <Button
          variant="outline"
          disabled={!ipcReady || merge.running}
          onClick={() => void merge.selectFiles()}
        >
          <Plus className="h-4 w-4" />
          追加
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" disabled={merge.running} onClick={merge.goBack}>
            <ArrowLeft className="h-4 w-4" />
            上一步
          </Button>
          <Button disabled={!merge.canArrange || merge.running} onClick={() => void merge.goNext()}>
            下一步
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(300px,2fr)_minmax(360px,3fr)]">
        <div className="min-h-0 overflow-y-auto border-r">
          <div className="space-y-1 p-3">
            {[...merge.items]
              .sort((left, right) => left.orderIndex - right.orderIndex || left.path.localeCompare(right.path))
              .map((item, index) => (
              <div
                key={item.id}
                draggable={!merge.running}
                onDragStart={(event) => {
                  setDraggingItemId(item.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', item.id)
                }}
                onDragOver={(event) => {
                  if (!draggingItemId || draggingItemId === item.id) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTargetItemId(item.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const source = draggingItemId ?? event.dataTransfer.getData('text/plain')
                  if (source) merge.moveItemTo(source, item.id)
                  setDraggingItemId(null)
                  setDropTargetItemId(null)
                }}
                onDragEnd={() => {
                  setDraggingItemId(null)
                  setDropTargetItemId(null)
                }}
                className={cn(
                  'flex w-full min-h-14 items-center gap-2 rounded-md border px-2 py-2 transition-colors',
                  item.id === merge.selectedItemId
                    ? 'border-primary/50 bg-primary/5'
                    : 'bg-background hover:bg-muted/50',
                  merge.running && 'cursor-default opacity-80',
                  draggingItemId === item.id && 'opacity-60',
                  dropTargetItemId === item.id && draggingItemId !== item.id && 'border-primary',
                )}
              >
                <GripVertical
                  className={cn('h-4 w-4 shrink-0 text-muted-foreground', merge.running ? 'opacity-40' : 'cursor-grab')}
                  aria-hidden
                />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => merge.setSelectedItemId(item.id)}
                >
                  <span className="w-6 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
                  {item.kind === 'image' ? (
                    <Images className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" title={item.path}>{baseName(item.path)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatBytes(item.size)}
                      {item.kind === 'video' && item.trimSource === 'custom' ? ' · 自定义裁剪' : ''}
                      {item.manualOrder ? ' · 手工钉选' : ''}
                    </span>
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    title="上移"
                    disabled={merge.running || index === 0}
                    onClick={() => merge.moveItem(item.id, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="下移"
                    disabled={merge.running || index === merge.items.length - 1}
                    onClick={() => merge.moveItem(item.id, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="移除"
                    disabled={merge.running}
                    onClick={() => merge.removeItem(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 overflow-hidden">
          {merge.selectedItem?.kind === 'video' ? (
            <VideoTrimEditor
              item={merge.selectedItem}
              items={merge.items}
              ipcReady={ipcReady}
              disabled={merge.running}
              batchTrimStart={merge.batchTrimStart}
              batchTrimEnd={merge.batchTrimEnd}
              onBatchTrimStart={merge.setBatchTrimStart}
              onBatchTrimEnd={merge.setBatchTrimEnd}
              onApplyBatch={merge.applyBatchTrim}
              onTrim={merge.updateItemTrim}
              onResetTrim={merge.resetItemTrim}
              onAudioChange={merge.updateItemAudio}
              customTrimCount={customTrimCount}
            />
          ) : merge.selectedItem ? (
            merge.kind === 'video' ? (
              <ImageClipControls
                item={merge.selectedItem}
                disabled={merge.running}
                onChange={merge.updateImageClip}
              />
            ) : (
              <ImagePreview
                item={merge.selectedItem}
                items={merge.items}
                ipcReady={ipcReady}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              请选择一个文件
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
