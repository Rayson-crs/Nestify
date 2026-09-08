from pathlib import Path

# AppHeader: drop unused helper
header = Path('apps/desktop/src/components/app/AppHeader.tsx')
text = header.read_text(encoding='utf-8')
text = text.replace("import type { FileViewMode } from '@/lib/workspace'\n\n", '')
text = text.replace('''}

export function searchQueryToResults(setFileViewMode: (mode: FileViewMode) => void, setQuery: (value: string) => void) {
  return (value: string) => {
    setQuery(value)
    setFileViewMode('results')
  }
}
''', '}\n')
header.write_text(text, encoding='utf-8')

# types: add setSearchSortDirection
types = Path('apps/desktop/src/app/types.ts')
text = types.read_text(encoding='utf-8')
old = '''  searchSort: SearchSortField
  searchSortDirection: TriStateSortDirection
'''
new = '''  searchSort: SearchSortField
  searchSortDirection: TriStateSortDirection
  setSearchSortDirection: Dispatch<SetStateAction<TriStateSortDirection>>
'''
if old not in text:
    raise SystemExit('types sort fields missing')
types.write_text(text.replace(old, new, 1), encoding='utf-8')

# search hook: stabilize library roots and export setSearchSortDirection
search = Path('apps/desktop/src/app/useSearchWorkspace.ts')
text = search.read_text(encoding='utf-8')
old = '''    const requestedPath = pendingTreePath.current
    pendingTreePath.current = null
    const roots = selectedLibrary?.roots ?? []
    const requestedRoot = requestedPath
      ? roots.find((root) => isWithinDirectory(requestedPath, root))
      : undefined
    setTreePath(allLibrariesSelected ? null : requestedRoot ? requestedPath : roots[0] ?? null)
  }, [allLibrariesSelected, selectedLibrary, selectedLibraryId])
'''
new = '''    const requestedPath = pendingTreePath.current
    pendingTreePath.current = null
    const roots = selectedLibrary?.roots ?? []
    const requestedRoot = requestedPath
      ? roots.find((root) => isWithinDirectory(requestedPath, root))
      : undefined
    setTreePath(allLibrariesSelected ? null : requestedRoot ? requestedPath : roots[0] ?? null)
  }, [allLibrariesSelected, selectedLibrary?.id, selectedLibrary?.roots.join('\\n'), selectedLibraryId])
'''
if old not in text:
    raise SystemExit('search library effect missing')
text = text.replace(old, new, 1)
old = '''    searchSort,
    searchSortDirection,
    searchScope,
'''
new = '''    searchSort,
    searchSortDirection,
    setSearchSortDirection,
    searchScope,
'''
if old not in text:
    raise SystemExit('search return missing')
text = text.replace(old, new, 1)
search.write_text(text, encoding='utf-8')

# app workspace: pass setSearchSortDirection
app = Path('apps/desktop/src/app/useAppWorkspace.ts')
text = app.read_text(encoding='utf-8')
old = '''    searchSort: search.searchSort,
    searchSortDirection: search.searchSortDirection,
'''
new = '''    searchSort: search.searchSort,
    searchSortDirection: search.searchSortDirection,
    setSearchSortDirection: search.setSearchSortDirection,
'''
if old not in text:
    raise SystemExit('app workspace sort missing')
app.write_text(text.replace(old, new, 1), encoding='utf-8')

# plans: drop unused selectedHitParent
plans = Path('apps/desktop/src/app/usePlans.ts')
text = plans.read_text(encoding='utf-8')
text = text.replace('  selectedHitParent: string | null\n', '')
text = text.replace('    selectedHitParent: search.selectedHit?.parent ?? null,\n', '')
plans.write_text(text, encoding='utf-8')
app_text = Path('apps/desktop/src/app/useAppWorkspace.ts').read_text(encoding='utf-8')
app_text = app_text.replace('    selectedHitParent: search.selectedHit?.parent ?? null,\n', '')
Path('apps/desktop/src/app/useAppWorkspace.ts').write_text(app_text, encoding='utf-8')
print('remaining type/export fixes applied')
