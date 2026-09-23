import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MediaMergeImageMotion } from '@/lib/ipc'
import { HintLabel } from './FieldHint'

export const MEDIA_MOTION_OPTIONS: Array<{ value: MediaMergeImageMotion; label: string }> = [
  { value: 'still', label: '无动效' },
  { value: 'fade', label: '淡入淡出' },
  { value: 'zoom-in', label: '缓慢放大' },
  { value: 'zoom-out', label: '缓慢缩小' },
  { value: 'pan-left', label: '从左向右' },
  { value: 'pan-right', label: '从右向左' },
]

export function MediaMotionField({
  value,
  disabled,
  onChange,
}: {
  value: MediaMergeImageMotion | undefined
  disabled: boolean
  onChange: (value: MediaMergeImageMotion) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        <HintLabel
          label="画面动效"
          hint="只作用于当前片段。无动效保持原画面；淡入淡出控制片段首尾透明度；缓慢放大、缩小和左右平移会在片段播放期间连续改变画面。使用动效时输出会重新编码。"
        />
      </Label>
      <Select value={value ?? 'still'} disabled={disabled} onValueChange={(next) => onChange(next as MediaMergeImageMotion)}>
        <SelectTrigger aria-label="画面动效">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MEDIA_MOTION_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function mediaMotionLabel(value: MediaMergeImageMotion | undefined): string {
  return MEDIA_MOTION_OPTIONS.find((option) => option.value === value)?.label ?? '无动效'
}
