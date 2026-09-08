import { useCallback, useEffect, useRef, useState } from 'react'
import { callNestify, type FilePreview, type LibrarySummary, type SearchHit, type SearchScope, type SearchSortField } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import { isWithinDirectory } from '@/lib/path-crumbs'
import { nextTriStateSort, type FileViewMode, type SearchKindFilter, type TriStateSortDirection } from '@/lib/workspace'

export function useSearchWorkspace(options: {
  selectedLibraryId: string | null
  selectedLibrary: LibrarySummary | null
  allLibrariesSelected: boolean
  setError: (value: string | null) => void
}) {
  const { selectedLibraryId, selectedLibrary, allLibrariesSelected, setError } = options
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
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null)
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>('tree')
  const [treePath, setTreePath] = useState<string | null>(null)
  const [treeHits, setTreeHits] = useState<SearchHit[]>([])
  const [treeTotal, setTreeTotal] = useState(0)
  const [treeBusy, setTreeBusy] = useState(false)
  const [treeSort, setTreeSort] = useState<SearchSortField>('path_mtime')
  const [treeSortDirection, setTreeSortDirection] = useState<TriStateSortDirection>(null)
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const searchTimer = useRef<number | null>(null)
  const pendingTreePath = useRef<string | null>(null)

  const runSearch = useCallback(
    async (text: string, libraryId = selectedLibraryId, offset = 0) => {
      if (!libraryId) {
        setHits([])
        setHitTotal(0)
        setSearchElapsed(null)
        return
      }
      if (
        (searchScope === 'directory' && !searchDirectory.trim()) ||
        (searchScope === 'selection' && selectedEntryIds.length === 0)
      ) {
        setHits([])
        setHitTotal(0)
        setSearchElapsed(null)
        setSelectedHit(null)
        return
      }

      setSearchBusy(true)
      try {
        const { result } = await callNestify((api) =>
          api.searchQuery({
            libraryId,
            text,
            limit: 200,
            offset,
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
        setHits(result.hits)
        setHitTotal(result.total)
        setSearchElapsed(result.elapsedMs)
        setSearchOffset(offset)
        setSelectedHit((current) => {
          if (!current) return result.hits[0] ?? null
          return result.hits.find((hit) => hit.entryId === current.entryId) ?? result.hits[0] ?? null
        })
        setError(null)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setSearchBusy(false)
      }
    },
    [searchDirectory, searchKind, searchScope, searchSort, searchSortDirection, selectedEntryIds, selectedLibraryId, setError],
  )

  const loadTree = useCallback(
    async (path: string, libraryId = selectedLibraryId) => {
      if (!libraryId || !path.trim()) {
        setTreeHits([])
        setTreeTotal(0)
        return
      }
      setTreeBusy(true)
      try {
        const { result } = await callNestify((api) =>
          api.searchQuery({
            libraryId,
            text: '',
            limit: 1000,
            scope: 'directory',
            directory: path,
            directChildren: true,
            sort: {
              field: treeSort,
              ...(treeSortDirection ? { direction: treeSortDirection } : {}),
            },
          }),
        )
        setTreeHits(result.hits)
        setTreeTotal(result.total)
        setError(null)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setTreeBusy(false)
      }
    },
    [selectedLibraryId, setError, treeSort, treeSortDirection],
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
  }, [allLibrariesSelected, selectedLibrary?.id, selectedLibrary?.roots.join('\n'), selectedLibraryId])

  useEffect(() => {
    if (!selectedLibraryId || !treePath) return
    void loadTree(treePath, selectedLibraryId)
  }, [loadTree, selectedLibraryId, treePath])

  useEffect(() => {
    if (!selectedLibraryId) return
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      void runSearch(query, selectedLibraryId)
    }, 300)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [query, runSearch, selectedLibraryId])

  useEffect(() => {
    if (!selectedHit) {
      setPreview(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const next = await callNestify((api) =>
          api.previewFile ? api.previewFile({ path: selectedHit.path }) : Promise.resolve({ kind: 'none' as const }),
        )
        if (!cancelled) setPreview(next)
      } catch {
        if (!cancelled) setPreview({ kind: 'none' })
      }
    })()
    return () => {
      cancelled = true
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
    setTreePath(hit.kind === 'dir' ? hit.path : hit.parent ?? selectedLibrary?.roots[0] ?? null)
    setFileViewMode('tree')
  }

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
    selectedHit,
    setSelectedHit,
    fileViewMode,
    setFileViewMode,
    treePath,
    setTreePath,
    treeHits,
    treeTotal,
    treeBusy,
    treeSort,
    treeSortDirection,
    selectedEntryIds,
    setSelectedEntryIds,
    preview,
    inspectorOpen,
    setInspectorOpen,
    pendingTreePath,
    runSearch,
    changeSearchSort,
    changeTreeSort,
    revealInTree,
  }
}
