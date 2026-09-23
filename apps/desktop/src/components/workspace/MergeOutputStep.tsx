import {
  ArrowLeft,
  CircleCheck,
  FolderOpen,
  Loader2,
  PackageOpen,
  TriangleAlert,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { PHASE_LABELS, formatDuration, imageLayoutLabel } from './merge-pane-shared'
import { ImageMergePreview } from './ImageMergePreview'
import { ImageOutputItemEditor } from './ImageOutputItemEditor'
import { ImageOutputSettings } from './ImageOutputSettings'
import { VideoSequencePreview } from './VideoSequencePreview'
import { VIDEO_OUTPUT_FORMATS } from './video-formats'
import { HintLabel } from './FieldHint'

const VIDEO_FIT_OPTIONS = [
  { value: 'largest', label: '按最大素材' },
  { value: 'first', label: '按第一条素材' },
  { value: 'limit-1080p', label: '限制在 1080p 以内' },
] as const

export function MergeOutputStep({ merge }: { merge: MediaMergeController }) {
  const completed = merge.progress?.status === 'completed'
  const failed = merge.progress?.status === 'failed'
  const cancelled = merge.progress?.status === 'cancelled'
  const transition = merge.videoSettings.transition ?? { type: 'none' as const, durationSeconds: 0 }
  const outputVolume = merge.videoSettings.outputVolume ?? 1
  const usesAudioControls = merge.items.some((item) =>
    (item.volume ?? 1) !== 1
    || item.muted === true
    || (item.audioFadeInSeconds ?? 0) > 0
    || (item.audioFadeOutSeconds ?? 0) > 0,
  )
  const streamCopyBlocked = merge.videoSettings.encodingMode === 'stream-copy'
    && (
      (transition.type === 'crossfade' && transition.durationSeconds > 0)
      || outputVolume !== 1
      || merge.videoSettings.audio === 'mute'
      || merge.videoSettings.loudnessNormalize === true
      || usesAudioControls
    )
  const extension = outputExtension(merge)
  const applyNameTemplate = (template: 'first' | 'count-date') => {
    const first = merge.items[0]?.path
    const stem = first ? fileStem(first) : 'nestify-merge'
    const count = merge.items.length
    const date = new Date().toISOString().slice(0, 10)
    const name = template === 'first' ? stem : `${stem}-${count}-${date}`
    merge.setOutputName(`${name}${extension}`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" disabled={merge.running} onClick={merge.goBack}>
          <ArrowLeft className="h-4 w-4" />
          上一步
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {merge.running ? (
            <Button variant="outline" disabled={merge.progress?.status === 'cancelling'} onClick={() => void merge.cancel()}>
              取消任务
            </Button>
          ) : (
            <Button disabled={!merge.canArrange || merge.busy} onClick={() => void merge.start()}>
              {merge.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              开始合并
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(280px,3fr)_minmax(0,7fr)]">
        <div className="min-h-0 space-y-4 overflow-auto border-r p-3">
          <div className="space-y-2">
            <Label>
              <HintLabel label="输出目录" hint="合并结果写到这个文件夹。目录不存在时会在开始合并前创建。" />
            </Label>
            <div className="flex gap-2">
              <Input
                value={merge.outputDirectory}
                disabled={merge.running}
                onChange={(event) => merge.setOutputDirectory(event.target.value)}
                placeholder="D:\输出目录"
              />
              <Button
                variant="outline"
                size="icon"
                title="选择输出目录"
                disabled={merge.running}
                onClick={() => void merge.pickOutputDirectory()}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>
              <HintLabel label="输出文件名" hint="成片文件名，含扩展名。同名文件已存在时不会覆盖，Nestify 会自动追加 -1、-2 等编号。" />
            </Label>
            <Input
              value={merge.outputName}
              disabled={merge.running}
              onChange={(event) => merge.setOutputName(event.target.value)}
              placeholder={merge.kind === 'image' ? 'nestify-merge.jpg' : 'nestify-merge.mp4'}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={merge.running || merge.items.length === 0} onClick={() => applyNameTemplate('first')}>
                用首个文件名
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={merge.running || merge.items.length === 0} onClick={() => applyNameTemplate('count-date')}>
                文件名-数量-日期
              </Button>
            </div>
          </div>

          {merge.kind === 'image' ? (
            <ImageOutputSettings merge={merge} />
          ) : (
            <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>
                  <HintLabel label="输出格式" hint="决定成片容器。不同格式对网页、剪辑软件和播放器的兼容不一样，选项里的说明是这个容器适合放在哪里。" />
                </Label>
                <Select
                  value={merge.videoSettings.format ?? 'mp4'}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setVideoSettings({ format: value as typeof VIDEO_OUTPUT_FORMATS[number]['value'] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIDEO_OUTPUT_FORMATS.map((format) => (
                      <SelectItem key={format.value} value={format.value}>
                        <span className="flex items-center gap-2">
                          <span>{format.label}</span>
                          <span title={format.description} aria-label={format.description} className="text-muted-foreground">
                            <Info className="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  <HintLabel label="编码模式" hint="自动：能直接拼接就快速复制，否则重新编码。快速流复制不重新压缩，但不能用裁剪以外的转场、改尺寸和响度。重新编码兼容所有设置，耗时更长。" />
                </Label>
                <Select
                  value={merge.videoSettings.encodingMode ?? 'auto'}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setVideoSettings({ encodingMode: value as 'auto' | 'reencode' | 'stream-copy' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动</SelectItem>
                    <SelectItem value="stream-copy">快速流复制</SelectItem>
                    <SelectItem value="reencode">重新编码</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  <HintLabel label="画质" hint="只在重新编码时生效。标准体积更小，高画质保留更多细节、文件更大。快速流复制沿用原画质。" />
                </Label>
                <Select
                  value={merge.videoSettings.quality}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setVideoSettings({ quality: value as 'standard' | 'high' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">标准</SelectItem>
                    <SelectItem value="high">高画质</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  <HintLabel label="音频" hint="保留会带上各片段的声音。静音输出整段无声，此时音量和响度不再起作用。" />
                </Label>
                <Select
                  value={merge.videoSettings.audio}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setVideoSettings({ audio: value as 'keep' | 'mute' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">保留</SelectItem>
                    <SelectItem value="mute">静音</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  <HintLabel label="转场" hint="无转场是硬切。交叉淡化让相邻片段重叠淡入淡出，必须重新编码，成片时长会扣掉每段重叠的秒数。" />
                </Label>
                <Select
                  value={transition.type}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setVideoSettings({
                    transition: {
                      type: value as 'none' | 'crossfade',
                      durationSeconds: value === 'crossfade' ? Math.max(0.1, transition.durationSeconds || 0.5) : 0,
                    },
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">无转场</SelectItem>
                    <SelectItem value="crossfade">交叉淡化</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  <HintLabel label="转场时长（秒）" hint="交叉淡化的重叠时间，0.1 到 5 秒。没有转场时此项不生效。" />
                </Label>
                <Input
                  type="number"
                  min={transition.type === 'crossfade' ? 0.1 : 0}
                  max={5}
                  step={0.1}
                  value={transition.durationSeconds}
                  disabled={merge.running || transition.type !== 'crossfade'}
                  onChange={(event) => merge.setVideoSettings({
                    transition: {
                      type: transition.type,
                      durationSeconds: Math.min(5, Math.max(0.1, Number(event.target.value))),
                    },
                  })}
                />
              </div>
              <div className="space-y-1">
                <Label>
                  <HintLabel label="输出音量倍数" hint="成片整体音量。1 为各片段设置后的音量，0 为无声，最大 4 倍。与第二步里单条素材的音量叠加。" />
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={4}
                  step={0.1}
                  value={outputVolume}
                  disabled={merge.running || merge.videoSettings.audio === 'mute'}
                  onChange={(event) => merge.setVideoSettings({ outputVolume: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label>
                  <HintLabel label="自动尺寸" hint="没有固定分辨率时使用。按最大素材或第一条素材的宽高作为画布，其余画面等比缩放后用黑边补齐。限制在 1080p 以内时，超过 1920x1080 会先缩小。第二步填写了固定宽高后，以固定分辨率为准。" />
                </Label>
                <Select
                  value={merge.videoSettings.fit ?? 'largest'}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setVideoSettings({ fit: value as 'largest' | 'first' | 'limit-1080p' })}
                >
                  <SelectTrigger aria-label="画面尺寸">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIDEO_FIT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  <HintLabel label="响度归一" hint="把整段声音拉到相近响度，减轻片段之间忽大忽小。会重新处理音频，不能用于快速流复制；静音时关闭。" />
                </Label>
                <Select
                  value={merge.videoSettings.loudnessNormalize ? 'on' : 'off'}
                  disabled={merge.running || merge.videoSettings.audio === 'mute'}
                  onValueChange={(value) => merge.setVideoSettings({ loudnessNormalize: value === 'on' })}
                >
                  <SelectTrigger aria-label="响度归一">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">关闭</SelectItem>
                    <SelectItem value="on">开启</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {transition.type === 'crossfade' || streamCopyBlocked || merge.videoSettings.audio === 'mute' ? (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                {transition.type === 'crossfade' ? (
                  <p>交叉淡化会重叠相邻片段并重新编码；输出时长会减去每个转场重叠的秒数。</p>
                ) : null}
                {streamCopyBlocked ? (
                  <p className="text-amber-700">
                    当前设置与快速流复制互斥。请改为重新编码或自动模式；自动模式会在需要时重新编码。
                  </p>
                ) : null}
                {merge.videoSettings.audio === 'mute' ? <p>全部静音会输出无声视频。</p> : null}
              </div>
            ) : null}
            </>
          )}
        </div>

        <div className="min-h-0 space-y-3 overflow-auto p-3">
          {merge.kind === 'image' ? (
            <>
              <ImageMergePreview merge={merge} />
              <ImageOutputItemEditor merge={merge} />
            </>
          ) : <VideoSequencePreview merge={merge} />}
          {merge.running ? (
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span>{PHASE_LABELS[merge.progress?.phase ?? 'processing'] ?? '处理中'}</span>
                <span className="text-muted-foreground">{Math.round(merge.progress?.percent ?? 0)}%</span>
              </div>
              <Progress value={merge.progress?.percent ?? 0} />
              <div className="mt-2 text-xs text-muted-foreground">
                {merge.progress?.current ?? 0} / {merge.progress?.total ?? merge.items.length}
              </div>
            </div>
          ) : null}

          {completed ? (
            <div className="flex items-start gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">合并完成</div>
                <div className="truncate text-xs text-muted-foreground" title={merge.progress?.outputPath ?? ''}>
                  {merge.progress?.outputPath}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void merge.revealOutput(merge.progress?.outputPath ?? '')}>
                查看文件
              </Button>
            </div>
          ) : null}

          {failed ? (
            <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 text-sm">{merge.progress?.error ?? '合并失败'}</div>
            </div>
          ) : null}
          {cancelled ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">任务已取消。</div>
          ) : null}

          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
              执行摘要
              {merge.planning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            </div>
            <dl className="space-y-2 p-3 text-sm">
              <SummaryRow label="文件数" value={String(merge.plan?.summary.itemCount ?? merge.items.length)} />
              {merge.kind === 'image' && merge.plan?.summary.image ? (
                <SummaryRow
                  label={merge.plan.summary.image.animated ? 'GIF 画布' : '输出尺寸'}
                  value={merge.plan.summary.image.animated
                    ? `${merge.plan.summary.image.width} x ${merge.plan.summary.image.height} px · ${formatDuration(merge.plan.summary.image.durationSeconds ?? 0)}`
                    : `${merge.plan.summary.image.width} x ${merge.plan.summary.image.height} px · ${imageLayoutLabel(merge.plan.summary.image.layout)}`}
                />
              ) : null}
              {merge.kind === 'video' && merge.plan?.summary.video ? (
                <>
                  <SummaryRow label="原始总时长" value={formatDuration(merge.plan.summary.video.originalDurationSeconds)} />
                  <SummaryRow label="裁剪后总时长" value={formatDuration(merge.plan.summary.video.trimmedDurationSeconds)} />
                  {merge.plan.summary.video.outputDurationSeconds != null ? (
                    <SummaryRow label="转场后输出时长" value={formatDuration(merge.plan.summary.video.outputDurationSeconds)} />
                  ) : null}
                  {merge.plan.summary.video.width && merge.plan.summary.video.height ? (
                    <SummaryRow label="输出分辨率" value={`${merge.plan.summary.video.width} x ${merge.plan.summary.video.height}`} />
                  ) : null}
                  {merge.plan.summary.video.streamCopyReason ? (
                    <SummaryRow label="快速流复制" value={merge.plan.summary.video.streamCopyReason} />
                  ) : null}
                  <SummaryRow label="自定义裁剪" value={`${merge.plan.summary.video.customTrimCount} 个`} />
                </>
              ) : null}
              <SummaryRow label="输出路径" value={merge.plan?.outputPath ?? (merge.planning ? '正在生成执行摘要...' : '等待有效设置')} />
            </dl>
          </div>

          {merge.plan?.summary.warnings.length ? (
            <div className="space-y-2">
              {merge.plan.summary.warnings.map((warning) => (
                <div key={warning} className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {warning}
                </div>
              ))}
            </div>
          ) : null}

          {completed || failed || cancelled ? (
            <Button variant="outline" onClick={merge.reset}>
              <PackageOpen className="h-4 w-4" />
              新建合并任务
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-right" title={value}>{value}</dd>
    </div>
  )
}

function outputExtension(merge: MediaMergeController): string {
  if (merge.kind === 'image') return `.${merge.imageSettings.format === 'jpg' ? 'jpg' : merge.imageSettings.format}`
  return `.${merge.videoSettings.format ?? 'mp4'}`
}

function fileStem(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  return stem.replace(/[<>:"/\\|?*]/g, '_').trim() || 'nestify-merge'
}
