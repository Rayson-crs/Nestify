from pathlib import Path
import re

src = Path(r"apps/desktop/src")
app_path = src / "App.tsx"
text = app_path.read_text(encoding="utf-8")
lines = text.splitlines(True)

# markers (0-based)
fn = next(i for i, line in enumerate(lines) if line.startswith("export default function App()"))
add = next(i for i, line in enumerate(lines) if line.startswith("  const handleAddLibrary"))
ret = next(i for i, line in enumerate(lines) if i > add and line.startswith("  return ("))
end = len(lines) - 1
while end > ret and lines[end].strip() == "":
    end -= 1

header = "".join(lines[:fn])
body = "".join(lines[fn+1:ret])
jsx = "".join(lines[ret:])  # includes return ( ... )\n}\n

# collect returned identifiers: useState pairs, consts, refs
idents = []
seen = set()
for line in lines[fn+1:ret]:
    m = re.match(r"  const \[([A-Za-z0-9]+), ([A-Za-z0-9]+)\] =", line)
    if m:
        for name in m.groups():
            if name not in seen:
                seen.add(name)
                idents.append(name)
        continue
    m = re.match(r"  const ([A-Za-z0-9]+) =", line)
    if m:
        name = m.group(1)
        if name not in seen:
            seen.add(name)
            idents.append(name)

# pendingTreePath is a ref used in JSX
if "pendingTreePath" not in seen:
    idents.append("pendingTreePath")

app_dir = src / "app"
app_dir.mkdir(exist_ok=True)

# types used by shell
types = '''import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import type {
  ChangePlan,
  Collision,
  DuplicateGroup,
  DuplicateScope,
  FilePreview,
  KeepStrategy,
  LibrarySummary,
  RuleSetSummary,
  ScanProgress,
  SearchHit,
  SearchScope,
  SearchSortField,
} from '@/lib/ipc'
import type { JobOpRecord, JobRecord } from '@nestify/shared'
import type {
  FileViewMode,
  LibraryDraft,
  SearchKindFilter,
  TriStateSortDirection,
  WorkspaceTab,
} from '@/lib/workspace'

export type ConfirmationRequest = {
  title: string
  description: string
  confirmLabel: string
  action: () => void | Promise<void>
}

export type AppViewModel = {
''' + "\n".join(f"  {name}: any" for name in idents) + "\n}\n"

# We'll replace `any` later if typecheck complains; for speed keep any in generated type
# Better: leave as any for now.

(app_dir / "types.ts").write_text(types, encoding="utf-8")

# hook file
hook = header.replace("export default function App() {", "")
# header currently includes imports and types and constants. Keep them in hook.
# Remove unused UI imports from hook later.

hook_imports_keep = []
# Rebuild hook header from original header but drop UI component imports not needed in logic.
logic_header = """import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
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
  type NestifyApi,
  type RuleSetSummary,
  type ScanProgress,
  type SearchHit,
  type SearchScope,
  type SearchSortField,
} from '@/lib/ipc'
import { getNestifyApi } from '@/lib/ipc'
import { canRollbackJob, errorMessage, parentName } from '@/lib/labels'
import { isWithinDirectory } from '@/lib/path-crumbs'
import type { JobOpRecord, JobRecord } from '@nestify/shared'
import { formatBytes } from '@/lib/utils'
import {
  type FileViewMode,
  type LibraryDraft,
  type PlanSource,
  type SearchKindFilter,
  type TriStateSortDirection,
  type WorkspaceTab,
} from '@/lib/workspace'
import type { AppViewModel, ConfirmationRequest } from '@/app/types'

const DEFAULT_TEMPLATE = "{parent}_{name.regex_replace('\\\\[.*?\\\\]', '').trim()}{ext}"

type PlanState = {
  plan: ChangePlan
  source: PlanSource
  fingerprint: string
}

"""

# original body uses ConfirmationRequest and DEFAULT_TEMPLATE and EMPTY? EMPTY is JSX only
body_text = "".join(lines[fn+1:ret])
# strip EMPTY_LIBRARY from hook if present - it's not in body

return_obj = ",\n".join(f"    {name}" for name in idents)
hook_src = logic_header + "export function useAppWorkspace(): AppViewModel {\n" + body_text + "\n  return {\n" + return_obj + "\n  }\n}\n"
(app_dir / "useAppWorkspace.ts").write_text(hook_src, encoding="utf-8")

# AppShell: original UI imports + destructure + jsx
ui_header = """import {
  FolderPlus,
  HardDrive,
  Loader2,
  Search,
  ScanSearch,
  Play,
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
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileTreePane } from '@/components/files/FileTreePane'
import { FileViewTabs } from '@/components/files/FileViewTabs'
import { Inspector } from '@/components/files/Inspector'
import { SearchPane } from '@/components/files/SearchPane'
import { SpotlightSearch } from '@/components/files/SpotlightSearch'
import { JobsPane } from '@/components/JobsPane'
import { LibraryEditor } from '@/components/LibraryEditor'
import { DuplicatePane, RenamePane, RulesPane } from '@/components/workspace'
import { ALL_LIBRARIES_ID } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { WorkspaceTab } from '@/lib/workspace'
import type { AppViewModel } from '@/app/types'

const EMPTY_LIBRARY_SELECT_VALUE = '__empty__'

export function AppShell(vm: AppViewModel) {
  const {
""" + ",\n".join(f"    {name}" for name in idents) + """
  } = vm

"""
# jsx currently starts with "  return (" and ends with "}\n"
jsx_body = "".join(lines[ret:])
if jsx_body.rstrip().endswith("}"):
    # remove closing function brace
    jsx_body = jsx_body.rstrip()
    jsx_body = jsx_body[:-1]
shell_src = ui_header + jsx_body + "}\n"
(app_dir / "AppShell.tsx").write_text(shell_src, encoding="utf-8")

app_path.write_text("""import { AppShell } from '@/app/AppShell'
import { useAppWorkspace } from '@/app/useAppWorkspace'

export default function App() {
  const vm = useAppWorkspace()
  return <AppShell {...vm} />
}
""", encoding="utf-8")

print("idents", len(idents))
print("hook lines", hook_src.count("\\n")+1)
print("shell lines", shell_src.count("\\n")+1)
print("app lines", 8)
