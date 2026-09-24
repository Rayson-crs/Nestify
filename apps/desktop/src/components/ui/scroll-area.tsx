import * as React from 'react'
import { cn } from '@/lib/utils'

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { horizontal?: boolean }
>(({ className, children, horizontal = true, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'app-scroll relative rounded-[inherit]',
      horizontal ? 'overflow-auto' : 'overflow-y-auto overflow-x-hidden',
      className,
    )}
    {...props}
  >
    {children}
  </div>
))
ScrollArea.displayName = 'ScrollArea'

export { ScrollArea }
