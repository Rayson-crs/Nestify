import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { HintLabel } from './FieldHint'

export function ImageOutputSettings({ merge }: { merge: MediaMergeController }) {
  const settings = merge.imageSettings
  const animated = settings.format === 'gif'
  const layout = settings.layout ?? 'vertical'

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {!animated ? (
        <div className="space-y-1">
          <Label><HintLabel label="布局" hint="纵向长图从上到下接。横向长图从左到右接。网格按列数逐行排列，不够一行的留在最后。" /></Label>
          <Select value={layout} disabled={merge.running} onValueChange={(value) => merge.setImageSettings({ layout: value as 'vertical' | 'horizontal' | 'grid' })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vertical">纵向长图</SelectItem>
              <SelectItem value="horizontal">横向长图</SelectItem>
              <SelectItem value="grid">网格拼图</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label><HintLabel label="格式" hint="JPG 体积小但不保留透明；PNG 保留完整透明；WebP 兼顾体积和透明；GIF 将图片按顺序生成可循环播放的动图。" /></Label>
        <Select value={settings.format} disabled={merge.running} onValueChange={(value) => merge.setImageSettings({ format: value as 'jpg' | 'png' | 'webp' | 'gif' })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="jpg">JPG</SelectItem>
            <SelectItem value="png">PNG</SelectItem>
            <SelectItem value="webp">WebP</SelectItem>
            <SelectItem value="gif">GIF 动图</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {animated ? <GifSettings merge={merge} /> : <StaticImageSettings merge={merge} layout={layout} />}

      <div className="space-y-1">
        <Label>
          <HintLabel
            label="背景"
            hint="白色会填补画布空白和透明区域。透明背景可由 PNG、WebP 和 GIF 保留；GIF 的透明为调色板透明，半透明边缘可能出现轻微锯齿。JPG 始终输出白底。"
          />
        </Label>
        <Select value={settings.background} disabled={merge.running} onValueChange={(value) => merge.setImageSettings({ background: value as 'white' | 'transparent' })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="white">白色</SelectItem>
            <SelectItem value="transparent">透明</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function GifSettings({ merge }: { merge: MediaMergeController }) {
  const settings = merge.imageSettings
  return (
    <>
      <NumberField label="GIF 画布宽度" hint="每一帧的固定宽度，范围 16 到 8192 像素。所有图片按各自的旋转、填充、缩放和焦点放入这个画布。" value={settings.gifWidth ?? 1080} min={16} max={8192} disabled={merge.running} onChange={(gifWidth) => merge.setImageSettings({ gifWidth })} />
      <NumberField label="GIF 画布高度" hint="每一帧的固定高度，范围 16 到 8192 像素。画布不会随图片方向变化。" value={settings.gifHeight ?? 1080} min={16} max={8192} disabled={merge.running} onChange={(gifHeight) => merge.setImageSettings({ gifHeight })} />
      <NumberField label="默认停留秒数" hint="未单独设置的图片使用这个时长，范围 0.1 到 120 秒。单图时长可在第二步或右侧单图微调中覆盖。" value={settings.gifFrameDurationSeconds ?? 3} min={0.1} max={120} step={0.1} disabled={merge.running} onChange={(gifFrameDurationSeconds) => merge.setImageSettings({ gifFrameDurationSeconds })} />
      <NumberField label="循环次数" hint="0 表示无限循环；1 表示播放一轮后停止。最大 65535 次。" value={settings.gifLoopCount ?? 0} min={0} max={65535} step={1} disabled={merge.running} onChange={(gifLoopCount) => merge.setImageSettings({ gifLoopCount })} />
    </>
  )
}

function StaticImageSettings({ merge, layout }: { merge: MediaMergeController; layout: 'vertical' | 'horizontal' | 'grid' }) {
  const settings = merge.imageSettings
  return (
    <>
      <NumberField
        label={layout === 'horizontal' ? '统一高度' : '统一宽度'}
        hint={layout === 'horizontal' ? '横向拼接时每张图都缩放到这个高度，宽度按原比例变化。范围 16 到 8192 像素。' : '纵向和网格拼接时每张图都缩放到这个宽度，高度按原比例变化。范围 16 到 8192 像素。'}
        value={layout === 'horizontal' ? settings.height ?? 1080 : settings.width}
        min={16}
        max={8192}
        disabled={merge.running}
        onChange={(value) => merge.setImageSettings(layout === 'horizontal' ? { height: value } : { width: value })}
      />
      {layout === 'grid' ? <NumberField label="网格列数" hint="一行放几张图，1 到 8 列。排不满的最后一行靠左留空。" value={settings.columns ?? 2} min={1} max={8} disabled={merge.running} onChange={(columns) => merge.setImageSettings({ columns })} /> : null}
      <NumberField label="图片间距" hint="相邻图片之间的空隙，0 到 128 像素。空隙颜色跟随背景设置。" value={settings.gap} min={0} max={128} disabled={merge.running} onChange={(gap) => merge.setImageSettings({ gap })} />
    </>
  )
}

function NumberField({ label, hint, value, min, max, step, disabled, onChange }: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step?: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1">
      <Label><HintLabel label={label} hint={hint} /></Label>
      <Input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}
