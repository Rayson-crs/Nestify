import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'

export function FieldHint({ label, text }: { label: string; text: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hideTimer = useRef(0)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  const clearHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = 0
  }

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 288
    const left = rect.right + 8 + width > window.innerWidth ? Math.max(8, rect.left - width - 8) : rect.right + 8
    const top = Math.min(Math.max(8, rect.top), window.innerHeight - 148)
    clearHide()
    setCoords({ top, left })
    setOpen(true)
  }

  const hide = () => {
    clearHide()
    hideTimer.current = window.setTimeout(() => setOpen(false), 80)
  }

  useEffect(() => () => clearHide(), [])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`${label}说明`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[180] w-[min(18rem,calc(100vw-1rem))] rounded-md border bg-popover px-3 py-2 text-xs leading-5 text-popover-foreground shadow-md"
          style={{ top: coords.top, left: coords.left }}
        >
          {text}
        </div>,
        document.body,
      ) : null}
    </>
  )
}

export function HintLabel({
  label,
  hint,
  className,
}: {
  label: string
  hint: string
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <span>{label}</span>
      <FieldHint label={label} text={hint} />
    </span>
  )
}
