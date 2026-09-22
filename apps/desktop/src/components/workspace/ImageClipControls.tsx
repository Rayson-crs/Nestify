import { Images } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MediaMergeImageMotion, MediaMergeItem } from '@/lib/ipc'
import { baseName } from './merge-pane-shared'

export const IMAGE_MOTION_OPTIONS: Array<{ value: MediaMergeImageMotion; label: string }> = [
  { value: 'still', label: '静止' },
  { value: 'fade', label: '淡入淡出' },
  { value: 'zoom-in', label: '缓慢放大' },
  { value: 'zoom-out', label: '缓慢缩小' },
  { value: 'pan-left', label: '从左向右' },
  { value: 'pan-right', label: '从右向左' },
]

export function ImageClipControls({
  item,
  disabled,
  onChange,
}: {
  item: MediaMergeItem
  disabled: boolean
  onChange: (itemId: string, patch: { imageDurationSeconds?: number; imageMotion?: MediaMergeImageMotion }) => void
}) {
  const duration = item.imageDurationSeconds ?? 3
  const motion = item.imageMotion ?? 'still'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <div className="truncate text-sm font-medium" title={item.path}>{baseName(item.path)}</div>
        <div className="text-xs text-muted-foreground">图片片段 · 停留 {duration.toFixed(1)} 秒 · {motionLabel(motion)}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-black text-white/70">
          <img className="max-h-full max-w-full object-contain" src={imageSource(item.path)} alt="" />
        </div>
        <section className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Images className="h-4 w-4" />
            图片出现方式
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">停留秒数</Label>
              <Input
                type="number"
                min={0.2}
                max={120}
                step={0.1}
                value={duration}
                disabled={disabled}
                onChange={(event) => onChange(item.id, { imageDurationSeconds: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">画面</Label>
              <Select value={motion} disabled={disabled} onValueChange={(value) => onChange(item.id, { imageMotion: value as MediaMergeImageMotion })}>
                <SelectTrigger aria-label="图片出现方式"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMAGE_MOTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">图片按黑底居中放入视频，没有声音。停留时长只影响这一张图。</p>
        </section>
      </div>
    </div>
  )
}

function motionLabel(motion: MediaMergeImageMotion): string {
  return IMAGE_MOTION_OPTIONS.find((option) => option.value === motion)?.label ?? '静止'
}

function imageSource(path: string): string {
  return `nestify-media://preview/?path=${encodeURIComponent(path)}`
}
