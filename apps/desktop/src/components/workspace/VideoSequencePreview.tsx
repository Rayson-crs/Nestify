import { useEffect, useMemo, useRef, useState } from 'react'
import { Film } from 'lucide-react'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { callNestify, type MediaMergeItem } from '@/lib/ipc'
import { formatDuration, mediaFileUrl, splitSelectedPaths } from './merge-pane-shared'
import { buildSegments, mapInBatches, nativePlaybackRate, NATIVE_PLAYBACK_RATE_LIMIT, prioritizeByActive, segmentAt, type SequenceSegment } from './video-sequence'
import { VideoSequenceControls } from './VideoSequenceControls'
import { VideoSequenceTimeline } from './VideoSequenceTimeline'

export function VideoSequencePreview({ merge }: { merge: MediaMergeController }) {
  const videos = useMemo(() => merge.items.filter((item) => item.kind === 'video' || item.kind === 'image'), [merge.items])
  const fileSetKey = useMemo(() => [...videos.map((item) => item.path)].sort().join('\n'), [videos])
  const [sources, setSources] = useState<Record<string, string>>({})
  const [durations, setDurations] = useState<Record<string, number>>({})
  const [unreadable, setUnreadable] = useState<Record<string, boolean>>({})
  const [previewFailed, setPreviewFailed] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [scope, setScope] = useState<'sequence' | 'clip'>('sequence')
  const [rate, setRate] = useState(1)
  const [activeId, setActiveId] = useState<string | null>(videos[0]?.id ?? null)
  const [fade, setFade] = useState(0)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const primaryRef = useRef<HTMLVideoElement | null>(null)
  const secondaryRef = useRef<HTMLVideoElement | null>(null)
  const durationsRef = useRef(durations)
  const pendingSeek = useRef<number | null>(null)
  const playingRef = useRef(false)
  const ignorePause = useRef(false)
  const scrubbing = useRef(false)
  const scopeRef = useRef(scope)
  const resumeAfterSourceChange = useRef(false)
  const rateRef = useRef(rate)
  const fastSeekAt = useRef(0)
  const imageClock = useRef(0)
  const transition = merge.videoSettings.transition ?? { type: 'none' as const, durationSeconds: 0 }
  const overlap = transition.type === 'crossfade' ? Math.max(0, transition.durationSeconds) : 0
  const segments = useMemo(() => buildSegments(videos, durations, overlap), [durations, overlap, videos])
  const total = segments.at(-1)?.timelineEnd ?? 0
  const active = segments.find((segment) => segment.item.id === activeId) ?? null
  const activeRef = useRef(active)
  activeRef.current = active
  const activeIndex = Math.max(0, segments.findIndex((segment) => segment.item.id === active?.item.id))
  const activeSrc = active ? sources[active.item.id] || mediaFileUrl(active.item.path) : ''
  const orderKey = videos.map((item) => item.id).join('\n')
  const knownCount = segments.filter((segment) => durations[segment.item.id] != null).length
  const failedCount = segments.filter((segment) => unreadable[segment.item.id] && durations[segment.item.id] == null).length
  const statusText = statusLabel(previewFailed, segments.length, knownCount, failedCount, total)
  const displayTotal = scope === 'clip' && active ? active.length : total
  const displayPlayhead = scope === 'clip' && active ? Math.max(0, playhead - active.timelineStart) : playhead
  durationsRef.current = durations
  scopeRef.current = scope
  rateRef.current = rate
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    if (scopeRef.current !== 'sequence' || !activeId) return
    const segment = segments.find((entry) => entry.item.id === activeId)
    if (!segment) return
    const mediaTime = segment.item.kind === 'image' ? null : pendingSeek.current ?? primaryRef.current?.currentTime
    const sourceTime = mediaTime != null && Number.isFinite(mediaTime)
      ? mediaTime
      : segment.sourceStart + Math.max(0, playheadRef.current - segment.timelineStart)
    const nextPlayhead = segment.timelineStart + Math.max(0, Math.min(sourceTime, segment.sourceEnd) - segment.sourceStart)
    setPlayhead((current) => Math.abs(current - nextPlayhead) < 0.05 ? current : nextPlayhead)
  }, [activeId, orderKey, segments])

  useEffect(() => {
    const video = primaryRef.current
    if (video) video.muted = muted
  }, [activeSrc, muted])

  useEffect(() => {
    const video = primaryRef.current
    if (video) video.playbackRate = nativePlaybackRate(rate)
    if (secondaryRef.current) secondaryRef.current.playbackRate = nativePlaybackRate(rate)
  }, [activeSrc, rate])

  useEffect(() => {
    const video = primaryRef.current
    if (!video || !resumeAfterSourceChange.current || !activeSrc) return
    if (active?.item.kind === 'image') return
    resumeAfterSourceChange.current = false
    video.playbackRate = nativePlaybackRate(rate)
    void video.play().catch(() => setPlaying(false))
  }, [activeSrc, rate])

  useEffect(() => {
    let cancelled = false
    const selectedPaths = splitSelectedPaths(fileSetKey)
    setSources({})
    setPreviewFailed(false)
    setDurations({})
    setUnreadable({})
    setPlaying(false)
    playingRef.current = false
    setPlayhead(0)
    setFade(0)
    void mapInBatches(
      prioritizeByActive(videos, activeId),
      3,
      () => cancelled,
      (item) => readClip(item, selectedPaths, () => cancelled),
      (result) => {
        if (result.src) {
          setSources((current) => current[result.id] === result.src ? current : { ...current, [result.id]: result.src })
        }
        if (result.duration > 0) {
          setDurations((current) => current[result.id] === result.duration ? current : { ...current, [result.id]: result.duration })
          return
        }
        setUnreadable((current) => current[result.id] ? current : { ...current, [result.id]: true })
      },
    )
    return () => {
      cancelled = true
    }
  }, [fileSetKey, videos])

  const seekRef = useRef<(time: number, autoplay?: boolean) => void>(() => undefined)

    const seek = (time: number, autoplay = playingRef.current) => {
    const segment = segmentAt(segments, time)
    if (!segment) return
    const local = segment.sourceStart + Math.max(0, time - segment.timelineStart)
    setActiveId(segment.item.id)
    setPlayhead(Math.min(time, segment.timelineEnd))
    setFade(0)
    clearSecondary(secondaryRef.current)
    const video = primaryRef.current
    if (!video) return
    if (segment.item.kind === 'image') {
      ignorePause.current = true
      video.pause()
      video.removeAttribute('src')
      video.load()
      imageClock.current = performance.now()
      return
    }
    pendingSeek.current = local
    const src = sources[segment.item.id] || mediaFileUrl(segment.item.path)
    video.playbackRate = nativePlaybackRate(rate)
    video.muted = muted
    if (src && video.currentSrc !== src && video.getAttribute('src') !== src) {
      ignorePause.current = true
      video.src = src
    } else {
      if (autoplay) ignorePause.current = true
      video.currentTime = local
    }
    if (autoplay) void video.play().catch(() => setPlaying(false))
  }
  seekRef.current = seek

  useEffect(() => {
    if (!playing || active?.item.kind !== 'image') return
    const offset = Math.max(0, playheadRef.current - active.timelineStart)
    imageClock.current = performance.now() - (offset / Math.max(rateRef.current, 0.25)) * 1000
    const segment = active
    const timer = window.setInterval(() => {
      if (!playingRef.current) return
      const elapsed = ((performance.now() - imageClock.current) / 1000) * rateRef.current
      const next = Math.min(segment.timelineEnd, segment.timelineStart + elapsed)
      setPlayhead(next)
      if (next >= segment.timelineEnd - 0.05) {
        if (scopeRef.current !== 'sequence') {
          playingRef.current = false
          resumeAfterSourceChange.current = false
          setPlaying(false)
          setPlayhead(segment.timelineEnd)
          return
        }
        seekRef.current(segment.timelineEnd + 0.01, true)
      }
    }, 80)
    return () => window.clearInterval(timer)
  }, [active, playing])

  const togglePlay = () => {
    if (!active || !activeSrc || previewFailed) return
    if (playing) {
      playingRef.current = false
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
      : (restart ? 0 : playhead)
    setPlaying(true)
    playingRef.current = true
    resumeAfterSourceChange.current = true
    seek(start, true)
  }

  const changeScope = (next: 'sequence' | 'clip') => {
    scopeRef.current = next
    setScope(next)
    if (next === 'clip') {
      resumeAfterSourceChange.current = false
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
    const next = segments[activeIndex + direction]
    if (!next) return
    setPlaying(true)
    playingRef.current = true
    resumeAfterSourceChange.current = true
    seek(next.timelineStart, true)
  }

  const advance = (segment: SequenceSegment) => {
    if (scopeRef.current === 'clip') {
      playingRef.current = false
      resumeAfterSourceChange.current = false
      primaryRef.current?.pause()
      secondaryRef.current?.pause()
      setPlaying(false)
      setPlayhead(segment.timelineEnd)
      setFade(0)
      return
    }
    const index = segments.findIndex((entry) => entry.item.id === segment.item.id)
    const next = segments[index + 1]
    if (!next) {
      playingRef.current = false
      primaryRef.current?.pause()
      secondaryRef.current?.pause()
      setPlaying(false)
      setPlayhead(total)
      setFade(0)
      return
    }
    playingRef.current = true
    setPlaying(true)
    resumeAfterSourceChange.current = true
    seek(next.timelineStart, true)
  }

  return (
    <section className="space-y-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">拼接预览</div>
        <div className="truncate text-xs text-muted-foreground">
          {statusText}
          {overlap > 0 ? ` · 交界重叠 ${formatDuration(overlap)}` : ''}
          {scope === 'clip' && active ? ` · 正在预览 ${activeIndex + 1}/${segments.length}` : ''}
        </div>
      </div>

      <div className="relative aspect-video overflow-hidden rounded-md bg-black">
        <video
          ref={primaryRef}
          className={draggingId ? 'pointer-events-none absolute inset-0 h-full w-full' : 'absolute inset-0 h-full w-full'}
          style={{ opacity: 1 - fade }}
          src={active?.item.kind === 'image' ? undefined : activeSrc || undefined}
          hidden={active?.item.kind === 'image'}
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => {
            const pending = pendingSeek.current
            pendingSeek.current = null
            rememberDuration(event.currentTarget, active?.item.id, pending, active?.sourceStart ?? 0, setDurations)
          }}
          onDurationChange={(event) => rememberDuration(event.currentTarget, active?.item.id, null, null, setDurations)}
          onTimeUpdate={(event) => {
            if (!active || active.item.kind === 'image') return
            const local = event.currentTarget.currentTime
            const output = active.timelineStart + Math.max(0, local - active.sourceStart)
            setPlayhead(Math.min(active.timelineEnd, output))
            updateCrossfade({
              active,
              segments,
              local,
              overlap,
              fade,
              sources,
              playing: playingRef.current,
              scope: scopeRef.current,
              rate: rateRef.current,
              secondary: secondaryRef.current,
              setFade,
            })
            if (playingRef.current && local >= active.sourceEnd - 0.05) advance(active)
            scrubFastPlayback(event.currentTarget, active, rateRef.current, playingRef.current, fastSeekAt)
          }}
          onEnded={() => {
            const current = activeRef.current
            if (current && current.item.kind !== 'image') advance(current)
          }}
          onPlay={() => {
            ignorePause.current = false
          }}
          onPause={() => {
            if (ignorePause.current || scrubbing.current) return
            const current = activeRef.current
            const video = primaryRef.current
            const reachedEnd = current != null && video != null && (
              video.ended || video.currentTime >= current.sourceEnd - 0.08
            )
            if (playingRef.current && (current?.item.kind === 'image' || (scopeRef.current === 'sequence' && reachedEnd))) return
            if (playingRef.current) setPlaying(false)
          }}
          onError={() => {
            if (activeRef.current?.item.kind === 'image') return
            if (!primaryRef.current?.getAttribute('src')) return
            setPreviewFailed(true)
          }}
        />
        {active?.item.kind === 'image' && activeSrc ? (
          <img className="absolute inset-0 z-10 h-full w-full bg-black object-contain" src={activeSrc} alt="" />
        ) : null}
        <video
          ref={secondaryRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ opacity: fade }}
          playsInline
          preload="auto"
          muted
        />
        {!active || previewFailed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-white/70">
            <Film className="h-8 w-8" />
            {previewFailed ? '当前格式无法预览' : '预览不可用'}
          </div>
        ) : null}
      </div>

      <VideoSequenceControls
        playing={playing}
        muted={muted}
        disabled={!active || !activeSrc || previewFailed}
        playhead={displayPlayhead}
        total={displayTotal}
        scope={scope}
        rate={rate}
        canStep={segments.length > 1}
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
          if (!playingRef.current) return
          const video = primaryRef.current
          if (video && video.paused && active?.item.kind !== 'image') {
            void video.play().catch(() => setPlaying(false))
          }
        }}
        onStep={step}
      />
      <VideoSequenceTimeline
        segments={segments}
        activeId={active?.item.id ?? null}
        durations={durations}
        unreadable={unreadable}
        draggingId={draggingId}
        dropId={dropId}
        running={merge.running}
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

