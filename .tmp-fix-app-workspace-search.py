from pathlib import Path
p = Path('apps/desktop/src/app/useAppWorkspace.ts')
text = p.read_text(encoding='utf-8')
old = '''  const search = useSearchWorkspace({
    ipcReady: libraries.ipcReady,
    selectedLibraryId: libraries.selectedLibraryId,
    selectedLibraryRoots: libraries.selectedLibrary?.roots ?? [],
    allLibrariesSelected: libraries.allLibrariesSelected,
    setError,
  })
'''
new = '''  const search = useSearchWorkspace({
    selectedLibraryId: libraries.selectedLibraryId,
    selectedLibrary: libraries.selectedLibrary,
    allLibrariesSelected: libraries.allLibrariesSelected,
    setError,
  })
'''
if old not in text:
    raise SystemExit('search hook call missing')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('useAppWorkspace search args patched')
