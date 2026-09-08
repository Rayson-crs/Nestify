from pathlib import Path

root = Path(r"apps/desktop/src")
app_path = root / "App.tsx"
text = app_path.read_text(encoding="utf-8")

old_import = """import { errorMessage } from '@/lib/labels'
import { isWithinDirectory } from '@/lib/path-crumbs'
import type { JobOpRecord, JobRecord } from '@nestify/shared'
import { formatBytes } from '@/lib/utils'
"""
new_import = """import { canRollbackJob, errorMessage, parentName } from '@/lib/labels'
import { isWithinDirectory } from '@/lib/path-crumbs'
import type { JobOpRecord, JobRecord } from '@nestify/shared'
import { formatBytes } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
"""
if old_import not in text:
    raise SystemExit("import block not found")
text = text.replace(old_import, new_import, 1)

old_toggle = """  const toggleSpotlight = useCallback(() => {
    setSpotlightOpen((open) => {
      if (!open) {
        setClosePromptOpen(false)
        setEditingLibraryId(null)
      }
      return !open
    })
  }, [])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onUiEvent) return
    return api.onUiEvent((event) => {
      if (event === 'window:close-requested') {
        setSpotlightOpen(false)
        setClosePromptOpen(true)
        return
      }
      toggleSpotlight()
    })
  }, [toggleSpotlight])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCtrlEsc = event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Escape'
      const isCtrlSpace = event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'Space'
      if (!isCtrlEsc && !isCtrlSpace) return
      event.preventDefault()
      event.stopPropagation()
      toggleSpotlight()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [toggleSpotlight])
"""
new_toggle = """  const lastSpotlightToggleAt = useRef(0)
  const toggleSpotlight = useCallback((source = 'unknown') => {
    const now = Date.now()
    if (now - lastSpotlightToggleAt.current < 250) {
      console.info('[Nestify] spotlight.toggle ignored duplicate', { source })
      return
    }
    lastSpotlightToggleAt.current = now
    setSpotlightOpen((open) => {
      console.info('[Nestify] spotlight.toggle', { source, next: !open })
      if (!open) {
        setClosePromptOpen(false)
        setEditingLibraryId(null)
      }
      return !open
    })
  }, [])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onUiEvent) return
    return api.onUiEvent((event) => {
      console.info('[Nestify] ui event', event)
      if (event === 'window:close-requested') {
        setSpotlightOpen(false)
        setClosePromptOpen(true)
        return
      }
      toggleSpotlight('ipc')
    })
  }, [toggleSpotlight])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCtrlEsc = event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Escape'
      const isCtrlSpace = event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'Space'
      if (!isCtrlEsc && !isCtrlSpace) return
      event.preventDefault()
      event.stopPropagation()
      console.info('[Nestify] spotlight keydown', { key: event.key, code: event.code })
      toggleSpotlight(isCtrlEsc ? 'renderer-ctrl-esc' : 'renderer-ctrl-space')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [toggleSpotlight])
"""
if old_toggle not in text:
    raise SystemExit("toggle block not found")
text = text.replace(old_toggle, new_toggle, 1)
app_path.write_text(text, encoding="utf-8")
print("app imports and spotlight debounce updated", text.count("\\n") + 1)
