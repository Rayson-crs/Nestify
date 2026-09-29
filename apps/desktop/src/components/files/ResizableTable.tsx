import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableCell, TableHead } from '@/components/ui/table'
import type { SearchSortField } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import type { TriStateSortDirection } from '@/lib/workspace'

export function startColumnResize(
  event: ReactPointerEvent<HTMLSpanElement>,
  width: number,
  index: number,
  min: number,
  max: number,
  setWidths: (updater: (current: number[]) => number[]) => void,
): void {
  event.preventDefault()
  event.stopPropagation()
  const handle = event.currentTarget
  const startX = event.clientX
  handle.setPointerCapture(event.pointerId)

  const move = (moveEvent: PointerEvent) => {
    const next = Math.min(max, Math.max(min, width + moveEvent.clientX - startX))
    setWidths((current) => current.map((value, itemIndex) => (itemIndex === index ? next : value)))
  }
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
}

export function useColumnWidths(initial: number[]) {
  const [widths, setWidths] = useState(initial)
  const resize = (index: number, min: number, max: number) => (event: ReactPointerEvent<HTMLSpanElement>) =>
    startColumnResize(event, widths[index] ?? initial[index] ?? min, index, min, max, setWidths)
  return { widths, resize }
}

export function ResizableTable({
  widths,
  children,
}: {
  widths: number[]
  children: ReactNode
}) {
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="data-table-scroll h-full w-full overflow-x-auto overflow-y-scroll">
        <Table
          className="table-fixed"
          containerClassName="overflow-visible"
          style={{ width: `max(100%, ${totalWidth}px)`, minWidth: totalWidth, tableLayout: 'fixed' }}
        >
          <colgroup>
            {widths.map((width, index) => (
              <col key={index} style={{ width, minWidth: width }} />
            ))}
          </colgroup>
          {children}
        </Table>
      </div>
    </div>
  )
}

export function ResizableTableHead({
  width,
  onResize,
  children,
  className,
  'aria-sort': ariaSort,
}: {
  width: number
  onResize: (event: ReactPointerEvent<HTMLSpanElement>) => void
  children: ReactNode
  className?: string
  'aria-sort'?: 'ascending' | 'descending' | 'none'
}) {
  return (
    <TableHead
      style={{ width, minWidth: width }}
      aria-sort={ariaSort}
      className={cn('relative overflow-hidden p-0', className)}
    >
      <div className="flex h-10 items-center">
        <div className="min-w-0 flex-1 overflow-hidden px-2">{children}</div>
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="调整列宽"
          className="flex h-full w-2 shrink-0 cursor-col-resize select-none touch-none items-center justify-center"
          onPointerDown={onResize}
        >
          <span className="h-4 w-px bg-border" />
        </span>
      </div>
    </TableHead>
  )
}

export function PlainResizableHead({
  label,
  width,
  onResize,
}: {
  label: string
  width: number
  onResize: (event: ReactPointerEvent<HTMLSpanElement>) => void
}) {
  return (
    <ResizableTableHead width={width} onResize={onResize} aria-sort="none">
      <span className="block truncate text-sm font-medium">{label}</span>
    </ResizableTableHead>
  )
}

export function SearchSortHeader({
  label,
  field,
  sort,
  direction,
  disabled,
  onSort,
  width,
  onResize,
}: {
  label: string
  field: SearchSortField
  sort: SearchSortField
  direction: TriStateSortDirection
  disabled: boolean
  onSort: (field: SearchSortField) => void
  width: number
  onResize: (event: ReactPointerEvent<HTMLSpanElement>) => void
}) {
  const active = sort === field
  return (
    <ResizableTableHead
      width={width}
      onResize={onResize}
      aria-sort={active ? (direction === 'desc' ? 'descending' : direction === 'asc' ? 'ascending' : 'none') : 'none'}
    >
      <Button
        variant="ghost"
        size="sm"
        className="flex h-10 w-full justify-between px-2"
        disabled={disabled}
        onClick={() => onSort(field)}
      >
        <span className="min-w-0 truncate">{label}</span>
        {active && direction === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5 shrink-0" />
        ) : active && direction === 'desc' ? (
          <ArrowDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
        )}
      </Button>
    </ResizableTableHead>
  )
}

export function TruncatedCell({
  children,
  title,
  className,
  width,
}: {
  children: ReactNode
  title?: string
  className?: string
  width?: number
}) {
  return (
    <TableCell
      className={cn('overflow-hidden p-2 align-middle', className)}
      style={width ? { width, minWidth: 0, maxWidth: width } : { width: 0, maxWidth: 0 }}
    >
      <div className="block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap" title={title}>
        {children}
      </div>
    </TableCell>
  )
}
