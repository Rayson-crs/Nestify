import { Crosshair } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MediaMergeFrameFit, MediaMergeItem, MediaMergeItemRotation } from '@/lib/ipc'
import { HintLabel } from './FieldHint'

export function ItemFrameFields({
  item,
  disabled,
  onFrameFit,
  onRotation,
  onScale,
  onFocus,
}: {
  item: MediaMergeItem
  disabled: boolean
  onFrameFit: (frameFit: MediaMergeFrameFit) => void
  onRotation: (rotation: MediaMergeItemRotation) => void
  onScale: (scalePercent: number) => void
  onFocus: (focusX: number, focusY: number) => void
}) {
  const scalePercent = item.frameScalePercent ?? 100
  const focusX = item.frameFocusX ?? 50
  const focusY = item.frameFocusY ?? 50
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label className="text-xs">
          <HintLabel label="旋转" hint="只影响当前这一条。可保持原方向，或顺时针旋转 90 度、旋转 180 度、逆时针旋转 90 度。第二步预览、第三步拼接预览和最终导出都会应用。" />
        </Label>
        <Select value={item.rotation ?? 'none'} disabled={disabled} onValueChange={(value) => onRotation(value as MediaMergeItemRotation)}>
          <SelectTrigger aria-label="当前画面旋转"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">不旋转</SelectItem>
            <SelectItem value="clockwise-90">顺时针 90°</SelectItem>
            <SelectItem value="rotate-180">旋转 180°</SelectItem>
            <SelectItem value="counterclockwise-90">逆时针 90°</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <HintLabel label="填充" hint="只影响当前这一条。留白会完整显示并用黑边补齐，铺满会放大后裁掉超出画布的部分。导出时使用这里的选择。" />
        </Label>
        <Select value={item.frameFit ?? 'contain'} disabled={disabled} onValueChange={(value) => onFrameFit(value as MediaMergeFrameFit)}>
          <SelectTrigger aria-label="当前画面填充"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="contain">留白</SelectItem>
            <SelectItem value="cover">铺满</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">
            <HintLabel label="画面大小" hint="只影响当前素材。100% 保持填充结果；小于 100% 会缩小并居中，大于 100% 会放大并裁掉超出输出画布的部分。预览和最终导出都会应用。" />
          </Label>
          <Input
            className="h-7 w-20 text-right"
            type="number"
            min={25}
            max={300}
            step={5}
            value={scalePercent}
            disabled={disabled}
            aria-label="当前画面大小百分比"
            onChange={(event) => onScale(Number(event.target.value))}
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            className="h-6 min-w-0 flex-1 accent-primary"
            type="range"
            min={25}
            max={300}
            step={5}
            value={scalePercent}
            disabled={disabled}
            aria-label="调整当前画面大小"
            onChange={(event) => onScale(Number(event.target.value))}
          />
          <span className="w-12 text-right font-mono text-xs text-muted-foreground">{scalePercent}%</span>
        </div>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">
            <HintLabel label="画面焦点" hint="放大或铺满后用于选择最终保留的画面位置。水平 0% 偏左、100% 偏右；垂直 0% 偏上、100% 偏下。预览与最终导出保持一致。" />
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || (focusX === 50 && focusY === 50)}
            onClick={() => onFocus(50, 50)}
          >
            <Crosshair className="h-4 w-4" />
            居中
          </Button>
        </div>
        <FocusSlider label="水平" value={focusX} disabled={disabled} onChange={(value) => onFocus(value, focusY)} />
        <FocusSlider label="垂直" value={focusY} disabled={disabled} onChange={(value) => onFocus(focusX, value)} />
      </div>
    </div>
  )
}

function FocusSlider({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_3rem] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        className="h-6 min-w-0 accent-primary"
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={`${label}画面焦点`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="text-right font-mono text-xs text-muted-foreground">{value}%</span>
    </div>
  )
}