function statusLabel(failed: boolean, count: number, known: number, unreadableCount: number, total: number): string {
  if (failed) return '当前格式无法预览'
  if (count === 0) return '没有可预览的视频'
  if (known < count && unreadableCount === 0) return `正在读取片段时长（${known}/${count}）`
  if (unreadableCount > 0) return `${unreadableCount} 个片段未能读取时长`
  return `输出 ${formatDuration(total)}`
}

async function readClip(
  item: MediaMergeItem,
  selectedPaths: string[],
  cancelled: () => boolean,
): Promise<{ id: string; src: string; duration: number }> {
  if (item.kind === 'image') {
    return { id: item.id, src: mediaFileUrl(item.path), duration: Math.min(120, Math.max(0.2, item.imageDurationSeconds ?? 3)) }
  }
  if (cancelled()) return { id: item.id, src: '', duration: 0 }
  try {
    const preview = await callNestify((api) =>
      api.mediaMergePreview
        ? api.mediaMergePreview({ path: item.path, selectedPaths })
        : Promise.resolve({ kind: 'none' as const }),
    )
    const src = preview.kind === 'video' ? preview.src ?? mediaFileUrl(item.path) : ''
    const result = await callNestify((api) =>
      api.mediaMergeDuration
        ? api.mediaMergeDuration({ path: item.path, selectedPaths })
        : Promise.resolve({ durationSeconds: 0, error: '时长接口不可用' }),
    )
    return { id: item.id, src, duration: result.durationSeconds }
  } catch {
    return { id: item.id, src: '', duration: 0 }
  }
}

