import { Volume2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { HintLabel } from './FieldHint'
import type { MediaMergeItem } from '@/lib/ipc'

export type MediaMergeAudioPatch = Partial<Pick<
  MediaMergeItem,
  'volume' | 'muted' | 'audioFadeInSeconds' | 'audioFadeOutSeconds'
>>

export function VideoAudioControls({
  item,
  disabled,
  duration,
  onChange,
}: {
  item: MediaMergeItem
  disabled: boolean
  duration: number
  onChange: (itemId: string, patch: MediaMergeAudioPatch) => void
}) {
  const volume = item.volume ?? 1
  const fadeIn = item.audioFadeInSeconds ?? 0
  const fadeOut = item.audioFadeOutSeconds ?? 0
  const fadeTotal = fadeIn + fadeOut
  const fadeInvalid = duration > 0 && fadeTotal > duration

  return (
    <section className="mt-4 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Volume2 className="h-4 w-4" />
          当前素材音频
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={item.muted === true}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(item.id, { muted: checked })}
          />
          静音
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">
            <HintLabel label="音量倍数" hint="1 为原音量，0 为无声，最大 4 倍。只作用于当前素材，静音后此项不再生效。" />
          </Label>
          <Input
            type="number"
            min={0}
            max={4}
            step={0.1}
            value={volume}
            disabled={disabled || item.muted === true}
            onChange={(event) => onChange(item.id, { volume: Number(event.target.value) })}
          />
          <input
            type="range"
            aria-label="当前素材音量"
            min={0}
            max={4}
            step={0.1}
            value={volume}
            disabled={disabled || item.muted === true}
            className="h-6 w-full"
            onChange={(event) => onChange(item.id, { volume: Number(event.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <HintLabel label="淡入秒数" hint="当前素材开头的声音从无声逐渐升到设定音量。淡入加淡出不能超过这条素材裁剪后的时长。" />
          </Label>
          <Input
            type="number"
            min={0}
            max={30}
            step={0.1}
            value={fadeIn}
            disabled={disabled || item.muted === true}
            onChange={(event) => onChange(item.id, { audioFadeInSeconds: Number(event.target.value) })}
          />
          <input
            type="range"
            aria-label="当前素材音频淡入"
            min={0}
            max={Math.max(0.1, duration || 30)}
            step={0.1}
            value={fadeIn}
            disabled={disabled || item.muted === true}
            className="h-6 w-full"
            onChange={(event) => onChange(item.id, { audioFadeInSeconds: Number(event.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <HintLabel label="淡出秒数" hint="当前素材结尾的声音逐渐降到无声。淡入加淡出不能超过这条素材裁剪后的时长。" />
          </Label>
          <Input
            type="number"
            min={0}
            max={30}
            step={0.1}
            value={fadeOut}
            disabled={disabled || item.muted === true}
            onChange={(event) => onChange(item.id, { audioFadeOutSeconds: Number(event.target.value) })}
          />
          <input
            type="range"
            aria-label="当前素材音频淡出"
            min={0}
            max={Math.max(0.1, duration || 30)}
            step={0.1}
            value={fadeOut}
            disabled={disabled || item.muted === true}
            className="h-6 w-full"
            onChange={(event) => onChange(item.id, { audioFadeOutSeconds: Number(event.target.value) })}
          />
        </div>
      </div>
      <p className={`mt-2 text-xs ${fadeInvalid ? 'text-destructive' : 'text-muted-foreground'}`}>
        淡入 + 淡出不能超过当前素材裁剪后时长{duration > 0 ? `（${duration.toFixed(1)} 秒）` : ''}。
      </p>
    </section>
  )
}
