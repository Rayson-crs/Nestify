import { useEffect, useMemo, useRef, useState } from 'react'
import { Film } from 'lucide-react'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { callNestify } from '@/lib/ipc'
import { baseName, formatDuration, splitSelectedPaths } from './merge-pane-shared'
import {
  applySegmentVolume,
  buildSegments,
  clipSource,
  fastScrubTime,
  imageDwellSeconds,
  imageMotionStyle,
  mapInBatches,
  missingDurationItems,
  nativePlaybackRate,
  nextPlayableSegment,
  playableSegmentAt,
  previewStatusText,
  prioritizeByActive,
  putKnown,
  needsPreviewProxy,
  pollPreviewProxy,
  readClipSource,
  retainKnown,
  retainKnownSet,
  recordClipRead,
  toggleKnown,
  type PlaybackScope,
  type SequenceSegment,
} from './video-sequence'
import {
  clearSecondary,
  finishSegment,
  loadPrimaryVideo,
  rememberPathDuration,
  requestVideoPlayback,
  seekLoadedVideo,
  sourceTimeForSegment,
  syncCrossfade,
} from './video-sequence-playback'
import { mediaContentStyle, mediaFrameBoxStyle, mediaFrameSize, mediaScaleLayerStyle, useMediaPreviewCanvasRatio } from './media-frame-preview'
import { VideoSequenceControls } from './VideoSequenceControls'
import { VideoSequenceTimeline } from './VideoSequenceTimeline'

