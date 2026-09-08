from pathlib import Path
Path('apps/desktop/src/app/useSpotlight.ts').write_text(r'''import { useCallback, useEffect, useRef, useState } from 'react'
import { ALL_LIBRARIES_ID, callNestify, getNestifyApi, type SearchHit } from '@/lib/ipc'

export function useSpotlight(options: { ipcReady: boolean; hasLibraries: boolean }) {
  const spotlightTimer = useRef<number | null>(null)
  const lastOpenAt = useRef(0)
  const [spotlightOpen, setSpotlightOpenState] = useState(false)
  const [spotlightQuery, setSpotlightQuery] = useState('')
  const [spotlightHits, setSpotlightHits] = useState<SearchHit[]>([])
  const [spotlightBusy, setSpotlightBusy] = useState(false)
  const [spotlightActiveIndex, setSpotlightActiveIndex] = useState(0)

  const setSpotlightOpen = useCallback((open: boolean, source = 'unknown') => {
    const now = Date.now()
    if (open && now - lastOpenAt.current < 250) {
      console.info('[Nestify] spotlight.open ignored duplicate', { source })
      return
    }
    if (open) lastOpenAt.current = now
    console.info('[Nestify] spotlight.openChange', { source, open })
    setSpotlightOpenState(open)
    if (open) {
      setSpotlightQuery('')
      setSpotlightActiveIndex(0)
    }
  }, [])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onUiEvent) return
    return api.onUiEvent((event) => {
      console.info('[Nestify] ui event', event)
      if (event === 'spotlight:open') setSpotlightOpen(true, 'ipc')
    })
  }, [setSpotlightOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey
      const isCtrlEsc = ctrlOnly && (event.key === 'Escape' || event.code === 'Escape')
      const isCtrlSpace = ctrlOnly && (event.code === 'Space' || event.key === ' ')
      if (!isCtrlEsc && !isCtrlSpace) return
      event.preventDefault()
      event.stopPropagation()
      console.info('[Nestify] spotlight keydown', { key: event.key, code: event.code })
      setSpotlightOpen(true, isCtrlEsc ? 'renderer-ctrl-esc' : 'renderer-ctrl-space')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [setSpotlightOpen])

  useEffect(() => {
    if (!spotlightOpen || !options.ipcReady || !options.hasLibraries) {
      setSpotlightHits([])
      setSpotlightBusy(false)
      return
    }

    if (spotlightTimer.current) window.clearTimeout(spotlightTimer.current)
    spotlightTimer.current = window.setTimeout(() => {
      let cancelled = false
      setSpotlightBusy(true)
      void callNestify((api) =>
        api.searchQuery({
          libraryId: ALL_LIBRARIES_ID,
          text: spotlightQuery.trim(),
          limit: 8,
          sort: { field: 'name', direction: 'asc' },
        }),
      )
        .then(({ result }) => {
          if (cancelled) return
          setSpotlightHits(result.hits)
          setSpotlightActiveIndex(0)
        })
        .catch(() => {
          if (!cancelled) setSpotlightHits([])
        })
        .finally(() => {
          if (!cancelled) setSpotlightBusy(false)
        })
    }, 180)

    return () => {
      if (spotlightTimer.current) window.clearTimeout(spotlightTimer.current)
    }
  }, [options.hasLibraries, options.ipcReady, spotlightOpen, spotlightQuery])

  return {
    spotlightOpen,
    setSpotlightOpen,
    spotlightQuery,
    setSpotlightQuery,
    spotlightHits,
    spotlightBusy,
    spotlightActiveIndex,
    setSpotlightActiveIndex,
  }
}
''', encoding='utf-8')
print('useSpotlight.ts written')
