import fs from 'node:fs'

const jobsBody = fs.readFileSync('.tmp-jobs-pane.txt', 'utf8').replace(/^function JobsPane/, 'export function JobsPane')
const rest = fs.readFileSync('.tmp-workspace-panes.txt', 'utf8')
const restExported = rest
  .replace(/^function RulesPane/, 'export function RulesPane')
  .replace(/^function RenamePane/m, 'export function RenamePane')
  .replace(/^function DuplicatePane/m, 'export function DuplicatePane')

const jobsFile = `import { History, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { LibrarySummary } from '@/lib/ipc'
import { canRollbackJob, formatDuration, jobKindLabel, jobStatsLabel, jobStatusLabel, jobStatusVariant, opLabel } from '@/lib/labels'
import { formatTime } from '@/lib/utils'
import type { JobOpRecord, JobRecord } from '@nestify/shared'

${jobsBody}
`

const restFile = `import { ArrowDown, ArrowUp, Copy, Download, FileSearch, FolderOpen, History, Loader2, Play, Plus, Power, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
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

${restExported}
`

fs.writeFileSync('apps/desktop/src/components/JobsPane.tsx', jobsFile)
fs.writeFileSync('apps/desktop/src/components/workspace/WorkspacePanes.tsx', restFile)
console.log('wrote', jobsFile.split(/\n/).length, restFile.split(/\n/).length)