export function VideoSequencePreview({
  merge,
  title = "拼接预览",
  initialScope = "sequence",
  showReorder = true,
  showStatus = true,
  showTransport = true,
}: {
  merge: MediaMergeController
  title?: string
  initialScope?: PlaybackScope
  showReorder?: boolean
  showStatus?: boolean
  showTransport?: boolean
}) {
  const videos = useMemo(() => merge.items.filter((item) => item.kind === 'video' || item.kind === 'image'), [merge.items])
  const fileSetKey = useMemo(() => [...videos.map((item) => item.path)].sort().join('\n'), [videos])
  const [sources, setSources] = useState<Map<string, string>>(() => new Map())
  const [durations, setDurations] = useState<Map<string, number>>(() => new Map())
  const [unreadable, setUnreadable] = useState<Set<string>>(() => new Set())
  const [failedPaths, setFailedPaths] = useState<Set<string>>(() => new Set())
  const [preparingPaths, setPreparingPaths] = useState<Set<string>>(() => new Set())
  const [mediaSizes, setMediaSizes] = useState<Map<string, { width: number; height: number }>>(() => new Map())
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [scope, setScope] = useState<PlaybackScope>(initialScope)
  const [rate, setRate] = useState(1)
  const [activeId, setActiveId] = useState<string | null>(merge.selectedItemId ?? videos[0]?.id ?? null)
  const [fade, setFade] = useState(0)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const primaryRef = useRef<HTMLVideoElement | null>(null)
  const secondaryRef = useRef<HTMLVideoElement | null>(null)
  const durationsRef = useRef(durations)
  const sourcesRef = useRef(sources)
  const failedRef = useRef(failedPaths)
  const unreadableRef = useRef(unreadable)
  const preparingRef = useRef(preparingPaths)
  const pendingSeek = useRef<number | null>(null)
  const resumeWhenReady = useRef(false)
  const playingRef = useRef(false)
  const ignorePause = useRef(false)
  const scrubbing = useRef(false)
  const scopeRef = useRef(scope)
  const rateRef = useRef(rate)
  const mutedRef = useRef(muted)
  const fastSeekAt = useRef(0)
  const imageClock = useRef(0)
  const imageEnded = useRef(false)
  const advancingId = useRef<string | null>(null)
  const outputVolume = merge.videoSettings.outputVolume ?? 1
  const outputAudio = merge.videoSettings.audio
  const transition = merge.videoSettings.transition ?? { type: 'none' as const, durationSeconds: 0 }
  const overlap = transition.type === 'crossfade' ? Math.max(0, transition.durationSeconds) : 0
  const segments = useMemo(() => buildSegments(videos, durations, overlap), [durations, overlap, videos])
  const total = segments.at(-1)?.timelineEnd ?? 0
  const active = segments.find((segment) => segment.item.id === activeId) ?? segments[0] ?? null
  const activeRef = useRef(active)
  activeRef.current = active
  const activeIndex = Math.max(0, segments.findIndex((segment) => segment.item.id === active?.item.id))
  const activeSrc = active ? clipSource(sources, active.item) : ''
  const orderKey = videos.map((item) => `${item.id}:${item.path}`).join('\n')
  const measuredCount = segments.filter((segment) => segment.item.kind === 'image' || durations.has(segment.item.path)).length
  const failedCount = segments.filter((segment) => failedPaths.has(segment.item.path)).length
  const preparingCount = segments.filter((segment) => preparingPaths.has(segment.item.path)).length
  const statusText = previewStatusText(segments.length, measuredCount, failedCount, preparingCount, formatDuration(total))
  const displayTotal = scope === 'clip' && active ? active.length : total
  const displayPlayhead = scope === 'clip' && active ? Math.max(0, playhead - active.timelineStart) : playhead
  durationsRef.current = durations
  sourcesRef.current = sources
  failedRef.current = failedPaths
  unreadableRef.current = unreadable
  preparingRef.current = preparingPaths
  scopeRef.current = scope
  rateRef.current = rate
  mutedRef.current = muted
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead
  const segmentsRef = useRef(segments)
  segmentsRef.current = segments
  const activeMotion = active
    ? imageMotionStyle(
      active.item.imageMotion,
      active.length > 0 ? Math.max(0, Math.min(1, (playhead - active.timelineStart) / active.length)) : 0,
      active.item.kind === 'image' ? imageDwellSeconds(active.item) : active.length,
    )
    : null
  const activeFrameFit = active?.item.frameFit ?? 'contain'
  const activeRotation = active?.item.rotation ?? 'none'
  const canvasWidth = Math.max(1, merge.videoSettings.canvasWidth ?? 16)
  const canvasHeight = Math.max(1, merge.videoSettings.canvasHeight ?? 9)
  const canvasRatio = canvasWidth / canvasHeight
  const previewCanvas = useMediaPreviewCanvasRatio(canvasRatio)
  const activeFrameBox = mediaFrameBoxStyle(activeRotation, previewCanvas.size)
  const activeFrameSize = mediaFrameSize(activeRotation, previewCanvas.size)
  const nextSegment = activeIndex >= 0 ? segments[activeIndex + 1] ?? null : null
  const nextRotation = nextSegment?.item.rotation ?? 'none'
  const nextFrameBox = mediaFrameBoxStyle(
    nextRotation,
    previewCanvas.size,
  )
  const nextFrameSize = mediaFrameSize(nextRotation, previewCanvas.size)
  const nextMotion = nextSegment
    ? imageMotionStyle(
      nextSegment.item.imageMotion,
      nextSegment.length > 0 ? Math.max(0, Math.min(1, (playhead - nextSegment.timelineStart) / nextSegment.length)) : 0,
      nextSegment.item.kind === 'image' ? imageDwellSeconds(nextSegment.item) : nextSegment.length,
    )
    : null

  useEffect(() => {
    if (!merge.selectedItemId) return
    setActiveId(merge.selectedItemId)
  }, [merge.selectedItemId])

  useEffect(() => {
    advancingId.current = null
  }, [active?.item.id])

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    if (!active) return
    const segment = segmentsRef.current.find((entry) => entry.item.id === active.item.id)
    if (!segment || scopeRef.current !== 'sequence') return
    const mediaTime = segment.item.kind === 'image' ? null : pendingSeek.current ?? primaryRef.current?.currentTime
    const sourceTime = mediaTime != null && Number.isFinite(mediaTime)
      ? mediaTime
      : segment.sourceStart + Math.max(0, playheadRef.current - segment.timelineStart)
    const nextPlayhead = segment.timelineStart + Math.max(0, Math.min(sourceTime, segment.sourceEnd) - segment.sourceStart)
    setPlayhead((current) => Math.abs(current - nextPlayhead) < 0.05 ? current : nextPlayhead)
  }, [active, orderKey])

  useEffect(() => {
    const video = primaryRef.current
    if (video) video.playbackRate = nativePlaybackRate(rate)
    if (secondaryRef.current) secondaryRef.current.playbackRate = nativePlaybackRate(rate)
    applySegmentVolume(video, activeRef.current, muted, outputVolume, outputAudio, playheadRef.current, rate)
  }, [muted, outputAudio, outputVolume, rate])

  useEffect(() => {
    const video = primaryRef.current
    if (!video || !active) return
    if (active.item.kind === 'image') {
      if (video.getAttribute('src')) {
        ignorePause.current = true
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      return
    }
    if (!activeSrc) return
    const local = pendingSeek.current ?? sourceTimeForSegment(active, playheadRef.current)
    if (video.getAttribute('src') !== activeSrc) {
      loadPrimaryVideo(
        video,
        active,
        activeSrc,
        local,
        playingRef.current,
        pendingSeek,
        resumeWhenReady,
      )
      ignorePause.current = true
      return
    }
    if (pendingSeek.current != null && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekLoadedVideo(video, pendingSeek.current)
      pendingSeek.current = null
    }
    if (resumeWhenReady.current && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resumeWhenReady.current = false
      requestVideoPlayback(video, markPlaybackStopped)
    }
  }, [active?.item.id, activeSrc])

  useEffect(() => {
    const path = active?.item.kind === "video" ? active.item.path : ""
    if (!path || !needsPreviewProxy(path) || sourcesRef.current.get(path) || failedRef.current.has(path)) return
    let cancelled = false
    const selectedPaths = splitSelectedPaths(fileSetKey)
    const direct = sourcesRef.current.get(path) || ""
    setPreparingPaths((current) => toggleKnown(current, path, true))
    void pollPreviewProxy(
      direct,
      () => callNestify((api) => api.mediaMergePreviewProxy
        ? api.mediaMergePreviewProxy({ path, selectedPaths })
        : Promise.resolve(null)),
      () => cancelled,
      (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    ).then((result) => {
      if (cancelled) return
      if (result.status === "failed") {
        setFailedPaths((current) => toggleKnown(current, path, true))
        setPreparingPaths((current) => toggleKnown(current, path, false))
        return
      }
      if (result.src) setSources((current) => putKnown(current, path, result.src))
      setPreparingPaths((current) => toggleKnown(current, path, false))
    })
    return () => {
      cancelled = true
    }
  }, [active?.item.path, fileSetKey])

  useEffect(() => {
    let cancelled = false
    const selectedPaths = splitSelectedPaths(fileSetKey)
    const livePaths = new Set(selectedPaths)
    setSources((current) => retainKnown(current, livePaths))
    setDurations((current) => retainKnown(current, livePaths))
    setUnreadable((current) => retainKnownSet(current, livePaths))
    setFailedPaths((current) => retainKnownSet(current, livePaths))
    setPreparingPaths((current) => retainKnownSet(current, livePaths))
    const missing = prioritizeByActive(missingDurationItems(videos, durationsRef.current), activeRef.current?.item.id ?? activeId)
    void mapInBatches(
      missing,
      6,
      () => cancelled,
      (item) => readClipSource(item, selectedPaths, () => cancelled, () => {
        if (!cancelled) setPreparingPaths((current) => toggleKnown(current, item.path, true))
      }, async (path, allowedPaths) => {
        const result = await callNestify((api) => api.mediaMergeDuration
          ? api.mediaMergeDuration({ path, selectedPaths: allowedPaths })
          : Promise.reject(new Error('mediaMerge.duration is unavailable')))
        return result.durationSeconds
      }),
      (result) => {
        const next = recordClipRead({ sources: sourcesRef.current, durations: durationsRef.current, unreadable: unreadableRef.current, failed: failedRef.current, preparing: preparingRef.current }, result)
        setSources(next.sources)
        setDurations(next.durations)
        setUnreadable(next.unreadable)
        setFailedPaths(next.failed)
        setPreparingPaths(next.preparing)
      },
    )
    return () => {
      cancelled = true
    }
  }, [fileSetKey, videos])

  const seekRef = useRef<(time: number, autoplay?: boolean) => void>(() => undefined)
  const markPlaybackStopped = () => {
    playingRef.current = false
    resumeWhenReady.current = false
    setPlaying(false)
  }
  const seek = (time: number, autoplay = playingRef.current) => {
    const segment = playableSegmentAt(segmentsRef.current, time, failedRef.current)
    if (!segment) return
    const bounded = Math.min(Math.max(time, segment.timelineStart), segment.timelineEnd)
    const local = Math.min(segment.sourceEnd, segment.sourceStart + Math.max(0, bounded - segment.timelineStart))
    setActiveId(segment.item.id)
    setPlayhead(bounded)
    setFade(0)
    clearSecondary(secondaryRef.current)
    const video = primaryRef.current
    if (!video) return
    if (segment.item.kind === 'image') {
      ignorePause.current = true
      resumeWhenReady.current = false
      video.pause()
      imageClock.current = performance.now() - ((bounded - segment.timelineStart) / Math.max(rateRef.current, 0.25)) * 1000
      imageEnded.current = false
      return
    }
    video.playbackRate = nativePlaybackRate(rateRef.current)
    applySegmentVolume(video, segment, mutedRef.current, outputVolume, outputAudio, bounded, rateRef.current)
    const src = clipSource(sourcesRef.current, segment.item)
    const swapped = src
      ? loadPrimaryVideo(video, segment, src, local, autoplay, pendingSeek, resumeWhenReady)
      : false
    if (swapped) {
      ignorePause.current = true
      return
    }
    if (autoplay) ignorePause.current = true
    seekLoadedVideo(video, local)
    pendingSeek.current = null
    resumeWhenReady.current = false
    if (autoplay) requestVideoPlayback(video, markPlaybackStopped)
  }
  seekRef.current = seek

  useEffect(() => {
    if (!playing || active?.item.kind !== 'image') return
    const segment = active
    imageEnded.current = false
    const timer = window.setInterval(() => {
      if (!playingRef.current) return
      const elapsed = ((performance.now() - imageClock.current) / 1000) * rateRef.current
      const next = Math.min(segment.timelineEnd, segment.timelineStart + elapsed)
      setPlayhead(next)
      if (next < segment.timelineEnd - 0.001 || imageEnded.current) return
      imageEnded.current = true
      finishSegment(segment, segmentsRef.current, scopeRef.current, failedRef.current, seekRef.current, playingRef, setPlaying, setPlayhead, setFade, primaryRef.current, secondaryRef.current)
    }, 80)
    return () => window.clearInterval(timer)
  }, [active, playing])

  const togglePlay = () => {
    if (!active || failedPaths.has(active.item.path)) return
    if (playing) {
      playingRef.current = false
      resumeWhenReady.current = false
      setPlaying(false)
      primaryRef.current?.pause()
      secondaryRef.current?.pause()
      return
    }
    const restart = scope === 'clip'
      ? playhead <= active.timelineStart + 0.05 || playhead >= active.timelineEnd - 0.05
      : playhead <= 0.05 || playhead >= total - 0.05
    const start = scope === 'clip'
      ? (restart ? active.timelineStart : playhead)
      : (restart ? segments[0]?.timelineStart ?? 0 : playhead)
    setPlaying(true)
    playingRef.current = true
    seek(start, true)
  }

  const changeScope = (next: PlaybackScope) => {
    scopeRef.current = next
    setScope(next)
    if (next === 'clip') {
      clearSecondary(secondaryRef.current)
      setFade(0)
    }
    if (!active) return
    if (next === 'clip' && (playhead < active.timelineStart || playhead >= active.timelineEnd)) {
      seek(active.timelineStart, playingRef.current)
    }
  }

  const step = (direction: -1 | 1) => {
    if (!active) return
    const next = nextPlayableSegment(segments, activeIndex, direction, failedPaths)
    if (!next) return
    setPlaying(true)
    playingRef.current = true
    seek(next.timelineStart, true)
  }

  const advance = (segment: SequenceSegment) => finishSegment(
    segment,
    segmentsRef.current,
    scopeRef.current,
    failedRef.current,
    seekRef.current,
    playingRef,
    setPlaying,
    setPlayhead,
    setFade,
    primaryRef.current,
    secondaryRef.current,
  )
  const advanceOnce = (segment: SequenceSegment) => {
    if (advancingId.current === segment.item.id) return
    advancingId.current = segment.item.id
    advance(segment)
  }
  const activeFailed = active != null && failedPaths.has(active.item.path)
  const controlsDisabled = !active || activeFailed || (active.item.kind === 'video' && !activeSrc)

  return (
    <section className="space-y-3">
      <div className="min-w-0">
        {showStatus ? (
          <>
            <div className="text-sm font-medium">{title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {statusText}
              {overlap > 0 ? ` · 交界重叠 ${formatDuration(overlap)}` : ''}
              {scope === 'clip' && active ? ` · 正在预览 ${activeIndex + 1}/${segments.length}` : ''}
            </div>
          </>
        ) : null}
      </div>

      <div ref={previewCanvas.fullscreenRef} className={previewCanvas.isFullscreen ? 'flex h-screen w-screen flex-col gap-3 bg-black p-3 text-white' : 'space-y-3'}>
      <div ref={previewCanvas.ref} className="relative mx-auto max-h-[420px] w-full overflow-hidden rounded-md bg-black" style={{ aspectRatio: canvasRatio, ...previewCanvas.fullscreenStyle }}>
        <div style={{ ...activeFrameBox, opacity: active?.item.kind === 'image' ? 0 : 1 - fade }}>
          <div style={mediaScaleLayerStyle()}>
            <video
              ref={primaryRef}
              className={draggingId || active?.item.kind === 'image' ? 'pointer-events-none' : undefined}
              style={{
                ...mediaContentStyle(activeFrameFit, activeFrameSize, active ? mediaSizes.get(active.item.path) ?? null : null, active?.item.frameScalePercent, active?.item.frameFocusX, active?.item.frameFocusY),
                ...(activeMotion ?? {}),
              }}
              data-path={active?.item.kind === 'video' ? active.item.path : undefined}
              playsInline
          preload="auto"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            const width = video.videoWidth
            const height = video.videoHeight
            rememberPathDuration(video, activeRef.current, setDurations)
            const current = activeRef.current
            if (current && width > 0 && height > 0) {
              setMediaSizes((existing) => putKnown(existing, current.item.path, {
                width,
                height,
              }))
            }
            const pending = pendingSeek.current
            if (pending != null) seekLoadedVideo(video, pending)
          }}
          onLoadedData={(event) => {
            const pending = pendingSeek.current
            if (pending != null) {
              pendingSeek.current = null
              seekLoadedVideo(event.currentTarget, pending)
            }
            advancingId.current = null
            if (resumeWhenReady.current || playingRef.current) {
              resumeWhenReady.current = false
              requestVideoPlayback(event.currentTarget, markPlaybackStopped)
            }
          }}
          onDurationChange={(event) => rememberPathDuration(event.currentTarget, activeRef.current, setDurations)}
          onCanPlay={(event) => {
            if (!resumeWhenReady.current || !playingRef.current) return
            resumeWhenReady.current = false
            requestVideoPlayback(event.currentTarget, markPlaybackStopped)
          }}
          onTimeUpdate={(event) => {
            const current = activeRef.current
            if (!current || current.item.kind === 'image') return
            const local = event.currentTarget.currentTime
            const output = current.timelineStart + Math.max(0, local - current.sourceStart)
            setPlayhead(Math.min(current.timelineEnd, output))
            applySegmentVolume(event.currentTarget, current, mutedRef.current, outputVolume, outputAudio, output, rateRef.current)
            syncCrossfade(segmentsRef.current, current, local, overlap, sourcesRef.current, failedRef.current, secondaryRef.current, rateRef.current, mutedRef.current, outputVolume, outputAudio, playingRef.current, scopeRef.current, setFade)
            if (playingRef.current && local >= current.sourceEnd - 0.05) advanceOnce(current)
            const scrub = fastScrubTime(local, current.sourceEnd, rateRef.current, playingRef.current ? performance.now() - fastSeekAt.current : 0)
            if (scrub != null) {
              fastSeekAt.current = performance.now()
              event.currentTarget.currentTime = scrub
            }
          }}
          onEnded={() => {
            const current = activeRef.current
            if (current && current.item.kind !== 'image') advanceOnce(current)
          }}
          onPlay={() => {
            ignorePause.current = false
            resumeWhenReady.current = false
          }}
          onPause={() => {
            if (ignorePause.current || scrubbing.current || draggingId) return
            const current = activeRef.current
            if (playingRef.current && current?.item.kind === 'image') return
            const video = primaryRef.current
            const reachedEnd = current != null && video != null && (video.ended || video.currentTime >= current.sourceEnd - 0.08)
            if (playingRef.current && scopeRef.current === 'sequence' && reachedEnd) return
            if (playingRef.current) setPlaying(false)
          }}
            onError={() => {
            const current = activeRef.current
            if (!current || current.item.kind === 'image' || !primaryRef.current?.getAttribute('src')) return
            const path = current.item.path
            resumeWhenReady.current = false
            setFailedPaths((existing) => toggleKnown(existing, path, true))
            if (playingRef.current && scopeRef.current === 'sequence') {
              finishSegment(current, segmentsRef.current, 'sequence', new Set([...failedRef.current, path]), seekRef.current, playingRef, setPlaying, setPlayhead, setFade, primaryRef.current, secondaryRef.current)
            }
              }}
            />
          </div>
        </div>
        {active?.item.kind === 'image' && activeSrc ? (
          <div className="z-10" style={activeFrameBox}>
            <div style={mediaScaleLayerStyle()}>
              <img
                style={{ ...mediaContentStyle(activeFrameFit, activeFrameSize, mediaSizes.get(active.item.path) ?? null, active.item.frameScalePercent, active.item.frameFocusX, active.item.frameFocusY), ...(activeMotion ?? {}) }}
                src={activeSrc}
                alt=""
                onLoad={(event) => {
                  const image = event.currentTarget
                  const width = image.naturalWidth
                  const height = image.naturalHeight
                  if (width > 0 && height > 0) {
                    setMediaSizes((existing) => putKnown(existing, active.item.path, {
                      width,
                      height,
                    }))
                  }
                }}
              />
            </div>
          </div>
        ) : null}
        <div className="pointer-events-none" style={{ ...nextFrameBox, opacity: fade }}>
          <div style={mediaScaleLayerStyle()}>
            <video
              ref={secondaryRef}
              className="h-full w-full"
              style={{
                ...mediaContentStyle(nextSegment?.item.frameFit ?? 'contain', nextFrameSize, nextSegment ? mediaSizes.get(nextSegment.item.path) ?? null : null, nextSegment?.item.frameScalePercent, nextSegment?.item.frameFocusX, nextSegment?.item.frameFocusY),
                ...(nextMotion ?? {}),
              }}
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget
                const width = video.videoWidth
                const height = video.videoHeight
                if (!nextSegment || width <= 0 || height <= 0) return
                setMediaSizes((existing) => putKnown(existing, nextSegment.item.path, {
                  width,
                  height,
                }))
              }}
            />
          </div>
        </div>
        {activeFailed ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/75 px-4 text-center text-xs text-white/80">
            <Film className="h-8 w-8" />
            {baseName(active.item.path)} 无法预览，整段播放会跳过
          </div>
        ) : !active ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-white/70">
            <Film className="h-8 w-8" />
            预览不可用
          </div>
        ) : preparingPaths.has(active.item.path) ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 text-xs text-white/80">正在准备预览</div>
        ) : null}
      </div>

      <VideoSequenceControls
        playing={playing}
        muted={muted}
        disabled={controlsDisabled}
        playhead={displayPlayhead}
        total={displayTotal}
        scope={scope}
        rate={rate}
        canStep={segments.length > 1}
        showTransport={showTransport}
        onToggle={togglePlay}
        onMuted={setMuted}
        onScope={changeScope}
        onRate={setRate}
        onScrubStart={() => {
          scrubbing.current = true
          if (playingRef.current) ignorePause.current = true
        }}
        onSeek={(time) => seek(scope === 'clip' && active ? active.timelineStart + time : time, playingRef.current)}
        onScrubEnd={() => {
          scrubbing.current = false
          ignorePause.current = false
          if (!playingRef.current || active?.item.kind === 'image') return
          const video = primaryRef.current
          if (video?.paused) requestVideoPlayback(video, markPlaybackStopped)
        }}
        onStep={step}
        scalePercent={active?.item.frameScalePercent ?? 100}
        onScale={(next) => {
          if (active) merge.updateItemFrameScale(active.item.id, next)
        }}
        fullscreen={previewCanvas.isFullscreen}
        onFullscreen={() => void previewCanvas.toggleFullscreen()}
      />
      </div>
      <VideoSequenceTimeline
        segments={segments}
        activeId={active?.item.id ?? null}
        durations={durations}
        unreadable={unreadable}
        failedPaths={failedPaths}
        draggingId={draggingId}
        dropId={dropId}
        running={merge.running}
        reorderable={showReorder}
        onSeek={(time) => seek(time, playingRef.current)}
        onSelect={merge.setSelectedItemId}
        onDragStart={setDraggingId}
        onDragOver={setDropId}
        onDrop={(targetId, sourceId) => {
          if (sourceId) merge.moveItemTo(sourceId, targetId)
          setDraggingId(null)
          setDropId(null)
        }}
        onDragEnd={() => {
          setDraggingId(null)
          setDropId(null)
        }}
      />
    </section>
  )
}
