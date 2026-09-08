import fs from 'node:fs'

const source = fs.readFileSync('apps/desktop/src/components/workspace/WorkspacePanes.tsx', 'utf8')
const lines = source.split(/\n/)
const markers = {
  RulesPane: lines.findIndex((line) => line.startsWith('export function RulesPane')),
  RenamePane: lines.findIndex((line) => line.startsWith('export function RenamePane')),
  DuplicatePane: lines.findIndex((line) => line.startsWith('export function DuplicatePane')),
  PlanTable: lines.findIndex((line) => line.startsWith('function PlanTable')),
}

const sharedImports = `import { ArrowDown, ArrowUp, Copy, Download, FileSearch, FolderOpen, History, Loader2, Play, Plus, Power, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import { RuleSetEditor, type RuleSetEditorValue } from '@/components/RuleSetEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ChangePlan, Collision, DuplicateGroup, DuplicateScope, KeepStrategy, PlanOp, RuleSetSummary } from '@/lib/ipc'
import { opLabel } from '@/lib/labels'
import { formatBytes } from '@/lib/utils'
import { COLLISION_LABEL, DUPLICATE_SCOPE_LABEL, KEEP_LABEL } from '@/lib/workspace'
`

const planTable = lines.slice(markers.PlanTable).join('\n')
const rules = lines.slice(markers.RulesPane, markers.RenamePane).join('\n')
const rename = lines.slice(markers.RenamePane, markers.DuplicatePane).join('\n')
const duplicates = lines.slice(markers.DuplicatePane, markers.PlanTable).join('\n')

fs.writeFileSync(
  'apps/desktop/src/components/workspace/PlanTable.tsx',
  `${sharedImports}
${planTable}
`,
)
fs.writeFileSync(
  'apps/desktop/src/components/workspace/RulesPane.tsx',
  `${sharedImports}
import { PlanTable } from '@/components/workspace/PlanTable'

${rules}
`,
)
fs.writeFileSync(
  'apps/desktop/src/components/workspace/RenamePane.tsx',
  `${sharedImports}
import { PlanTable } from '@/components/workspace/PlanTable'

${rename}
`,
)
fs.writeFileSync(
  'apps/desktop/src/components/workspace/DuplicatePane.tsx',
  `${sharedImports}
import { PlanTable } from '@/components/workspace/PlanTable'

${duplicates}
`,
)
fs.writeFileSync(
  'apps/desktop/src/components/workspace/index.ts',
  `export { DuplicatePane } from '@/components/workspace/DuplicatePane'
export { RenamePane } from '@/components/workspace/RenamePane'
export { RulesPane } from '@/components/workspace/RulesPane'
`,
)
fs.unlinkSync('apps/desktop/src/components/workspace/WorkspacePanes.tsx')
console.log({
  rules: rules.split(/\n/).length,
  rename: rename.split(/\n/).length,
  duplicates: duplicates.split(/\n/).length,
  plan: planTable.split(/\n/).length,
})
