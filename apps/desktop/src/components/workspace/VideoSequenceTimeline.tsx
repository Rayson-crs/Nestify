import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { baseName, formatDuration } from './merge-pane-shared'
import type { SequenceSegment } from './video-sequence'

export function VideoSequenceTimeline({
  segments,
  activeId,
  durations,
  unreadable,
  failedPaths,
  draggingId,
  dropId,
  running,
  reorderable = true,
  onSeek,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  segments: readonly SequenceSegment[]
  activeId: string | null
  durations: ReadonlyMap<string, number>
  unreadable: ReadonlySet<string>
  failedPaths: ReadonlySet<string>
  draggingId: string | null
  dropId: string | null
  running: boolean
  reorderable?: boolean
  onSeek: (time: number) => void
  onSelect: (itemId: string) => void
  onDragStart: (itemId: string) => void
  onDragOver: (itemId: string | null) => void
  onDrop: (itemId: string, sourceId: string) => void
  onDragEnd: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [capacity, setCapacity] = useState(4)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const pointerDragRef = useRef<{
    pointerId: number
    sourceId: string
    startX: number
    startY: number
    targetId: string | null
    dragging: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const activeIndex = Math.max(0, segments.findIndex((segment) => segment.item.id === activeId))
  const pageSize = Math.max(1, capacity)
  const maxOffset = Math.max(0, segments.length - pageSize)
  const start = Math.min(offset, maxOffset)
  const visible = segments.slice(start, start + pageSize)
  const hiddenBefore = start
  const hiddenAfter = Math.max(0, segments.length - (start + visible.length))

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const update = () => {
      const width = track.clientWidth
      setCapacity(Math.max(1, Math.floor((width + 4) / 180)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setOffset((current) => {
      const limit = Math.max(0, segments.length - pageSize)
      if (activeIndex < current) return activeIndex
      if (activeIndex >= current + pageSize) return Math.max(0, activeIndex - pageSize + 1)
      return Math.min(current, limit)
    })
  }, [activeIndex, pageSize, segments.length])

  useEffect(() => {
    const setDraggingCursor = () => document.documentElement.classList.add('nestify-timeline-dragging')
    const clearDraggingCursor = () => document.documentElement.classList.remove('nestify-timeline-dragging')
    const updateTarget = (event: PointerEvent) => {
      const drag = pointerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.dragging) {
        const deltaX = event.clientX - drag.startX
        const deltaY = event.clientY - drag.startY
        if (deltaX * deltaX + deltaY * deltaY < 16) return
        drag.dragging = true
        suppressClickRef.current = true
        setDraggingCursor()
        onDragStart(drag.sourceId)
      }
      event.preventDefault()
      const targetId = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-segment-id]')
        ?.getAttribute('data-segment-id') ?? null
      if (targetId !== drag.targetId) {
        drag.targetId = targetId
        onDragOver(targetId)
      }
    }
    const finish = (event: PointerEvent) => {
      const drag = pointerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      pointerDragRef.current = null
      clearDraggingCursor()
      if (!drag.dragging) return
      if (drag.targetId && drag.targetId !== drag.sourceId) onDrop(drag.targetId, drag.sourceId)
      onDragEnd()
    }
    const cancel = (event: PointerEvent) => {
      const drag = pointerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      pointerDragRef.current = null
      clearDraggingCursor()
      if (drag.dragging) onDragEnd()
    }
    const cancelNativeDrag = (event: DragEvent) => {
      if (pointerDragRef.current?.dragging) event.preventDefault()
    }
    const cancelOnBlur = () => {
      const drag = pointerDragRef.current
      if (!drag?.dragging) return
      pointerDragRef.current = null
      clearDraggingCursor()
      onDragEnd()
    }

    window.addEventListener('pointermove', updateTarget, { capture: true })
    window.addEventListener('pointerup', finish, { capture: true })
    window.addEventListener('pointercancel', cancel, { capture: true })
    window.addEventListener('dragstart', cancelNativeDrag, { capture: true })
    window.addEventListener('blur', cancelOnBlur)
    return () => {
      window.removeEventListener('pointermove', updateTarget, { capture: true })
      window.removeEventListener('pointerup', finish, { capture: true })
      window.removeEventListener('pointercancel', cancel, { capture: true })
      window.removeEventListener('dragstart', cancelNativeDrag, { capture: true })
      window.removeEventListener('blur', cancelOnBlur)
      clearDraggingCursor()
    }
  }, [onDragEnd, onDragOver, onDragStart, onDrop])

  return (
    <div className="space-y-1.5">
      <div className="flex items-stretch gap-1">
        <PageButton
          hidden={hiddenBefore === 0}
          label={`前面还有 ${hiddenBefore} 段`}
          onClick={() => setOffset((current) => Math.max(0, current - pageSize))}
        >
          <ChevronLeft className="h-4 w-4" />
        </PageButton>
        <div ref={trackRef} className="relative min-w-0 flex-1 overflow-hidden rounded-md bg-zinc-950 p-1">
          <div className="flex h-16 touch-none select-none gap-1 overflow-hidden">
            {visible.map((segment, index) => {
              const active = segment.item.id === activeId
              return (
                <button
                  key={segment.item.id}
                  type="button"
                  draggable={false}
                  data-segment-id={segment.item.id}
                  title={segment.item.path}
                  className={cn(
                    'flex h-full min-w-0 flex-1 basis-0 items-center gap-1 rounded-sm px-1.5 text-left text-white/80',
                    active ? 'bg-sky-500 text-white' : 'bg-white/10 hover:bg-white/[0.16]',
                    dropId === segment.item.id && draggingId !== segment.item.id && 'outline outline-2 outline-sky-300',
                    draggingId === segment.item.id && 'opacity-40',
                    reorderable && !running && 'cursor-grab',
                    draggingId === segment.item.id && 'cursor-grabbing',
                  )}
                  onClick={(event) => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
                    onSelect(segment.item.id)
                    onSeek(segment.timelineStart + ratio * segment.length)
                  }}
                  onPointerDown={(event) => {
                    if (!reorderable || running || event.button !== 0 || !event.isPrimary) return
                    suppressClickRef.current = false
                    event.preventDefault()
                    pointerDragRef.current = {
                      pointerId: event.pointerId,
                      sourceId: segment.item.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      targetId: null,
                      dragging: false,
                    }
                  }}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] leading-4">
                      {hiddenBefore + index + 1}. {baseName(segment.item.path)}
                    </span>
                    <span className={cn('block font-mono text-[10px] leading-4', active ? 'text-white/80' : 'text-white/50')}>
                      {durationLabel(segment, durations, unreadable, failedPaths)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <PageButton
          hidden={hiddenAfter === 0}
          label={`后面还有 ${hiddenAfter} 段`}
          onClick={() => setOffset((current) => Math.min(maxOffset, current + pageSize))}
        >
          <ChevronRight className="h-4 w-4" />
        </PageButton>
      </div>
      <p className="text-xs text-muted-foreground">拖动色块改顺序，点击色块定位。片段较多时用两侧箭头翻页。</p>
    </div>
  )
}

function PageButton({
  hidden,
  label,
  onClick,
  children,
}: {
  hidden: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  if (hidden) return null
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex w-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function durationLabel(
  segment: SequenceSegment,
  durations: ReadonlyMap<string, number>,
  unreadable: ReadonlySet<string>,
  failedPaths: ReadonlySet<string>,
): string {
  if (failedPaths.has(segment.item.path)) return '预览失败'
  if (segment.item.kind === 'image') return formatDuration(segment.length)
  if (!durations.has(segment.item.path)) return unreadable.has(segment.item.path) ? '时长未知' : formatDuration(segment.length)
  return formatDuration(segment.length)
}
