import fs from 'node:fs'

function write(path, content) {
  fs.writeFileSync(path, content.replaceAll('\r\n', '\n'))
}

const tablePath = 'apps/desktop/src/components/files/ResizableTable.tsx'
let table = fs.readFileSync(tablePath, 'utf8')
table = table.replace(
  `    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <ScrollArea className="h-full w-full">
        <Table
          className="table-fixed"
          containerClassName="overflow-visible"
          style={{ width: totalWidth, minWidth: totalWidth, tableLayout: 'fixed' }}
        >`,
  `    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <ScrollArea className="h-full w-full">
        <Table
          className="table-fixed"
          containerClassName="overflow-hidden"
          style={{ width: '100%', minWidth: totalWidth, maxWidth: '100%', tableLayout: 'fixed' }}
        >`,
)
table = table.replace(
  `      style={width ? { width, minWidth: width, maxWidth: width } : { maxWidth: 0 }}
    >
      <div className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={title}>`,
  `      style={width ? { width, minWidth: 0, maxWidth: width } : { maxWidth: 0 }}
    >
      <div className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={title}>`,
)
write(tablePath, table)

write('apps/desktop/src/app/useSpotlight.ts', `import { useCallback, useEffect, useRef, useState } from 'react'
import { ALL_LIBRARIES_ID, callNestify, getNestifyApi, type SearchHit } from '@/lib/ipc'

const OPEN_GUARD_MS = 400

function isSpotlightHotkey(event: KeyboardEvent): 'ctrl-esc' | 'ctrl-space' | null {
  const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
  if (!ctrlOnly) return null
  if (event.key === 'Escape' || event.code === 'Escape' || event.key === 'Esc') return 'ctrl-esc'
  if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') return 'ctrl-space'
  return null
}

export function useSpotlight(options: { ipcReady: boolean; hasLibraries: boolean }) {
  const spotlightTimer = useRef<number | null>(null)
  const lastOpenAt = useRef(0)
  const openRef = useRef(false)
  const [spotlightOpen, setSpotlightOpenState] = useState(false)
  const [spotlightQuery, setSpotlightQuery] = useState('')
  const [spotlightHits, setSpotlightHits] = useState<SearchHit[]>([])
  const [spotlightBusy, setSpotlightBusy] = useState(false)
  const [spotlightActiveIndex, setSpotlightActiveIndex] = useState(0)

  const setSpotlightOpen = useCallback((open: boolean, source = 'unknown') => {
    const now = Date.now()
    if (open) {
      if (now - lastOpenAt.current < 250 && openRef.current) {
        console.info('[Nestify] spotlight.open ignored duplicate', { source })
        void callNestify((api) => api.logEvent?.('spotlight.open ignored duplicate', { source }) ?? Promise.resolve()).catch(() => undefined)
        return
      }
      lastOpenAt.current = now
    } else if (now - lastOpenAt.current < OPEN_GUARD_MS) {
      console.info('[Nestify] spotlight.close ignored shortly after open', { source })
      void callNestify((api) => api.logEvent?.('spotlight.close ignored shortly after open', { source }) ?? Promise.resolve()).catch(() => undefined)
      return
    }
    console.info('[Nestify] spotlight.openChange', { source, open })
    void callNestify((api) => api.logEvent?.('spotlight.openChange', { source, open }) ?? Promise.resolve()).catch(() => undefined)
    openRef.current = open
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
      const hotkey = isSpotlightHotkey(event)
      if (!hotkey) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      console.info('[Nestify] spotlight keydown', { key: event.key, code: event.code, hotkey })
      void callNestify((api) =>
        api.logEvent?.('spotlight.renderer-keydown', { key: event.key, code: event.code, hotkey }) ?? Promise.resolve(),
      ).catch(() => undefined)
      setSpotlightOpen(true, hotkey === 'ctrl-esc' ? 'renderer-ctrl-esc' : 'renderer-ctrl-space')
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
`)

console.log('updated table + spotlight hook')