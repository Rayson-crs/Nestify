import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function ToastViewport({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {children}
      <ToastPrimitive.Viewport className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex max-h-screen w-auto flex-col gap-2 outline-none sm:left-auto sm:right-4 sm:w-[26rem]" />
    </ToastPrimitive.Provider>
  )
}

export function Toast({
  title,
  description,
  variant = 'default',
  onClose,
}: {
  title?: string
  description: string
  variant?: 'default' | 'destructive'
  onClose?: () => void
}) {
  return (
    <ToastPrimitive.Root
      role={variant === 'destructive' ? 'alert' : 'status'}
      defaultOpen
      className={cn(
        'pointer-events-auto relative flex items-start gap-3 rounded-md border bg-background p-4 text-sm shadow-lg transition data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-full',
        variant === 'destructive' ? 'border-destructive/50 text-destructive' : 'text-foreground',
      )}
    >
      <ToastPrimitive.Description asChild>
        <div className="min-w-0 flex-1">
          {title ? <div className="font-medium">{title}</div> : null}
          <div className={cn(title && 'mt-1', 'break-words text-muted-foreground')}>{description}</div>
        </div>
      </ToastPrimitive.Description>
      <ToastPrimitive.Close asChild>
        <Button type="button" variant="ghost" size="icon" className="-mr-2 -mt-2 shrink-0" aria-label="关闭提示" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  )
}
