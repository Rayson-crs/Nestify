import { useCallback, useRef, useState } from 'react'
import type { LibrarySummary, SearchHit } from '@/lib/ipc'
import { matchingRootPath } from '@/lib/path-crumbs'
import { isWithinDirectory } from '@/lib/path-crumbs'
import { DIRECTORY_CHILDREN_PAGE_SIZE, fetchDirectoryChildrenPage } from '@/lib/directory-children'

export type DirectoryPreviewSortField = 'name' | 'size' | 'mtime'
export type DirectoryPreviewSort = { field: DirectoryPreviewSortField; direction: 'asc' | 'desc' }

export function useDirectoryPreview({
  libraries,
  matchMode,
}: {
  libraries: LibrarySummary[]
  matchMode: 'exact-root' | 'inside-root'
}) {
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sortField, setSortField] = useState<DirectoryPreviewSortField>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null)
  const requestIdRef = useRef(0)

  const findLibrary = useCallback(
    (directory: string) =>
      libraries.find((library) =>
        matchMode === 'exact-root'
          ? Boolean(matchingRootPath(directory, library.roots))
          : library.roots.some((root) => isWithinDirectory(directory, root)),
      ) ?? null,
    [libraries, matchMode],
  )

  const load = useCallback(
    async (directory: string, sort?: DirectoryPreviewSort, parentId?: string | null, nextOffset = 0) => {
      const requestId = ++requestIdRef.current
      const library = findLibrary(directory)
      if (!library) {
        if (requestId !== requestIdRef.current) return
        clear()
        return
      }
      setBusy(true)
      try {
        const page = await fetchDirectoryChildrenPage({
          libraryId: library.id,
          directory,
          parentId: parentId ?? undefined,
          sort,
          offset: nextOffset,
        })
        if (requestId !== requestIdRef.current) return
        setHits(page.hits)
        setTotal(page.total)
        setHasMore(page.hasMore)
        setOffset(nextOffset)
      } catch {
        if (requestId !== requestIdRef.current) return
        clear()
      } finally {
        if (requestId === requestIdRef.current) setBusy(false)
      }
    },
    [findLibrary],
  )

  const clear = useCallback(() => {
    setHits(null)
    setTotal(0)
    setHasMore(false)
    setOffset(0)
  }, [])

  const invalidate = useCallback(() => {
    requestIdRef.current += 1
    setBusy(false)
    clear()
  }, [clear])

  const sort = useCallback(
    (field: DirectoryPreviewSortField, directory: string, parentId?: string | null) => {
      const nextDirection: 'asc' | 'desc' | null = sortField === field
        ? sortDirection === 'asc' ? 'desc' : sortDirection === 'desc' ? null : 'asc'
        : 'asc'
      setSortField(field)
      setSortDirection(nextDirection)
      if (directory.trim()) {
        void load(directory, nextDirection ? { field, direction: nextDirection } : undefined, parentId)
      }
    },
    [load, sortDirection, sortField],
  )

  const page = useCallback(
    (delta: -1 | 1, directory: string, parentId?: string | null) => {
      const nextOffset = Math.max(0, offset + delta * DIRECTORY_CHILDREN_PAGE_SIZE)
      if (nextOffset === offset || (delta > 0 && !hasMore)) return
      void load(
        directory,
        sortDirection ? { field: sortField, direction: sortDirection } : undefined,
        parentId,
        nextOffset,
      )
    },
    [hasMore, load, offset, sortDirection, sortField],
  )

  return {
    hits,
    total,
    offset,
    hasMore,
    busy,
    sortField,
    sortDirection,
    load,
    clear,
    invalidate,
    sort,
    page,
  }
}
