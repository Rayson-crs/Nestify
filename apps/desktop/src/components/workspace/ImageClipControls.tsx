import { useEffect, useState } from 'react'
import { Images, Maximize2, Minimize2, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { HintLabel } from './FieldHint'
import type { MediaMergeImageMotion, MediaMergeItem } from '@/lib/ipc'
import { baseName } from './merge-pane-shared'
import type { MediaMergeFrameFit, MediaMergeItemRotation } from '@/lib/ipc'
import { ItemFrameFields } from './ItemFrameFields'
import { mediaContentStyle, mediaFrameBoxStyle, mediaFrameSize, mediaScaleLayerStyle, useMediaPreviewCanvasRatio } from './media-frame-preview'
import { imageMotionStyle } from './video-sequence'
import { MediaMotionField, mediaMotionLabel } from './MediaMotionField'

export function ImageClipControls({
  item,
  canvasWidth,
  canvasHeight,
  disabled,
  onChange,
  onFrameFit,
  onRotation,
  onScale,
  onFocus,
}: {
  item: MediaMergeItem
  canvasWidth: number
  canvasHeight: number
  disabled: boolean
  onChange: (itemId: string, patch: { imageDurationSeconds?: number; imageMotion?: MediaMergeImageMotion }) => void
  onFrameFit: (itemId: string, frameFit: MediaMergeFrameFit | null) => void
  onRotation: (itemId: string, rotation: MediaMergeItemRotation) => void
  onScale: (itemId: string, scalePercent: number) => void
  onFocus: (itemId: string, focusX: number, focusY: number) => void
}) {
  const duration = item.imageDurationSeconds ?? 3
  const motion = item.imageMotion ?? 'still'
  const frameFit = item.frameFit ?? 'contain'
  const rotation = item.rotation ?? 'none'
  const [playing, setPlaying] = useState(true)
  const [progress, setProgress] = useState(0)
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(null)
  const aspectRatio = Math.max(1, canvasWidth) / Math.max(1, canvasHeight)
  const previewCanvas = useMediaPreviewCanvasRatio(aspectRatio)
  const frameSize = mediaFrameSize(rotation, previewCanvas.size)

  useEffect(() => {
    setProgress(0)
    setMediaSize(null)
  }, [item.id, duration, motion])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const started = performance.now()
    const tick = () => {
      const elapsed = (performance.now() - started) / 1000
      setProgress((elapsed % Math.max(duration, 0.2)) / Math.max(duration, 0.2))
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [duration, playing])

  const motionStyle = imageMotionStyle(motion, progress, duration)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <div className="truncate text-sm font-medium" title={item.path}>{baseName(item.path)}</div>
        <div className="text-xs text-muted-foreground">视频中的图片片段 · 停留 {duration.toFixed(1)} 秒 · {mediaMotionLabel(motion)}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        <div ref={previewCanvas.ref} className="relative mx-auto max-h-[360px] w-full overflow-hidden rounded-md bg-black" style={{ aspectRatio, ...previewCanvas.fullscreenStyle }}>
          <div style={mediaFrameBoxStyle(rotation, previewCanvas.size)}>
            <div style={mediaScaleLayerStyle()}>
              <img
                style={{ ...mediaContentStyle(frameFit, frameSize, mediaSize, item.frameScalePercent, item.frameFocusX, item.frameFocusY), ...motionStyle }}
                src={imageSource(item.path)}
                alt=""
                onLoad={(event) => {
                  const image = event.currentTarget
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setMediaSize({ width: image.naturalWidth, height: image.naturalHeight })
                  }
                }}
              />
            </div>
          </div>
          <Button
            className="absolute bottom-2 left-2"
            variant="outline"
            size="icon"
            title={playing ? "暂停" : "播放"}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
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
          onRotation={(rotation) => onRotation(item.id, rotation)}
          onScale={(scale) => onScale(item.id, scale)}
          onFocus={(focusX, focusY) => onFocus(item.id, focusX, focusY)}
        />
        <section className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Images className="h-4 w-4" />
            画面动效与停留
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">
                <HintLabel label="停留秒数" hint="这张图片在视频成片里停留的时间，范围 0.1 到 120 秒。只影响当前图片，不会改动其他图片。" />
              </Label>
              <Input
                type="number"
                min={0.1}
                max={120}
                step={0.1}
                value={duration}
                disabled={disabled}
                onChange={(event) => onChange(item.id, { imageDurationSeconds: Number(event.target.value) })}
              />
            </div>
            <MediaMotionField
              value={motion}
              disabled={disabled}
              onChange={(value) => onChange(item.id, { imageMotion: value })}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">图片按黑底居中放入视频，没有声音。停留时长只影响这一张图。</p>
        </section>
      </div>
    </div>
  )
}

function imageSource(path: string): string {
  return `nestify-media://preview/?path=${encodeURIComponent(path)}`
}
