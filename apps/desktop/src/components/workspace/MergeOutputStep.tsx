import {
  ArrowLeft,
  CircleCheck,
  FolderOpen,
  Loader2,
  PackageOpen,
  RotateCcw,
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
import { VideoSequencePreview } from './VideoSequencePreview'
import { VIDEO_OUTPUT_FORMATS } from './video-formats'

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
      || usesAudioControls
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" disabled={merge.running} onClick={merge.goBack}>
          <ArrowLeft className="h-4 w-4" />
          上一步
        </Button>
        <Button
          variant="outline"
          disabled={merge.busy || merge.running}
          onClick={() => void merge.buildPlan()}
        >
          {merge.busy && !merge.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          重新校验
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {merge.running ? (
            <Button variant="outline" disabled={merge.progress?.status === 'cancelling'} onClick={() => void merge.cancel()}>
              取消任务
            </Button>
          ) : (
            <Button disabled={!merge.plan || merge.busy} onClick={() => void merge.start()}>
              开始合并
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(280px,3fr)_minmax(0,7fr)]">
        <div className="min-h-0 space-y-4 overflow-auto border-r p-3">
          <div className="space-y-2">
            <Label>输出目录</Label>
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
            <Label>输出文件名</Label>
            <Input
              value={merge.outputName}
              disabled={merge.running}
              onChange={(event) => merge.setOutputName(event.target.value)}
              placeholder={merge.kind === 'image' ? 'nestify-merge.jpg' : 'nestify-merge.mp4'}
            />
          </div>

          {merge.kind === 'image' ? (
            <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>布局</Label>
                <Select
                  value={merge.imageSettings.layout ?? 'vertical'}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setImageSettings({ layout: value as 'vertical' | 'horizontal' | 'grid' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vertical">纵向长图</SelectItem>
                    <SelectItem value="horizontal">横向长图</SelectItem>
                    <SelectItem value="grid">网格拼图</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>格式</Label>
                <Select
                  value={merge.imageSettings.format}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setImageSettings({ format: value as 'jpg' | 'png' | 'webp' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jpg">JPG</SelectItem>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="webp">WebP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(merge.imageSettings.layout ?? 'vertical') === 'horizontal' ? (
                <div className="space-y-1">
                  <Label>统一高度</Label>
                  <Input
                    type="number"
                    min={16}
                    max={8192}
                    value={merge.imageSettings.height ?? 1080}
                    disabled={merge.running}
                    onChange={(event) => merge.setImageSettings({ height: Number(event.target.value) })}
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>统一宽度</Label>
                  <Input
                    type="number"
                    min={16}
                    max={8192}
                    value={merge.imageSettings.width}
                    disabled={merge.running}
                    onChange={(event) => merge.setImageSettings({ width: Number(event.target.value) })}
                  />
                </div>
              )}
              {(merge.imageSettings.layout ?? 'vertical') === 'grid' ? (
                <div className="space-y-1">
                  <Label>网格列数</Label>
                  <Input
                    type="number"
                    min={1}
                    max={8}
                    value={merge.imageSettings.columns ?? 2}
                    disabled={merge.running}
                    onChange={(event) => merge.setImageSettings({ columns: Number(event.target.value) })}
                  />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label>图片间距</Label>
                <Input
                  type="number"
                  min={0}
                  max={128}
                  value={merge.imageSettings.gap}
                  disabled={merge.running}
                  onChange={(event) => merge.setImageSettings({ gap: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label>背景</Label>
                <Select
                  value={merge.imageSettings.background}
                  disabled={merge.running}
                  onValueChange={(value) => merge.setImageSettings({ background: value as 'white' | 'transparent' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="white">白色</SelectItem>
                    <SelectItem value="transparent">透明</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            </>
          ) : (
            <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>输出格式</Label>
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
                <Label>编码模式</Label>
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
                <Label>画质</Label>
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
                <Label>音频</Label>
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
                <Label>转场</Label>
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
                <Label>转场时长（秒）</Label>
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
                <Label>输出音量倍数</Label>
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
          {merge.kind === 'image' ? <ImageMergePreview merge={merge} /> : <VideoSequencePreview merge={merge} />}
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
            <div className="border-b px-3 py-2 text-sm font-medium">执行摘要</div>
            <dl className="space-y-2 p-3 text-sm">
              <SummaryRow label="文件数" value={String(merge.plan?.summary.itemCount ?? merge.items.length)} />
              {merge.kind === 'image' && merge.plan?.summary.image ? (
                <SummaryRow
                  label="输出尺寸"
                  value={`${merge.plan.summary.image.width} x ${merge.plan.summary.image.height} px · ${imageLayoutLabel(merge.plan.summary.image.layout)}`}
                />
              ) : null}
              {merge.kind === 'video' && merge.plan?.summary.video ? (
                <>
                  <SummaryRow label="原始总时长" value={formatDuration(merge.plan.summary.video.originalDurationSeconds)} />
                  <SummaryRow label="裁剪后总时长" value={formatDuration(merge.plan.summary.video.trimmedDurationSeconds)} />
                  {merge.plan.summary.video.outputDurationSeconds != null ? (
                    <SummaryRow label="转场后输出时长" value={formatDuration(merge.plan.summary.video.outputDurationSeconds)} />
                  ) : null}
                  <SummaryRow label="自定义裁剪" value={`${merge.plan.summary.video.customTrimCount} 个`} />
                </>
              ) : null}
              <SummaryRow label="输出路径" value={merge.plan?.outputPath ?? '待校验'} />
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
