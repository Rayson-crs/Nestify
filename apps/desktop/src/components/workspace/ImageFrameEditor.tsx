import { useEffect, useState } from 'react'
import { Images, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { MediaMergeFrameFit, MediaMergeItem, MediaMergeItemRotation } from '@/lib/ipc'
import { baseName } from './merge-pane-shared'
import { ItemFrameFields } from './ItemFrameFields'
import {
  mediaContentStyle,
  mediaFrameBoxStyle,
  mediaFrameSize,
  mediaScaleLayerStyle,
  useMediaPreviewCanvasRatio,
} from './media-frame-preview'

export function ImageFrameEditor({
  item,
  canvasWidth,
  canvasHeight,
  disabled,
  compact = false,
  showDuration = false,
  defaultDuration = 3,
  onFrameFit,
  onRotation,
  onScale,
  onFocus,
  onDuration,
}: {
  item: MediaMergeItem
  canvasWidth: number
  canvasHeight: number
  disabled: boolean
  compact?: boolean
  showDuration?: boolean
  defaultDuration?: number
  onFrameFit: (itemId: string, frameFit: MediaMergeFrameFit | null) => void
  onRotation: (itemId: string, rotation: MediaMergeItemRotation) => void
  onScale: (itemId: string, scalePercent: number) => void
  onFocus: (itemId: string, focusX: number, focusY: number) => void
  onDuration?: (itemId: string, seconds: number) => void
}) {
  const rotation = item.rotation ?? 'none'
  const frameFit = item.frameFit ?? 'contain'
  const aspectRatio = positive(canvasWidth, 1080) / positive(canvasHeight, 1080)
  const previewCanvas = useMediaPreviewCanvasRatio(aspectRatio)
  const frameSize = mediaFrameSize(rotation, previewCanvas.size)
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => setMediaSize(null), [item.id])

  return (
    <div className={compact ? 'space-y-3' : 'flex h-full min-h-0 flex-col'}>
      {!compact ? (
        <div className="border-b px-3 py-2">
          <div className="truncate text-sm font-medium" title={item.path}>{baseName(item.path)}</div>
          <div className="text-xs text-muted-foreground">单图画面调整 · 预览与最终导出使用同一组参数</div>
        </div>
      ) : null}
      <div className={compact ? 'space-y-3' : 'min-h-0 flex-1 space-y-4 overflow-auto p-3'}>
        <div
          ref={previewCanvas.ref}
          className="relative mx-auto max-h-[360px] w-full overflow-hidden rounded-md bg-black"
          style={{ aspectRatio, ...previewCanvas.fullscreenStyle }}
        >
          <div style={mediaFrameBoxStyle(rotation, previewCanvas.size)}>
            <div style={mediaScaleLayerStyle()}>
              <img
                src={imageSource(item.path)}
                alt={baseName(item.path)}
                style={mediaContentStyle(
                  frameFit,
                  frameSize,
                  mediaSize,
                  item.frameScalePercent,
                  item.frameFocusX,
                  item.frameFocusY,
                )}
                onLoad={(event) => {
                  const image = event.currentTarget
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setMediaSize({ width: image.naturalWidth, height: image.naturalHeight })
                  }
                }}
              />
            </div>
          </div>
          {!mediaSize ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/70">
              <Images className="mr-2 h-4 w-4" />
              正在读取图片
            </div>
          ) : null}
          <Button
            className="absolute bottom-2 right-2"
            variant="outline"
            size="icon"
            title={previewCanvas.isFullscreen ? '退出全屏' : '全屏预览'}
            aria-label={previewCanvas.isFullscreen ? '退出全屏' : '全屏预览'}
            onClick={() => void previewCanvas.toggleFullscreen()}
          >
            {previewCanvas.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
        <ItemFrameFields
          item={item}
          disabled={disabled}
          onFrameFit={(fit) => onFrameFit(item.id, fit)}
          onRotation={(value) => onRotation(item.id, value)}
          onScale={(value) => onScale(item.id, value)}
          onFocus={(focusX, focusY) => onFocus(item.id, focusX, focusY)}
        />
        {showDuration && onDuration ? (
          <div className="space-y-1 rounded-md border p-3">
            <Label className="text-xs" htmlFor={`image-duration-${item.id}`}>当前图片停留秒数</Label>
            <Input
              id={`image-duration-${item.id}`}
              type="number"
              min={0.1}
              max={120}
              step={0.1}
              value={item.imageClipSource === 'custom' ? item.imageDurationSeconds ?? defaultDuration : defaultDuration}
              disabled={disabled}
              onChange={(event) => onDuration(item.id, Number(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">只覆盖这一张图；其他图片继续使用 GIF 默认停留时间。</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function imageSource(path: string): string {
  return `nestify-media://preview/?path=${encodeURIComponent(path)}`
}
