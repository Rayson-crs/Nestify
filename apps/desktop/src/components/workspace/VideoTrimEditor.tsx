import { useEffect, useRef, useState } from 'react'
import { Film, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FilePreview, MediaMergeItem, MediaMergeTimeline, MediaMergeWaveform } from '@/lib/ipc'
import { callNestify } from '@/lib/ipc'
import { BatchTrimPanel } from './BatchTrimPanel'
import { MediaTrimTimeline, type TrimUpdateHandler } from './MediaTrimTimeline'
import { baseName, formatDuration, mediaFileUrl, selectedPathsKey, splitSelectedPaths } from './merge-pane-shared'
import { VideoAudioControls, type MediaMergeAudioPatch } from './VideoAudioControls'
import type { MediaMergeFrameFit, MediaMergeImageMotion, MediaMergeItemRotation } from '@/lib/ipc'
import { ItemFrameFields } from './ItemFrameFields'
import { mediaContentStyle, mediaFrameBoxStyle, mediaFrameSize, mediaScaleLayerStyle, useMediaPreviewCanvasRatio } from './media-frame-preview'
import { VideoSequenceControls } from './VideoSequenceControls'
import { MediaMotionField } from './MediaMotionField'
import { imageMotionStyle } from './video-sequence'

export function VideoTrimEditor({
  item,
  items,
  canvasWidth,
  canvasHeight,
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
  onMotionChange,
  onFrameFit,
  onRotation,
  onScale,
  onFocus,
  customTrimCount,
}: {
  item: MediaMergeItem
  items: MediaMergeItem[]
  canvasWidth: number
  canvasHeight: number
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
  onMotionChange: (itemId: string, motion: MediaMergeImageMotion) => void
  onFrameFit: (itemId: string, frameFit: MediaMergeFrameFit | null) => void
  onRotation: (itemId: string, rotation: MediaMergeItemRotation) => void
  onScale: (itemId: string, scalePercent: number) => void
  onFocus: (itemId: string, focusX: number, focusY: number) => void
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
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(null)
  const [loopSelection, setLoopSelection] = useState(true)
  const [previewFailed, setPreviewFailed] = useState(false)
  const scrubbing = useRef(false)
  const pathsKey = selectedPathsKey(items)
  const frameFit = item.frameFit ?? 'contain'
  const rotation = item.rotation ?? 'none'
  const previewRatio = Math.max(1, canvasWidth) / Math.max(1, canvasHeight)
  const previewCanvas = useMediaPreviewCanvasRatio(previewRatio)
  const frameSize = mediaFrameSize(rotation, previewCanvas.size)

  useEffect(() => {
    let cancelled = false
    setPreview({ kind: 'video', src: mediaFileUrl(item.path) })
    setTimeline(null)
    setWaveform(null)
    setPreviewLoading(false)
    setDuration(0)
    setMediaSize(null)
    setPlaying(false)
    setPreviewFailed(false)
    setCurrentTime(item.trimStart)
    const selectedPaths = splitSelectedPaths(pathsKey)
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
  const retainedDuration = Math.max(0.1, effectiveEnd - item.trimStart)
  const motionProgress = Math.max(0, Math.min(1, (currentTime - item.trimStart) / retainedDuration))
  const motionStyle = imageMotionStyle(item.imageMotion, motionProgress, retainedDuration)

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
    video.muted = muted
    video.playbackRate = rate
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

  const seekWithin = (local: number) => {
    const next = Math.max(item.trimStart, Math.min(local, Math.max(item.trimStart, effectiveEnd)))
    setCurrentTime(next)
    if (videoRef.current && Number.isFinite(videoRef.current.duration)) videoRef.current.currentTime = next
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
        <div ref={previewCanvas.fullscreenRef} className={previewCanvas.isFullscreen ? 'flex h-screen w-screen flex-col gap-3 bg-black p-3' : undefined}>
        <div ref={previewCanvas.ref} className="relative mx-auto max-h-[360px] w-full overflow-hidden rounded-md bg-black" style={{ aspectRatio: previewRatio, ...previewCanvas.fullscreenStyle }}>
          {previewLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载预览
            </div>
          ) : preview?.kind === 'video' && !previewFailed ? (
            <div style={mediaFrameBoxStyle(rotation, previewCanvas.size)}>
              <div style={mediaScaleLayerStyle()}>
                <video
                  ref={videoRef}
                  style={{
                    ...mediaContentStyle(frameFit, frameSize, mediaSize, item.frameScalePercent, item.frameFocusX, item.frameFocusY),
                    ...motionStyle,
                  }}
                  src={preview.src}
                  muted={muted}
                  playsInline
                  preload="metadata"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget
                  const nextDuration = Number.isFinite(video.duration) ? video.duration : 0
                  setDuration(nextDuration)
                  if (video.videoWidth > 0 && video.videoHeight > 0) {
                    setMediaSize({ width: video.videoWidth, height: video.videoHeight })
                  }
                  video.playbackRate = rate
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
                    if (loopSelection) {
                      video.currentTime = item.trimStart
                      if (!video.paused) void video.play().catch(() => setPlaying(false))
                    } else video.pause()
                  }
                }}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                  onError={() => setPreviewFailed(true)}
                />
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-white/70">
              <Film className="h-8 w-8" />
              {previewFailed ? '当前格式无法预览，仍可使用数字裁剪' : '预览不可用'}
            </div>
          )}
        </div>

        <div className={previewCanvas.isFullscreen ? 'shrink-0 text-white' : 'mt-3'}>
          <VideoSequenceControls
            playing={playing}
            muted={muted}
            disabled={!validRange}
            playhead={Math.max(0, currentTime - item.trimStart)}
            total={Math.max(0, effectiveEnd - item.trimStart)}
            scope="clip"
            rate={rate}
            canStep={false}
            showTransport={false}
            onToggle={() => void togglePlay()}
            onMuted={(next) => {
              setMuted(next)
              if (videoRef.current) videoRef.current.muted = next
            }}
            onScope={() => undefined}
            onRate={(next) => {
              setRate(next)
              if (videoRef.current) videoRef.current.playbackRate = next
            }}
            onScrubStart={() => {
              scrubbing.current = true
            }}
            onSeek={(time) => seekWithin(item.trimStart + time)}
            onScrubEnd={() => {
              scrubbing.current = false
              if (!playing || !videoRef.current?.paused) return
              void videoRef.current.play().catch(() => setPlaying(false))
            }}
            onStep={() => undefined}
            scalePercent={item.frameScalePercent ?? 100}
            onScale={(next) => onScale(item.id, next)}
            fullscreen={previewCanvas.isFullscreen}
            onFullscreen={() => void previewCanvas.toggleFullscreen()}
          />
        </div>
        </div>
        <div>
          <MediaTrimTimeline
            item={item}
            duration={knownDuration}
            currentTime={currentTime}
            disabled={disabled}
            timeline={timeline}
            waveform={waveform}
            onTrim={onTrim}
            onPreviewTime={seekWithin}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="font-mono text-xs text-muted-foreground">
              保留 {formatDuration(item.trimStart)} - {formatDuration(effectiveEnd)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              循环区间
            </Button>
            </div>
          </div>
          {!validRange && knownDuration > 0 ? (
            <div className="mt-2 text-xs text-destructive">保留区间必须至少 0.1 秒。</div>
          ) : null}
        </div>

        <section className="mt-3 border-t pt-3">
          <ItemFrameFields
            item={item}
            disabled={disabled}
            onFrameFit={(nextFit) => onFrameFit(item.id, nextFit)}
            onRotation={(nextRotation) => onRotation(item.id, nextRotation)}
            onScale={(nextScale) => onScale(item.id, nextScale)}
            onFocus={(focusX, focusY) => onFocus(item.id, focusX, focusY)}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <MediaMotionField
              value={item.imageMotion}
              disabled={disabled}
              onChange={(motion) => onMotionChange(item.id, motion)}
            />
          </div>
        </section>

        <details className="mt-4 rounded-md border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            批量裁剪与音频设置
          </summary>
          <div className="border-t px-3 pb-3">
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
        </details>
      </div>
    </div>
  )
}
