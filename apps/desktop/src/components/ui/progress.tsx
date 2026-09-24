import { cn } from '@/lib/utils'

export interface ProgressProps {
  value?: number | null
  className?: string
  indicatorClassName?: string
  indeterminate?: boolean
}

export function Progress({ value = 0, className, indicatorClassName, indeterminate = false }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div
      className={cn(
        'relative h-2 w-full shrink-0 overflow-hidden rounded-full bg-muted',
        indeterminate && 'progress-indeterminate',
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
    >
      {indeterminate ? null : (
        <div
          className={cn('h-full rounded-full bg-primary transition-[width] duration-200', indicatorClassName)}
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  )
}
