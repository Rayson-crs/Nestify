import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
    <label className={cn('relative inline-flex h-4 w-4 items-center justify-center', disabled && 'opacity-50')}>
      <input
        ref={ref}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        {...props}
      />
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded-sm border border-border bg-background text-primary-foreground peer-checked:bg-primary peer-focus-visible:ring-1 peer-focus-visible:ring-ring',
          className,
        )}
      >
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>
    </label>
  ),
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
