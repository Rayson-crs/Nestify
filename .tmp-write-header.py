from pathlib import Path
Path('apps/desktop/src/components/app/AppHeader.tsx').write_text(r'''import { HardDrive, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import type { FileViewMode } from '@/lib/workspace'

export function AppHeader({
  query,
  hasLibraries,
  searchBusy,
  onQuery,
  onSearch,
}: {
  query: string
  hasLibraries: boolean
  searchBusy: boolean
  onQuery: (value: string) => void
  onSearch: () => void
}) {
  return (
    <header className="flex h-12 items-center gap-3 border-b px-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <HardDrive className="h-4 w-4 text-primary" />
        Nestify
      </div>
      <Separator orientation="vertical" className="h-5" />
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="搜索文件名 / ext:mp4 / parent:下载 / kind:video"
          className="pl-8"
          disabled={!hasLibraries}
        />
      </div>
      <Button variant="outline" size="sm" onClick={onSearch} disabled={!hasLibraries || searchBusy}>
        {searchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        立即搜索
      </Button>
    </header>
  )
}

export function searchQueryToResults(setFileViewMode: (mode: FileViewMode) => void, setQuery: (value: string) => void) {
  return (value: string) => {
    setQuery(value)
    setFileViewMode('results')
  }
}
''', encoding='utf-8')
print('AppHeader written')
