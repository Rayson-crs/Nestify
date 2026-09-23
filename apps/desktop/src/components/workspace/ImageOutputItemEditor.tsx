import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { baseName } from './merge-pane-shared'
import { ImageFrameEditor } from './ImageFrameEditor'

export function ImageOutputItemEditor({ merge }: { merge: MediaMergeController }) {
  const item = merge.selectedItem?.kind === 'image'
    ? merge.selectedItem
    : merge.items.find((entry) => entry.kind === 'image') ?? null
  if (!item) return null

  return (
    <section className="rounded-md border">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">单图画面微调</div>
          <div className="text-xs text-muted-foreground">修改后，上方合成预览会重新生成，最终导出使用相同参数。</div>
        </div>
        <div className="w-full space-y-1 sm:w-72">
          <Label className="text-xs" htmlFor="image-output-item">当前图片</Label>
          <Select
            value={item.id}
            disabled={merge.running}
            onValueChange={merge.setSelectedItemId}
          >
            <SelectTrigger id="image-output-item" aria-label="选择要微调的图片">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {merge.items.filter((entry) => entry.kind === 'image').map((entry, index) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {index + 1}. {baseName(entry.path)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="p-3">
        <ImageFrameEditor
          item={item}
          canvasWidth={merge.imageSettings.format === 'gif' ? merge.imageSettings.gifWidth ?? 1080 : merge.imageSettings.width}
          canvasHeight={merge.imageSettings.format === 'gif' ? merge.imageSettings.gifHeight ?? 1080 : merge.imageSettings.height ?? 1080}
          disabled={merge.running}
          compact
          showDuration={merge.imageSettings.format === 'gif'}
          defaultDuration={merge.imageSettings.gifFrameDurationSeconds ?? 3}
          onFrameFit={merge.updateItemFrameFit}
          onRotation={merge.updateItemRotation}
          onScale={merge.updateItemFrameScale}
          onFocus={merge.updateItemFrameFocus}
          onDuration={(itemId, seconds) => merge.updateImageClip(itemId, { imageDurationSeconds: seconds })}
        />
      </div>
    </section>
  )
}
