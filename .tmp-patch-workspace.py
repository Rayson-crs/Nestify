from pathlib import Path

p = Path('apps/desktop/src/lib/workspace.ts')
text = p.read_text(encoding='utf-8')
old = '''export type LibraryDraft = {
  name: string
  roots: string
  excludeGlobs: string
  maxDepth: string
  followSymlinks: boolean
  scanHidden: boolean
  hashStrategy: LibraryHashStrategy
  mediaStrategy: LibraryMediaStrategy
  previewStrategy: LibraryPreviewStrategy
}

export const HASH_STRATEGY_OPTIONS'''
new = '''export type LibraryDraft = {
  name: string
  roots: string
  excludeGlobs: string
  maxDepth: string
  followSymlinks: boolean
  scanHidden: boolean
  hashStrategy: LibraryHashStrategy
  mediaStrategy: LibraryMediaStrategy
  previewStrategy: LibraryPreviewStrategy
}

export const DEFAULT_LIBRARY_DRAFT: LibraryDraft = {
  name: '',
  roots: '',
  excludeGlobs: '',
  maxDepth: '',
  followSymlinks: false,
  scanHidden: false,
  hashStrategy: 'duplicate-candidate-only',
  mediaStrategy: 'off',
  previewStrategy: 'standard',
}

export function nextTriStateSort(direction: TriStateSortDirection): TriStateSortDirection {
  return direction === 'asc' ? 'desc' : direction === 'desc' ? null : 'asc'
}

export const HASH_STRATEGY_OPTIONS'''
if old not in text:
    raise SystemExit('workspace.ts marker missing')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('workspace.ts updated')
