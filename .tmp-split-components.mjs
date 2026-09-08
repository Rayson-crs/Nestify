import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = process.cwd()
const appPath = resolve(root, 'apps/desktop/src/App.tsx')
const source = readFileSync(appPath, 'utf8')

function block(start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  if (startIndex < 0 || endIndex < 0) throw new Error(`Unable to find ${start} .. ${end}`)
  return source.slice(startIndex, endIndex).trimEnd()
}

function write(relativePath, contents) {
  const target = resolve(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents, 'utf8')
}

write('apps/desktop/src/lib/paths.ts', `${[
  "import { parentName as parentNameImpl } from './path-names'",
].join('\n')}
`)

write('apps/desktop/src/components/files/SpotlightSearch.tsx', `${[
  "import { Loader2, Search } from 'lucide-react'",
  "import { Badge } from '@/components/ui/badge'",
  "import { Button } from '@/components/ui/button'",
  "import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'",
  "import { Input } from '@/components/ui/input'",
  "import { ScrollArea } from '@/components/ui/scroll-area'",
  "import { KindIcon, kindLabel } from '@/components/files/kind'",
  "import type { SearchHit } from '@/lib/ipc'",
].join('\n')}

${block('function SpotlightSearch({', 'function FileViewTabs({')}
`)

write('apps/desktop/src/components/files/FileViewTabs.tsx', `${[
  "import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'",
].join('\n')}

${block('function FileViewTabs({', 'function pathCrumbs(path: string)')}
`)

write('apps/desktop/src/lib/path-crumbs.ts', `${block('function pathCrumbs(path: string)', 'function startColumnResize(')}
`)

write('apps/desktop/src/components/files/ResizableTable.tsx', `${[
  "import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'",
  "import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'",
  "import { Button } from '@/components/ui/button'",
  "import { TableHead } from '@/components/ui/table'",
  "import { cn } from '@/lib/utils'",
  "import type { SearchSortField } from '@/lib/ipc'",
  "import type { TriStateSortDirection } from './types'",
].join('\n')}

${block('function startColumnResize(', 'function FileTreePane({')}

${block('function SearchSortHeader({', 'function JobsPane({')}
`)

write('apps/desktop/src/components/files/FileTreePane.tsx', `${[
  "import { useState } from 'react'",
  "import type { PointerEvent as ReactPointerEvent } from 'react'",
  "import { ChevronRight, Copy, ExternalLink } from 'lucide-react'",
  "import { Badge } from '@/components/ui/badge'",
  "import { Button } from '@/components/ui/button'",
  "import { ScrollArea } from '@/components/ui/scroll-area'",
  "import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'",
  "import { KindIcon } from './kind'",
  "import { PlainResizableHead, ResizableTableHead, SearchSortHeader, startColumnResize } from './ResizableTable'",
  "import type { SearchHit, SearchSortField } from '@/lib/ipc'",
  "import { libraryPathCrumbs } from '@/lib/path-crumbs'",
  "import type { TriStateSortDirection } from './types'",
  "import { formatBytes, formatTime } from '@/lib/utils'",
].join('\n')}

${block('function FileTreePane({', 'function SearchPane({')}
`)

write('apps/desktop/src/components/files/SearchPane.tsx', `${[
  "import { useState } from 'react'",
  "import type { PointerEvent as ReactPointerEvent } from 'react'",
  "import { ChevronLeft, ChevronRight, Copy, ExternalLink, FileSearch, Folder, FolderOpen, Layers, Pencil } from 'lucide-react'",
  "import { Badge } from '@/components/ui/badge'",
  "import { Button } from '@/components/ui/button'",
  "import { Checkbox } from '@/components/ui/checkbox'",
  "import { Input } from '@/components/ui/input'",
  "import { ScrollArea } from '@/components/ui/scroll-area'",
  "import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'",
  "import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'",
  "import { KindIcon, SEARCH_KIND_OPTIONS, type SearchKindFilter } from './kind'",
  "import { PlainResizableHead, SearchSortHeader, startColumnResize } from './ResizableTable'",
  "import type { SearchHit, SearchScope, SearchSortField } from '@/lib/ipc'",
  "import { SEARCH_SCOPE_LABEL } from '@/lib/labels'",
  "import type { TriStateSortDirection } from './types'",
  "import type { WorkspaceTab } from '@/lib/workspace'",
  "import { formatBytes, formatTime } from '@/lib/utils'",
].join('\n')}

${block('function SearchPane({', 'function LibraryEditor({')}
`)

write('apps/desktop/src/components/LibraryEditor.tsx', `${[
  "import { Loader2, Save } from 'lucide-react'",
  "import { Button } from '@/components/ui/button'",
  "import { Checkbox } from '@/components/ui/checkbox'",
  "import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'",
  "import { Input } from '@/components/ui/input'",
  "import { Label } from '@/components/ui/label'",
  "import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'",
  "import { Textarea } from '@/components/ui/textarea'",
  "import type { LibraryHashStrategy, LibraryMediaStrategy, LibraryPreviewStrategy } from '@/lib/ipc'",
].join('\n')}

${block('function LibraryEditor({', 'function SearchSortHeader({')}
`)

const nextSource = source.slice(0, source.indexOf('function SpotlightSearch({')) +
  source.slice(source.indexOf('function JobsPane({'))
writeFileSync(appPath, nextSource, 'utf8')
