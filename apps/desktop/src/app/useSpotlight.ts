import { useCallback, useState } from 'react'
import { callNestify, type SearchHit } from '@/lib/ipc'

export function useSpotlight(_options: { ipcReady: boolean; hasLibraries: boolean }) {
  const [spotlightOpen, setSpotlightOpenState] = useState(false)

  const setSpotlightOpen = useCallback((open: boolean) => {
    setSpotlightOpenState(open)
    void callNestify((api) => {
      if (open) return api.openSpotlight?.() ?? Promise.resolve({ ok: true as const })
      return api.closeSpotlight?.() ?? Promise.resolve({ ok: true as const })
    }).catch(() => undefined)
  }, [])

  return {
    spotlightOpen,
    setSpotlightOpen,
    spotlightQuery: '',
    setSpotlightQuery: () => undefined,
    spotlightHits: [] as SearchHit[],
    spotlightBusy: false,
    spotlightActiveIndex: 0,
    setSpotlightActiveIndex: () => undefined,
  }
}
