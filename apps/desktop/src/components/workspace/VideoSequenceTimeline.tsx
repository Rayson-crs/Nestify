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
  draggingId,
  dropId,
  running,
  onSeek,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  segments: readonly SequenceSegment[]
  activeId: string | null
  durations: Readonly<Record<string, number>>
  unreadable: Readonly<Record<string, boolean>>
  draggingId: string | null
  dropId: string | null
  running: boolean
  onSeek: (time: number) => void
  onSelect: (itemId: string) => void
  onDragStart: (itemId: string) => void
  onDragOver: (itemId: string) => void
  onDrop: (itemId: string, sourceId: string) => void
  onDragEnd: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [capacity, setCapacity] = useState(4)
  const trackRef = useRef<HTMLDivElement | null>(null)
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
          <div className="flex h-16 gap-1 overflow-hidden">
            {visible.map((segment, index) => {
              const active = segment.item.id === activeId
              return (
                <button
                  key={segment.item.id}
                  type="button"
                  draggable={!running}
                  title={segment.item.path}
                  className={cn(
                    'flex h-full min-w-0 flex-1 basis-0 items-center gap-1 rounded-sm px-1.5 text-left text-white/80',
                    active ? 'bg-sky-500 text-white' : 'bg-white/10 hover:bg-white/[0.16]',
                    dropId === segment.item.id && draggingId !== segment.item.id && 'outline outline-2 outline-sky-300',
                    draggingId === segment.item.id && 'opacity-40',
                  )}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
                    onSelect(segment.item.id)
                    onSeek(segment.timelineStart + ratio * segment.length)
                  }}
                  onDragStart={(event) => {
                    onDragStart(segment.item.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', segment.item.id)
                  }}
                  onDragOver={(event) => {
                    if (!draggingId || draggingId === segment.item.id) return
                    event.preventDefault()
                    onDragOver(segment.item.id)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    onDrop(segment.item.id, draggingId ?? event.dataTransfer.getData('text/plain'))
                  }}
                  onDragEnd={onDragEnd}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] leading-4">
                      {hiddenBefore + index + 1}. {baseName(segment.item.path)}
                    </span>
                    <span className={cn('block font-mono text-[10px] leading-4', active ? 'text-white/80' : 'text-white/50')}>
                      {durationLabel(segment.item.id, segment.length, durations, unreadable)}
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
  id: string,
  length: number,
  durations: Readonly<Record<string, number>>,
  unreadable: Readonly<Record<string, boolean>>,
): string {
  if (durations[id] == null) return unreadable[id] ? '时长未知' : '读取中'
  return formatDuration(length)
}