function clearSecondary(video: HTMLVideoElement | null): void {
  if (!video) return
  video.pause()
  video.dataset.itemId = ''
}

function rememberDuration(
  video: HTMLVideoElement,
  itemId: string | undefined,
  pending: number | null,
  fallback: number | null,
  setDurations: (update: (current: Record<string, number>) => Record<string, number>) => void,
): void {
  const nextDuration = video.duration
  if (itemId && Number.isFinite(nextDuration) && nextDuration > 0) {
    setDurations((current) => current[itemId] === nextDuration ? current : { ...current, [itemId]: nextDuration })
  }
  if (fallback == null) return
  video.currentTime = pending ?? fallback
}

function updateCrossfade(input: {
  active: SequenceSegment
  segments: readonly SequenceSegment[]
  local: number
  overlap: number
  fade: number
  sources: Readonly<Record<string, string>>
  playing: boolean
  scope: 'sequence' | 'clip'
  rate: number
  secondary: HTMLVideoElement | null
  setFade: (value: number) => void
}): void {
  const next = input.segments[input.segments.findIndex((segment) => segment.item.id === input.active.item.id) + 1]
  const remaining = input.active.sourceEnd - input.local
  if (input.scope === 'sequence' && input.overlap > 0 && next && remaining <= input.overlap && remaining > 0) {
    const src = input.sources[next.item.id]
    if (input.secondary && src && input.secondary.dataset.itemId !== next.item.id) {
      input.secondary.dataset.itemId = next.item.id
      input.secondary.src = src
      input.secondary.playbackRate = nativePlaybackRate(input.rate)
      input.secondary.currentTime = next.sourceStart
      if (input.playing) void input.secondary.play().catch(() => undefined)
    }
    input.setFade(1 - remaining / input.overlap)
    return
  }
  if (input.fade !== 0) input.setFade(0)
}

function scrubFastPlayback(
  video: HTMLVideoElement,
  active: SequenceSegment,
  rate: number,
  playing: boolean,
  lastSeekAt: { current: number },
): void {
  if (!playing || rate <= NATIVE_PLAYBACK_RATE_LIMIT) return
  const now = performance.now()
  if (now - lastSeekAt.current < 80) return
  lastSeekAt.current = now
  const step = ((rate - NATIVE_PLAYBACK_RATE_LIMIT) * 0.08)
  const next = Math.min(active.sourceEnd - 0.05, video.currentTime + step)
  if (next > video.currentTime + 0.02) video.currentTime = next
}
