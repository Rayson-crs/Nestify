import { cn } from '@/lib/utils'

export interface ProgressProps {
  value?: number | null
  className?: string
  indicatorClassName?: string
}

export function Progress({ value = 0, className, indicatorClassName }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}>
      <div
        className={cn('h-full w-full flex-1 bg-primary transition-all', indicatorClassName)}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </div>
  )
}
