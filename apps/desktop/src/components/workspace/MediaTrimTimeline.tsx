import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { MediaMergeItem, MediaMergeTimeline, MediaMergeWaveform } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { formatDuration } from './merge-pane-shared'

export type TrimUpdateHandler = (
  itemId: string,
  field: 'start' | 'end',
  value: number | null,
  duration?: number,
) => void

export function MediaTrimTimeline({
  item,
  duration,
  currentTime,
  disabled,
  timeline,
  waveform,
  onTrim,
}: {
  item: MediaMergeItem
  duration: number
  currentTime: number
  disabled: boolean
  timeline: MediaMergeTimeline | null
  waveform: MediaMergeWaveform | null
  onTrim: TrimUpdateHandler
}) {
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const trimDragRef = useRef<'start' | 'end' | null>(null)
  const dragStateRef = useRef({ start: item.trimStart, endOffset: item.trimEndOffset ?? 0 })
  const [draft, setDraft] = useState<{ start: number; endOffset: number } | null>(null)
  const activeStart = draft?.start ?? item.trimStart
  const activeEndOffset = draft?.endOffset ?? item.trimEndOffset ?? 0
  const visibleEnd = Math.max(0, duration - activeEndOffset)
  const selectedPercent = duration > 0
    ? Math.max(0, Math.min(100, ((visibleEnd - activeStart) / duration) * 100))
    : 0
  const startPercent = duration > 0
    ? Math.max(0, Math.min(100, (activeStart / duration) * 100))
    : 0
  const playheadPercent = duration > 0
    ? Math.max(0, Math.min(100, (currentTime / duration) * 100))
    : 0

  const updateTrimFromClientX = (clientX: number, field: 'start' | 'end', commit: boolean) => {
    const bounds = timelineRef.current?.getBoundingClientRect()
    const drag = dragStateRef.current
    if (!bounds || bounds.width <= 0 || duration <= 0) return
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
    const time = ratio * duration
    if (field === 'start') {
      const next = Math.max(0, Math.min(time, duration - drag.endOffset - 0.1))
      setDraft({ start: next, endOffset: drag.endOffset })
      if (commit) onTrim(item.id, 'start', next, duration)
    } else {
      const nextEnd = Math.max(time, drag.start + 0.1)
      const endOffset = Math.max(0, duration - nextEnd)
      setDraft({ start: drag.start, endOffset })
      if (commit) onTrim(item.id, 'end', endOffset, duration)
    }
  }

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const field = trimDragRef.current
      if (field) updateTrimFromClientX(event.clientX, field, false)
    }
    const onPointerUp = (event: PointerEvent) => {
      const field = trimDragRef.current
      trimDragRef.current = null
      if (!field) return
      updateTrimFromClientX(event.clientX, field, true)
      setDraft(null)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  })

  return (
    <div>
      <div ref={timelineRef} className="relative h-12 touch-none select-none overflow-hidden rounded-md border bg-muted">
        {timeline?.frames.map((frame) => duration > 0 ? (
          <img
            key={`${frame.timeSeconds}-${frame.dataUrl.length}`}
            src={frame.dataUrl}
            alt=""
            className="absolute inset-y-0 h-full max-w-none object-cover opacity-70"
            style={{
              left: `${(frame.timeSeconds / duration) * 100}%`,
              width: `${Math.max(40, 100 / Math.max(1, timeline.frames.length))}%`,
              transform: 'translateX(-50%)',
            }}
          />
        ) : null)}
        <div
          className="absolute inset-y-0 bg-primary/25"
          style={{ left: `${startPercent}%`, width: `${selectedPercent}%` }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${playheadPercent}%` }} />
        <TrimHandle
          field="start"
          percent={startPercent}
          disabled={disabled || duration <= 0}
          onPointerDown={(event) => {
            event.preventDefault()
            dragStateRef.current = { start: item.trimStart, endOffset: item.trimEndOffset ?? 0 }
            trimDragRef.current = 'start'
          }}
          onStep={(direction) => onTrim(
            item.id,
            'start',
            Math.max(0, Math.min(activeStart + direction * 0.1, visibleEnd - 0.1)),
            duration,
          )}
        />
        <TrimHandle
          field="end"
          percent={startPercent + selectedPercent}
          disabled={disabled || duration <= 0}
          onPointerDown={(event) => {
            event.preventDefault()
            dragStateRef.current = { start: item.trimStart, endOffset: item.trimEndOffset ?? 0 }
            trimDragRef.current = 'end'
          }}
          onStep={(direction) => {
            const nextEnd = Math.min(
              duration,
              Math.max(activeStart + 0.1, visibleEnd + direction * 0.1),
            )
            onTrim(item.id, 'end', Math.max(0, duration - nextEnd), duration)
          }}
        />
        <div className="absolute inset-x-2 bottom-1 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>{formatDuration(activeStart)}</span>
          <span>{formatDuration(visibleEnd)}</span>
        </div>
      </div>
      {waveform?.peaks.length ? (
        <div className="mt-2 flex h-10 items-center gap-px overflow-hidden rounded-md border bg-background px-1" aria-hidden>
          {waveform.peaks.map((peak, index) => (
            <span
              key={index}
              className="min-w-px flex-1 rounded-full bg-primary/60"
              style={{ height: `${Math.max(2, Math.min(100, peak * 100))}%` }}
            />
          ))}
        </div>
      ) : waveform?.error ? (
        <div className="mt-2 text-xs text-muted-foreground">音频波形不可用：{waveform.error}</div>
      ) : null}
    </div>
  )
}

function TrimHandle({
  field,
  percent,
  disabled,
  onPointerDown,
  onStep,
}: {
  field: 'start' | 'end'
  percent: number
  disabled: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onStep: (direction: 1 | -1) => void
}) {
  const label = field === 'start' ? '保留开始时间' : '保留结束时间'
  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-disabled={disabled}
      className={cn(
        'absolute inset-y-0 z-10 w-3 cursor-ew-resize bg-primary/70 after:absolute after:inset-y-0 after:-left-2 after:-right-2 after:content-[""]',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      style={{ left: `calc(${percent}% - 6px)` }}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault()
          onStep(-1)
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault()
          onStep(1)
        }
      }}
    >
      <span className="absolute left-1/2 top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
    </div>
  )
}
