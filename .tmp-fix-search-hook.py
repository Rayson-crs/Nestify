from pathlib import Path
p = Path('apps/desktop/src/app/useSearchWorkspace.ts')
text = p.read_text(encoding='utf-8')
text = text.replace(
'''import { callNestify, type FilePreview, type SearchHit, type SearchScope, type SearchSortField } from '@/lib/ipc'
''',
'''import { callNestify, type FilePreview, type LibrarySummary, type SearchHit, type SearchScope, type SearchSortField } from '@/lib/ipc'
'''
)
text = text.replace(
'''export function useSearchWorkspace(options: {
  ipcReady: boolean
  selectedLibraryId: string | null
  selectedLibraryRoots: string[]
  allLibrariesSelected: boolean
  setError: (value: string | null) => void
}) {
  const { ipcReady, selectedLibraryId, selectedLibraryRoots, allLibrariesSelected, setError } = options
''',
'''export function useSearchWorkspace(options: {
  selectedLibraryId: string | null
  selectedLibrary: LibrarySummary | null
  allLibrariesSelected: boolean
  setError: (value: string | null) => void
}) {
  const { selectedLibraryId, selectedLibrary, allLibrariesSelected, setError } = options
'''
)
text = text.replace(
'''    const requestedPath = pendingTreePath.current
    pendingTreePath.current = null
    const requestedRoot = requestedPath
      ? selectedLibraryRoots.find((root) => isWithinDirectory(requestedPath, root))
      : undefined
    setTreePath(allLibrariesSelected ? null : requestedRoot ? requestedPath : selectedLibraryRoots[0] ?? null)
  }, [allLibrariesSelected, selectedLibraryId, selectedLibraryRoots])
''',
'''    const requestedPath = pendingTreePath.current
    pendingTreePath.current = null
    const roots = selectedLibrary?.roots ?? []
    const requestedRoot = requestedPath
      ? roots.find((root) => isWithinDirectory(requestedPath, root))
      : undefined
    setTreePath(allLibrariesSelected ? null : requestedRoot ? requestedPath : roots[0] ?? null)
  }, [allLibrariesSelected, selectedLibrary, selectedLibraryId])
'''
)
text = text.replace(
'''    setTreePath(hit.kind === 'dir' ? hit.path : hit.parent ?? selectedLibraryRoots[0] ?? null)
''',
'''    setTreePath(hit.kind === 'dir' ? hit.path : hit.parent ?? selectedLibrary?.roots[0] ?? null)
'''
)
text = text.replace(
'''    revealInTree,
    ipcReady,
  }
}
''',
'''    revealInTree,
  }
}
'''
)
p.write_text(text, encoding='utf-8')
print('useSearchWorkspace patched')
