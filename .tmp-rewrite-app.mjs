import fs from 'node:fs'

const source = fs.readFileSync('apps/desktop/src/App.tsx', 'utf8')
const lines = source.split(/\n/)
const appStart = lines.findIndex((line) => line.startsWith('export default function App()'))
const appEnd = lines.findIndex((line, index) => index > appStart && line === '}' && lines[index + 1] === '')
if (appStart < 0 || appEnd < 0) throw new Error(`Could not locate App function: ${appStart} ${appEnd}`)

let app = lines.slice(appStart, appEnd + 1).join('\n')

app = app.replace(
  `  const [preview, setPreview] = useState<FilePreview | null>(null)\n`,
  `  const [preview, setPreview] = useState<FilePreview | null>(null)\n  const [inspectorOpen, setInspectorOpen] = useState(true)\n`,
)

app = app.replace(
  `  useEffect(() => {\n    const api = getNestifyApi()\n    if (!api?.onUiEvent) return\n    return api.onUiEvent((event) => {\n      if (event === 'window:close-requested') {\n        setSpotlightOpen(false)\n        setClosePromptOpen(true)\n        return\n      }\n      setSpotlightOpen((open) => {\n        if (!open) {\n          setClosePromptOpen(false)\n          setEditingLibraryId(null)\n        }\n        return !open\n      })\n    })\n  }, [])\n`,
  `  const toggleSpotlight = useCallback(() => {\n    setSpotlightOpen((open) => {\n      if (!open) {\n        setClosePromptOpen(false)\n        setEditingLibraryId(null)\n      }\n      return !open\n    })\n  }, [])\n\n  useEffect(() => {\n    const api = getNestifyApi()\n    if (!api?.onUiEvent) return\n    return api.onUiEvent((event) => {\n      if (event === 'window:close-requested') {\n        setSpotlightOpen(false)\n        setClosePromptOpen(true)\n        return\n      }\n      toggleSpotlight()\n    })\n  }, [toggleSpotlight])\n\n  useEffect(() => {\n    const onKeyDown = (event: KeyboardEvent) => {\n      const isCtrlEsc = event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Escape'\n      const isCtrlSpace = event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'Space'\n      if (!isCtrlEsc && !isCtrlSpace) return\n      event.preventDefault()\n      event.stopPropagation()\n      toggleSpotlight()\n    }\n    window.addEventListener('keydown', onKeyDown, true)\n    return () => window.removeEventListener('keydown', onKeyDown, true)\n  }, [toggleSpotlight])\n`,
)

app = app.replace(
  `            <Inspector\n              hit={selectedHit}\n              preview={preview}\n              busyOpen={busy === 'open'}\n              actionsBusy={busy !== null || !ipcReady}\n              onOpen={() => selectedHit && void handleOpen(selectedHit.path)}\n            />`,
  `            <Inspector\n              hit={selectedHit}\n              preview={preview}\n              open={inspectorOpen}\n              busyOpen={busy === 'open'}\n              actionsBusy={busy !== null || !ipcReady}\n              onOpenChange={setInspectorOpen}\n              onOpen={() => selectedHit && void handleOpen(selectedHit.path)}\n            />`,
)

const header = `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderPlus,
  HardDrive,
  Loader2,
  Search,
  ScanSearch,
  FolderOpen,
  Play,
  History,
  Pause,
  Square,
  Trash2,
  Settings2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileTreePane } from '@/components/files/FileTreePane'
import { FileViewTabs } from '@/components/files/FileViewTabs'
import { Inspector } from '@/components/files/Inspector'
import { SearchPane } from '@/components/files/SearchPane'
import { SpotlightSearch } from '@/components/files/SpotlightSearch'
import { JobsPane } from '@/components/JobsPane'
import { LibraryEditor } from '@/components/LibraryEditor'
import { RuleSetEditor, type RuleSetEditorValue } from '@/components/RuleSetEditor'
import { DuplicatePane, RenamePane, RulesPane } from '@/components/workspace/WorkspacePanes'
import {
  ALL_LIBRARIES_ID,
  callNestify,
  type ChangePlan,
  type Collision,
  type DuplicateGroup,
  type DuplicateScope,
  type FilePreview,
  type KeepStrategy,
  type LibrarySummary,
  type RuleSetSummary,
  type ScanProgress,
  type SearchHit,
  type SearchScope,
  type SearchSortField,
} from '@/lib/ipc'
import { getNestifyApi } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import { isWithinDirectory } from '@/lib/path-crumbs'
import type { JobOpRecord, JobRecord } from '@nestify/shared'
import {
  type FileViewMode,
  type LibraryDraft,
  type PlanSource,
  type SearchKindFilter,
  type TriStateSortDirection,
  type WorkspaceTab,
} from '@/lib/workspace'

const DEFAULT_TEMPLATE = "{parent}_{name.regex_replace('\\\\[.*?\\\\]', '').trim()}{ext}"
const EMPTY_LIBRARY_SELECT_VALUE = '__empty__'

type PlanState = {
  plan: ChangePlan
  source: PlanSource
  fingerprint: string
}

type ConfirmationRequest = {
  title: string
  description: string
  confirmLabel: string
  action: () => void | Promise<void>
}

`

fs.writeFileSync('apps/desktop/src/App.tsx', `${header}${app}\n`)
console.log('rewrote App.tsx', header.split(/\n/).length + app.split(/\n/).length, 'lines')
