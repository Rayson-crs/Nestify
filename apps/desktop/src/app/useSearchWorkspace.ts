import { useCallback, useEffect, useRef, useState } from 'react'
import { callNestify, getNestifyApi, type FilePreview, type LibrarySummary, type SearchHit, type SearchScope, type SearchSortField, type ThumbnailPreviewResult } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import { isWithinDirectory } from '@/lib/path-crumbs'
import { nextTriStateSort, type FileViewMode, type SearchKindFilter, type TriStateSortDirection } from '@/lib/workspace'

const DIRECTORY_PAGE_SIZE = 100

export function useSearchWorkspace(options: {
  selectedLibraryId: string | null
  selectedLibrary: LibrarySummary | null
  allLibrariesSelected: boolean
    onSelectLibrary?: (libraryId: string) => void
  setError: (value: string | null) => void
}) {
  const { selectedLibraryId, selectedLibrary, allLibrariesSelected, onSelectLibrary, setError } = options
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [hitTotal, setHitTotal] = useState(0)
  const [searchElapsed, setSearchElapsed] = useState<number | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchKind, setSearchKind] = useState<SearchKindFilter>('all')
  const [searchSort, setSearchSort] = useState<SearchSortField>('path_mtime')
  const [searchSortDirection, setSearchSortDirection] = useState<TriStateSortDirection>(null)
  const [searchScope, setSearchScope] = useState<SearchScope>('library')
  const [searchDirectory, setSearchDirectory] = useState('')
  const [searchOffset, setSearchOffset] = useState(0)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null)
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>('tree')
  const [treePath, setTreePath] = useState<string | null>(null)
  const [treeDirectoryId, setTreeDirectoryId] = useState<string | null>(null)
  const [treeHits, setTreeHits] = useState<SearchHit[]>([])
  const [treeTotal, setTreeTotal] = useState(0)
  const [treeOffset, setTreeOffset] = useState(0)
  const [treeHasMore, setTreeHasMore] = useState(false)
  const [treeBusy, setTreeBusy] = useState(false)
  const [treeSort, setTreeSort] = useState<SearchSortField>('path_mtime')
  const [treeSortDirection, setTreeSortDirection] = useState<TriStateSortDirection>(null)
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [thumbnail, setThumbnail] = useState<ThumbnailPreviewResult | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const searchTimer = useRef<number | null>(null)
  const [searchDebounceMs, setSearchDebounceMs] = useState(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem('nestify.settings') ?? '{}') as { searchDebounceMs?: number }
      return Number.isFinite(raw.searchDebounceMs) ? Math.max(0, raw.searchDebounceMs ?? 300) : 300
    } catch {
      return 300
    }
  })
  const pendingTreePath = useRef<string | null>(null)
  const searchRequestId = useRef(0)
  const searchClientId = useRef('')
  const treeRequestId = useRef(0)
  const searchCursors = useRef(new Map<number, string>())

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const value = (event as CustomEvent<{ searchDebounceMs?: number }>).detail?.searchDebounceMs
      if (Number.isFinite(value)) setSearchDebounceMs(Math.max(0, value ?? 300))
    }
    window.addEventListener('nestify:settings-updated', onSettingsUpdated)
    return () => window.removeEventListener('nestify:settings-updated', onSettingsUpdated)
  }, [])

  const cancelSearch = () => {
    searchRequestId.current += 1
    void getNestifyApi()?.searchCancel?.({
      searchClientId: ensureSearchClientId(searchClientId),
      requestSeq: searchRequestId.current,
    }).catch(() => undefined)
  }

  const runSearch = useCallback(
    async (text: string, libraryId = selectedLibraryId, offset = 0) => {
      const requestId = ++searchRequestId.current
      if (!libraryId) {
        void getNestifyApi()?.logEvent?.('renderer.search.skipped', { reason: 'missing-library', text })
        setHits([])
        setHitTotal(0)
        setSearchElapsed(null)
        setSearchHasMore(false)
        searchCursors.current.clear()
        return
      }
      if (searchScope === 'library' && text.trim() === '') {
        void getNestifyApi()?.logEvent?.('renderer.search.skipped', { reason: 'empty-library-query', libraryId })
        setHits([])
        setHitTotal(0)
        setSearchElapsed(null)
        setSearchOffset(0)
        setSearchHasMore(false)
        searchCursors.current.clear()
        setSelectedHit(null)
        setSearchBusy(false)
        return
      }
      if (
        (searchScope === 'directory' && !searchDirectory.trim()) ||
        (searchScope === 'selection' && selectedEntryIds.length === 0)
      ) {
        void getNestifyApi()?.logEvent?.('renderer.search.skipped', {
          reason: 'missing-scope-input',
          text,
          scope: searchScope,
          directory: searchDirectory,
          selectedEntryCount: selectedEntryIds.length,
        })
        setHits([])
        setHitTotal(0)
        setSearchElapsed(null)
        setSearchHasMore(false)
        setSelectedHit(null)
        return
      }

      setSearchBusy(true)
      try {
        void getNestifyApi()?.logEvent?.('renderer.search.request', {
          libraryId,
          text,
          scope: searchScope,
          sort: searchSort,
          sortDirection: searchSortDirection,
        })
        const { result } = await callNestify((api) =>
          api.searchQuery({
            libraryId,
            text,
            searchClientId: ensureSearchClientId(searchClientId),
            requestSeq: requestId,
            limit: 100,
            offset,
            cursor: searchCursors.current.get(offset),
            resultMode: 'hits-only',
            kinds: searchKind !== 'all' ? [searchKind] : undefined,
            scope: searchScope,
            directory: searchScope === 'directory' ? searchDirectory.trim() : undefined,
            entryIds: searchScope === 'selection' ? selectedEntryIds : undefined,
            sort: {
              field: searchSort,
              ...(searchSortDirection ? { direction: searchSortDirection } : {}),
            },
          }),
        )
        if (requestId !== searchRequestId.current) return
        setHits(result.hits)
        setHitTotal(result.total)
        setSearchElapsed(result.elapsedMs)
        setSearchOffset(offset)
        setSearchHasMore(result.hasMore)
        if (offset === 0) searchCursors.current.clear()
        if (result.nextCursor) searchCursors.current.set(offset + 100, result.nextCursor)
        setSelectedHit((current) => {
          if (!current) return result.hits[0] ?? null
          return result.hits.find((hit) => hit.entryId === current.entryId) ?? result.hits[0] ?? null
        })
        void getNestifyApi()?.logEvent?.('renderer.search.result', {
          libraryId,
          text,
          total: result.total,
          hits: result.hits.length,
          elapsedMs: result.elapsedMs,
        })
        setError(null)
      } catch (err) {
        if (requestId !== searchRequestId.current || /query cancelled|query worker exited|sidecar connection failed/i.test(errorMessage(err))) return
        void getNestifyApi()?.logEvent?.('renderer.search.failed', {
          libraryId,
          text,
          message: errorMessage(err),
        })
        setError(errorMessage(err))
      } finally {
        if (requestId === searchRequestId.current) setSearchBusy(false)
      }
    },
    [searchDirectory, searchKind, searchScope, searchSort, searchSortDirection, selectedEntryIds, selectedLibraryId, setError],
  )

  const loadTree = useCallback(
    async (path: string, libraryId = selectedLibraryId, parentId = treeDirectoryId, offset = 0) => {
      const requestId = ++treeRequestId.current
      if (!libraryId || !path.trim()) {
        setTreeHits([])
        setTreeTotal(0)
        setTreeOffset(0)
        setTreeHasMore(false)
        return
      }
      setTreeBusy(true)
      try {
        const { result } = await callNestify((api) =>
          api.directoryChildren({
            libraryId,
            directory: path,
            parentId: parentId ?? undefined,
            limit: DIRECTORY_PAGE_SIZE,
            offset,
            sort: {
              field: treeSort,
              ...(treeSortDirection ? { direction: treeSortDirection } : {}),
            },
          }),
        )
        if (requestId !== treeRequestId.current) return
        setTreeHits(result.hits)
        setTreeTotal(result.total)
        setTreeOffset(offset)
        setTreeHasMore(result.hasMore)
        setError(null)
      } catch (err) {
        if (requestId !== treeRequestId.current || errorMessage(err) === 'query cancelled') return
        setError(errorMessage(err))
      } finally {
        if (requestId === treeRequestId.current) setTreeBusy(false)
      }
    },
    [selectedLibraryId, setError, treeDirectoryId, treeSort, treeSortDirection],
  )

  useEffect(() => {
    setSelectedEntryIds([])
    setSelectedHit(null)
    const requestedPath = pendingTreePath.current
    pendingTreePath.current = null
    const roots = selectedLibrary?.roots ?? []
    const requestedRoot = requestedPath
      ? roots.find((root) => isWithinDirectory(requestedPath, root))
      : undefined
    setTreePath(allLibrariesSelected ? null : requestedRoot ? requestedPath : roots[0] ?? null)
    setTreeDirectoryId(null)
    setTreeOffset(0)
    setTreeHasMore(false)
  }, [allLibrariesSelected, selectedLibrary?.id, selectedLibrary?.roots.join('\n'), selectedLibraryId])

  useEffect(() => {
    if (!selectedLibraryId || !treePath) return
    void loadTree(treePath, selectedLibraryId, treeDirectoryId, 0)
  }, [loadTree, selectedLibraryId, treePath, treeDirectoryId])

  useEffect(() => {
    if (!selectedLibraryId) return
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      void runSearch(query, selectedLibraryId)
    }, searchDebounceMs)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [query, runSearch, searchDebounceMs, selectedLibraryId])

  useEffect(() => cancelSearch, [])

  useEffect(() => {
    if (!selectedHit) {
      setPreview(null)
      setThumbnail(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      try {
        const [next, nextThumbnail] = await callNestify(async (api) => Promise.all([
          api.previewFile ? api.previewFile({ path: selectedHit.path }) : Promise.resolve({ kind: 'none' as const }),
          selectedHit.kind === 'video' && api.previewThumbnail
            ? api.previewThumbnail({
              libraryId: selectedHit.libraryId,
              entryId: selectedHit.entryId,
              kind: 'video',
              priority: 'selected',
            }, { signal: controller.signal }).catch(() => null)
            : Promise.resolve(null),
        ]))
        if (!cancelled) {
          setPreview(next)
          setThumbnail(nextThumbnail)
        }
      } catch {
        if (!cancelled) {
          setPreview({ kind: 'none' })
          setThumbnail(null)
        }
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedHit])

  const changeSearchSort = (field: SearchSortField) => {
    if (searchSort === field) {
      setSearchSortDirection((direction) => nextTriStateSort(direction))
      return
    }
    setSearchSort(field)
    setSearchSortDirection(null)
  }

  const changeTreeSort = (field: SearchSortField) => {
    if (treeSort === field) {
      setTreeSortDirection((direction) => nextTriStateSort(direction))
      return
    }
    setTreeSort(field)
    setTreeSortDirection(null)
  }

  const revealInTree = (hit: SearchHit, onSelectLibrary?: (libraryId: string) => void) => {
    if (allLibrariesSelected) {
      pendingTreePath.current = hit.kind === 'dir' ? hit.path : hit.parent
      onSelectLibrary?.(hit.libraryId)
    }
    const nextPath = hit.kind === 'dir' ? hit.path : hit.parent ?? selectedLibrary?.roots[0] ?? null
    setTreePath(nextPath)
    setTreeDirectoryId(hit.kind === 'dir' ? hit.entryId : null)
    setFileViewMode('tree')
  }

  const enterTreeDirectory = (path: string, entryId?: string, libraryId?: string) => {
    if (allLibrariesSelected && libraryId) {
      pendingTreePath.current = path
      onSelectLibrary?.(libraryId)
    }
    setTreePath(path)
    setTreeDirectoryId(entryId && !entryId.startsWith('library-root:') ? entryId : null)
    setTreeOffset(0)
    setTreeHasMore(false)
  }

  const refreshTree = useCallback(async () => {
    if (!selectedLibraryId || !treePath) return
    const roots = selectedLibrary?.roots ?? []
    const atLibraryRoot = roots.some((root) => isWithinDirectory(treePath, root) && isWithinDirectory(root, treePath))
    await loadTree(treePath, selectedLibraryId, atLibraryRoot ? null : treeDirectoryId, treeOffset)
  }, [loadTree, selectedLibrary, selectedLibraryId, treeDirectoryId, treeOffset, treePath])

  const changeTreePage = useCallback(
    (delta: number) => {
      const next = Math.max(0, treeOffset + delta * DIRECTORY_PAGE_SIZE)
      if (next === treeOffset || (delta > 0 && !treeHasMore)) return
      void loadTree(treePath ?? '', selectedLibraryId, treeDirectoryId, next)
    },
    [loadTree, selectedLibraryId, treeDirectoryId, treeHasMore, treeOffset, treePath],
  )

  return {
    query,
    setQuery,
    hits,
    hitTotal,
    searchElapsed,
    searchBusy,
    searchKind,
    setSearchKind,
    searchSort,
    searchSortDirection,
    setSearchSortDirection,
    searchScope,
    setSearchScope,
    searchDirectory,
    setSearchDirectory,
    searchOffset,
    searchHasMore,
    selectedHit,
    setSelectedHit,
    fileViewMode,
    setFileViewMode,
    treePath,
    setTreePath,
    enterTreeDirectory,
    treeHits,
    treeTotal,
    treeOffset,
    treeHasMore,
    treeBusy,
    treeSort,
    treeSortDirection,
    selectedEntryIds,
    setSelectedEntryIds,
    preview,
    thumbnail,
    inspectorOpen,
    setInspectorOpen,
    pendingTreePath,
    runSearch,
    changeSearchSort,
    changeTreeSort,
    revealInTree,
    refreshTree,
    changeTreePage,
  }
}

function ensureSearchClientId(ref: { current: string }): string {
  ref.current ||= globalThis.crypto?.randomUUID?.() ?? `search-${Math.random().toString(36).slice(2)}`
  return ref.current
}
