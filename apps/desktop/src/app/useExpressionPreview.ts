import { useCallback, useEffect, useRef, useState } from 'react'
import { callNestify, type LibrarySummary, type SearchHit } from '@/lib/ipc'
import { matchingRootPath } from '@/lib/path-crumbs'
import { DIRECTORY_CHILDREN_PAGE_SIZE } from '@/lib/directory-children'

export function useExpressionPreview({
  libraries,
  directory,
  debounceMs = 300,
}: {
  libraries: LibrarySummary[]
  directory: string
  debounceMs?: number
}) {
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestIdRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const clear = useCallback(() => {
    setHits(null)
    setTotal(0)
    setOffset(0)
    setHasMore(false)
    setBusy(false)
  }, [])

  const invalidate = useCallback(() => {
    requestIdRef.current += 1
    clear()
  }, [clear])

  const run = useCallback(
    async (expression: string, nextOffset = 0) => {
      const requestId = ++requestIdRef.current
      const trimmedDirectory = directory.trim()
      const library = libraries.find((item) => matchingRootPath(trimmedDirectory, item.roots))
      if (!expression.trim() || !trimmedDirectory || !library) {
        if (requestId !== requestIdRef.current) return
        clear()
        return
      }
      setBusy(true)
      try {
        const next = await callNestify((api) =>
          api.searchQuery({
            libraryId: library.id,
            text: expression.trim(),
            scope: 'directory',
            directory: trimmedDirectory,
            limit: DIRECTORY_CHILDREN_PAGE_SIZE,
            offset: nextOffset,
          }),
        )
        if (requestId !== requestIdRef.current) return
        setHits(next.result.hits)
        setTotal(next.result.total)
        setHasMore(next.result.hasMore)
        setOffset(nextOffset)
      } catch {
        if (requestId !== requestIdRef.current) return
        clear()
      } finally {
        if (requestId === requestIdRef.current) setBusy(false)
      }
    },
    [clear, directory, libraries],
  )

  const schedule = useCallback(
    (expression: string) => {
      invalidate()
      setBusy(Boolean(expression.trim()))
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => void run(expression), debounceMs)
    },
    [debounceMs, invalidate, run],
  )

  const page = useCallback(
    (expression: string, delta: -1 | 1) => {
      const nextOffset = Math.max(0, offset + delta * DIRECTORY_CHILDREN_PAGE_SIZE)
      if (nextOffset === offset || (delta > 0 && !hasMore)) return
      void run(expression, nextOffset)
    },
    [hasMore, offset, run],
  )

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  return { hits, total, offset, hasMore, busy, run, schedule, invalidate, page }
}
