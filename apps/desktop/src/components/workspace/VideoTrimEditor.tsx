import { useEffect, useRef, useState } from 'react'
import { Film, Loader2, Pause, Play, Repeat, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FilePreview, MediaMergeItem, MediaMergeTimeline, MediaMergeWaveform } from '@/lib/ipc'
import { callNestify } from '@/lib/ipc'
import { BatchTrimPanel } from './BatchTrimPanel'
import { MediaTrimTimeline, type TrimUpdateHandler } from './MediaTrimTimeline'
import { baseName, formatDuration, selectedPathsKey, splitSelectedPaths } from './merge-pane-shared'
import { VideoAudioControls, type MediaMergeAudioPatch } from './VideoAudioControls'

export function VideoTrimEditor({
  item,
  items,
  ipcReady,
  disabled,
  batchTrimStart,
  batchTrimEnd,
  onBatchTrimStart,
  onBatchTrimEnd,
  onApplyBatch,
  onTrim,
  onResetTrim,
  onAudioChange,
  customTrimCount,
}: {
  item: MediaMergeItem
  items: MediaMergeItem[]
  ipcReady: boolean
  disabled: boolean
  batchTrimStart: number
  batchTrimEnd: number | null
  onBatchTrimStart: (value: number) => void
  onBatchTrimEnd: (value: number | null) => void
  onApplyBatch: (mode: 'non-custom' | 'all') => void
  onTrim: TrimUpdateHandler
  onResetTrim: (itemId: string) => void
  onAudioChange: (itemId: string, patch: MediaMergeAudioPatch) => void
  customTrimCount: number
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [timeline, setTimeline] = useState<MediaMergeTimeline | null>(null)
  const [waveform, setWaveform] = useState<MediaMergeWaveform | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [duration, setDuration] = useState(0)
  const knownDuration = Math.max(
    duration,
    timeline?.durationSeconds ?? 0,
    waveform?.durationSeconds ?? 0,
  )
  const [currentTime, setCurrentTime] = useState(item.trimStart)
  const [playing, setPlaying] = useState(false)
  const [loopSelection, setLoopSelection] = useState(true)
  const [previewFailed, setPreviewFailed] = useState(false)
  const pathsKey = selectedPathsKey(items)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setTimeline(null)
    setWaveform(null)
    setPreviewLoading(true)
    setDuration(0)
    setPlaying(false)
    setPreviewFailed(false)
    setCurrentTime(item.trimStart)
    const selectedPaths = splitSelectedPaths(pathsKey)
    void callNestify((api) =>
      api.mediaMergePreview
        ? api.mediaMergePreview({ path: item.path, selectedPaths })
        : Promise.resolve({ kind: 'none' as const }),
    )
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch(() => {
        if (!cancelled) setPreview({ kind: 'none' })
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    void Promise.all([
      callNestify((api) =>
        api.mediaMergeTimeline
          ? api.mediaMergeTimeline({ path: item.path, selectedPaths })
          : Promise.resolve({ frames: [], error: '时间轴抽帧接口不可用' }),
      ),
      callNestify((api) =>
        api.mediaMergeWaveform
          ? api.mediaMergeWaveform({ path: item.path, selectedPaths })
          : Promise.resolve({ peaks: [], sampleRate: 0, durationSeconds: 0, error: '波形接口不可用' }),
      ),
    ])
      .then(([nextTimeline, nextWaveform]) => {
        if (cancelled) return
        setTimeline(nextTimeline)
        setWaveform(nextWaveform)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [ipcReady, item.path, pathsKey])

  const effectiveEnd = Math.max(0, knownDuration - (item.trimEndOffset ?? 0))
  const validRange = knownDuration > 0 && effectiveEnd - item.trimStart >= 0.1

  const togglePlay = async () => {
    const video = videoRef.current
    if (!video || !validRange) return
    if (!video.paused) {
      video.pause()
      setPlaying(false)
      return
    }
    if (video.currentTime < item.trimStart || video.currentTime + 0.05 >= effectiveEnd) {
      video.currentTime = item.trimStart
    }
    try {
      await video.play()
      setPlaying(true)
    } catch {
      setPlaying(false)
    }
  }

  const setStartFromCurrent = () => {
    const next = Math.max(0, Math.min(currentTime, effectiveEnd - 0.1))
    onTrim(item.id, 'start', next, knownDuration)
    if (videoRef.current) videoRef.current.currentTime = next
  }

  const setEndFromCurrent = () => {
    const nextEnd = Math.max(currentTime, item.trimStart + 0.1)
    onTrim(item.id, 'end', Math.max(0, knownDuration - nextEnd), knownDuration)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <div className="truncate text-sm font-medium" title={item.path}>{baseName(item.path)}</div>
        <div className="truncate text-xs text-muted-foreground" title={item.path}>
          {knownDuration > 0 ? formatDuration(knownDuration) : '读取时长'} · 保留 {formatDuration(Math.max(0, effectiveEnd - item.trimStart))}
          {item.trimSource === 'custom' ? ' · 自定义' : ' · 批量'}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
          {previewLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载预览
            </div>
          ) : preview?.kind === 'video' && !previewFailed ? (
            <video
              ref={videoRef}
              className="h-full w-full"
              src={preview.src}
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget
                const nextDuration = Number.isFinite(video.duration) ? video.duration : 0
                setDuration(nextDuration)
                video.currentTime = Math.min(item.trimStart, Math.max(0, nextDuration - 0.1))
              }}
              onDurationChange={(event) => {
                const nextDuration = event.currentTarget.duration
                if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration)
              }}
              onTimeUpdate={(event) => {
                const video = event.currentTarget
                setCurrentTime(video.currentTime)
                if (video.currentTime + 0.05 >= effectiveEnd) {
                  if (loopSelection) video.currentTime = item.trimStart
                  else video.pause()
                }
              }}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-white/70">
              <Film className="h-8 w-8" />
              {previewFailed ? '当前格式无法预览，仍可使用数字裁剪' : '预览不可用'}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="icon" title={playing ? '暂停' : '播放保留区间'} disabled={!validRange} onClick={() => void togglePlay()}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <div className="font-mono text-xs text-muted-foreground">
            {formatDuration(currentTime)} / {formatDuration(knownDuration)}
          </div>
          <Button variant="outline" size="sm" disabled={!validRange || disabled} onClick={setStartFromCurrent}>
            当前设为开始
          </Button>
          <Button variant="outline" size="sm" disabled={!validRange || disabled} onClick={setEndFromCurrent}>
            当前设为结束
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || item.trimSource === 'batch'}
            onClick={() => onResetTrim(item.id)}
          >
            <RotateCcw className="h-4 w-4" />
            恢复批量
          </Button>
          <Button
            variant={loopSelection ? 'default' : 'outline'}
            size="sm"
            disabled={disabled}
            aria-pressed={loopSelection}
            onClick={() => {
              const next = !loopSelection
              setLoopSelection(next)
              const video = videoRef.current
              if (next && video && video.currentTime + 0.05 >= effectiveEnd) {
                video.currentTime = item.trimStart
              }
            }}
          >
            <Repeat className="h-4 w-4" />
            循环区间
          </Button>
        </div>

        <div className="mt-3">
          <MediaTrimTimeline
            item={item}
            duration={knownDuration}
            currentTime={currentTime}
            disabled={disabled}
            timeline={timeline}
            waveform={waveform}
            onTrim={onTrim}
          />
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">开始秒数</Label>
              <Input
                type="number"
                min={0}
                max={Math.max(0, effectiveEnd - 0.1)}
                step={0.1}
                value={item.trimStart}
                disabled={disabled}
                onChange={(event) => onTrim(item.id, 'start', Math.max(0, Number(event.target.value)), knownDuration)}
              />
              <input
                type="range"
                aria-label="开始时间"
                min={0}
                max={Math.max(0.1, effectiveEnd - 0.1)}
                step={0.1}
                value={item.trimStart}
                disabled={disabled}
                className="h-6 w-full"
                onChange={(event) => onTrim(item.id, 'start', Math.max(0, Number(event.target.value)), knownDuration)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">结尾去掉秒数（空为不去尾）</Label>
              <Input
                type="number"
                min={0}
                max={Math.max(0, knownDuration - item.trimStart - 0.1) || undefined}
                step={0.1}
                value={item.trimEndOffset ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  onTrim(item.id, 'end', event.target.value.trim() === '' ? null : Number(event.target.value), knownDuration)}
              />
              <input
                type="range"
                aria-label="结尾去掉时间"
                min={0}
                max={Math.max(0, knownDuration - item.trimStart - 0.1)}
                step={0.1}
                value={item.trimEndOffset ?? 0}
                disabled={disabled}
                className="h-6 w-full"
                onChange={(event) => onTrim(item.id, 'end', Number(event.target.value), knownDuration)}
              />
            </div>
          </div>
          {!validRange && knownDuration > 0 ? (
            <div className="mt-2 text-xs text-destructive">保留区间必须至少 0.1 秒。</div>
          ) : null}
        </div>

        <BatchTrimPanel
          disabled={disabled}
          customTrimCount={customTrimCount}
          batchTrimStart={batchTrimStart}
          batchTrimEnd={batchTrimEnd}
          onBatchTrimStart={onBatchTrimStart}
          onBatchTrimEnd={onBatchTrimEnd}
          onApplyBatch={onApplyBatch}
        />
        <VideoAudioControls
          item={item}
          disabled={disabled}
          duration={effectiveEnd - item.trimStart}
          onChange={onAudioChange}
        />
      </div>
    </div>
  )
}
