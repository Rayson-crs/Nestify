import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderPlus,
  HardDrive,
  Loader2,
  Search,
  ScanSearch,
  FolderOpen,
  ExternalLink,
  Play,
  FileSearch,
  History,
  Copy,
  RefreshCw,
  Pause,
  Square,
  Trash2,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Power,
  Save,
  Upload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  callNestify,
  type ChangePlan,
  type Collision,
  type DuplicateGroup,
  type DuplicateScope,
  type FilePreview,
  type KeepStrategy,
  type LibrarySummary,
  type NestifyApi,
  type PlanOp,
  type RuleSetSummary,
  type ScanProgress,
  type SearchHit,
  type SearchScope,
  type SearchSortField,
  type ThumbnailPreviewResult,
} from '@/lib/ipc'
import { getNestifyApi } from '@/lib/ipc'
import type { JobOpRecord, JobRecord } from '@nestify/shared'
import { cn, formatBytes, formatTime } from '@/lib/utils'

const DEFAULT_TEMPLATE = "{parent}_{name.regex_replace('\\[.*?\\]', '').trim()}{ext}"
const COLLISION_LABEL: Record<Collision, string> = {
  suffix: '自动追加序号',
  skip: '跳过冲突',
  overwrite: '覆盖（不默认勾选）',
}

type WorkspaceTab = 'search' | 'rules' | 'rename' | 'duplicates' | 'jobs'

const KEEP_LABEL: Record<KeepStrategy, string> = {
  newest: '保留最新',
  oldest: '保留最旧',
  shortest_path: '保留路径最短',
  name_quality: '保留文件名质量最高',
  preferred_dir: '保留优先目录',
}

const DUPLICATE_SCOPE_LABEL: Record<DuplicateScope, string> = {
  library: '整个资料库',
  directory: '指定目录',
  selection: '搜索勾选',
}

const SEARCH_SCOPE_LABEL: Record<SearchScope, string> = DUPLICATE_SCOPE_LABEL
const SEARCH_KIND_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'document', label: '文档' },
  { value: 'archive', label: '压缩包' },
  { value: 'dir', label: '目录' },
] as const
const SEARCH_SORT_OPTIONS = [
  { value: 'relevance', label: '按相关性' },
  { value: 'mtime', label: '按修改时间' },
  { value: 'size', label: '按大小' },
  { value: 'path', label: '按路径' },
  { value: 'name', label: '按名称' },
] as const satisfies Array<{ value: SearchSortField; label: string }>

type SearchKindFilter = (typeof SEARCH_KIND_OPTIONS)[number]['value']

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function parentName(path: string | null | undefined): string {
  if (!path) return '-'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'dir':
      return '目录'
    case 'video':
      return '视频'
    case 'image':
      return '图片'
    case 'archive':
      return '压缩包'
    case 'audio':
      return '音频'
    case 'document':
      return '文档'
    default:
      return kind
  }
}

function opLabel(op: string): string {
  switch (op) {
    case 'rename':
      return '改名'
    case 'move':
      return '移动'
    case 'mkdir':
      return '建目录'
    case 'quarantine':
      return '隔离'
    case 'delete':
      return '删除'
    case 'flatten':
      return '拍平'
    default:
      return op
  }
}

function jobKindLabel(kind: string): string {
  switch (kind) {
    case 'scan':
      return '扫描'
    case 'duplicates':
      return '重复分析'
    case 'rules-preview':
      return '规则预览'
    case 'plan-execute':
      return '执行计划'
    case 'plan-rollback':
      return '回滚'
    default:
      return kind
  }
}

function jobStatusVariant(status: string): 'default' | 'warn' | 'danger' | 'outline' {
  if (status === 'completed') return 'default'
  if (status === 'failed') return 'danger'
  if (status === 'running' || status === 'queued' || status === 'cancelling') return 'warn'
  return 'outline'
}

function jobStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '排队',
    running: '运行中',
    paused: '暂停',
    cancelling: '取消中',
    cancelled: '已取消',
    completed: '完成',
    failed: '失败',
  }
  return labels[status] ?? status
}

function canRollbackJob(job: JobRecord): boolean {
  return (
    job.kind === 'plan-execute' &&
    !job.dryRun &&
    (job.status === 'completed' || job.status === 'failed') &&
    job.opStats.ok > 0
  )
}

function jobStatsLabel(job: JobRecord): string {
  if (job.opStats.total > 0) {
    return `成功 ${job.opStats.ok} / 跳过 ${job.opStats.skipped} / 失败 ${job.opStats.failed}`
  }
  if (job.stats && typeof job.stats === 'object') {
    const stats = job.stats as Record<string, unknown>
    const parts: string[] = []
    if (stats.filesScanned != null) parts.push(`文件 ${String(stats.filesScanned)}`)
    if (stats.dirsScanned != null) parts.push(`目录 ${String(stats.dirsScanned)}`)
    if (stats.errors != null) parts.push(`错误 ${String(stats.errors)}`)
    if (stats.total != null && parts.length === 0) parts.push(`总计 ${String(stats.total)}`)
    return parts.join(' / ') || '-'
  }
  return '-'
}

function formatDuration(startedAt: number | null, finishedAt: number | null): string {
  if (!startedAt || !finishedAt || finishedAt < startedAt) return '-'
  const seconds = (finishedAt - startedAt) / 1000
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
}

export default function App() {
  const [libraries, setLibraries] = useState<LibrarySummary[]>([])
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null)
  const [ruleSets, setRuleSets] = useState<RuleSetSummary[]>([])
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string>('')
  const [tab, setTab] = useState<WorkspaceTab>('search')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [hitTotal, setHitTotal] = useState(0)
  const [searchElapsed, setSearchElapsed] = useState<number | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchKind, setSearchKind] = useState<SearchKindFilter>('')
  const [searchSort, setSearchSort] = useState<SearchSortField>('relevance')
  const [searchScope, setSearchScope] = useState<SearchScope>('library')
  const [searchDirectory, setSearchDirectory] = useState('')
  const [searchOffset, setSearchOffset] = useState(0)
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null)
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [thumbnailResults, setThumbnailResults] = useState<Record<string, ThumbnailPreviewResult | null>>({})
  const [scan, setScan] = useState<ScanProgress>({
    phase: 'idle',
    filesScanned: 0,
    dirsScanned: 0,
    bytesScanned: 0,
    errors: 0,
  })
  const [scanJobId, setScanJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [ipcReady] = useState(() => Boolean(getNestifyApi()))
  const [ruleActionBusy, setRuleActionBusy] = useState<string | null>(null)
  const [ruleDraft, setRuleDraft] = useState({ name: '', description: '' })
  const [collision, setCollision] = useState<Collision>('suffix')
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [plan, setPlan] = useState<ChangePlan | null>(null)
  const [selectedOps, setSelectedOps] = useState<Record<number, boolean>>({})
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [keepStrategy, setKeepStrategy] = useState<KeepStrategy>('newest')
  const [duplicateScope, setDuplicateScope] = useState<DuplicateScope>('library')
  const [duplicateDirectory, setDuplicateDirectory] = useState('')
  const [lastExecuteJobId, setLastExecuteJobId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [jobOps, setJobOps] = useState<JobOpRecord[]>([])
  const [jobOpsLoading, setJobOpsLoading] = useState(false)
  const searchTimer = useRef<number | null>(null)

  const selectedLibrary = libraries.find((item) => item.id === selectedLibraryId) ?? null
  const selectedRuleSet = ruleSets.find((item) => item.id === selectedRuleSetId) ?? null
  const scanning = scan.phase === 'walk' || scan.phase === 'upsert' || Boolean(scan.paused)
  const scanPaused = Boolean(scan.paused)

  const loadLibraries = useCallback(async (preferId?: string) => {
    const { libraries: next } = await callNestify((api) => api.libraryList())
    setLibraries(next)
    setSelectedLibraryId((current) => preferId ?? current ?? next[0]?.id ?? null)
  }, [])

  const loadRules = useCallback(async (preferId?: string) => {
    const { ruleSets: next } = await callNestify((api) => api.rulesList())
    setRuleSets(next)
    setSelectedRuleSetId((current) => {
      const preferred = preferId ?? current
      return preferred && next.some((set) => set.id === preferred) ? preferred : next[0]?.id || ''
    })
    const firstCollision = next[0]?.collision
    if (firstCollision === 'suffix' || firstCollision === 'skip' || firstCollision === 'overwrite') {
      setCollision((current) => current || firstCollision)
    }
  }, [])

  const loadJobs = useCallback(async (options?: { preferJobId?: string }) => {
    setJobsLoading(true)
    try {
      const { jobs: next } = await callNestify((api) => api.jobsList({ limit: 100 }))
      setJobs(next)
      setSelectedJobId((current) => {
        const preferred = options?.preferJobId
        if (preferred && next.some((job) => job.id === preferred)) return preferred
        return next.some((job) => job.id === current) ? current : next[0]?.id ?? null
      })
    } finally {
      setJobsLoading(false)
    }
  }, [])

  const loadJobOps = useCallback(async (jobId: string) => {
    setJobOpsLoading(true)
    try {
      const { ops } = await callNestify((api) => api.jobOps({ jobId }))
      setJobOps(ops)
    } finally {
      setJobOpsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!ipcReady) {
      setError('Nestify IPC 未就绪。请从 Electron 启动，而不是单独打开网页。')
      return
    }
    void (async () => {
      try {
        await Promise.all([loadLibraries(), loadRules(), loadJobs()])
      } catch (err) {
        setError(errorMessage(err))
      }
    })()
  }, [ipcReady, loadLibraries, loadRules, loadJobs])

  useEffect(() => {
    if (!selectedRuleSet) return
    setRuleDraft({ name: selectedRuleSet.name, description: selectedRuleSet.description ?? '' })
  }, [selectedRuleSet?.id, selectedRuleSet?.updatedAt, selectedRuleSet?.name, selectedRuleSet?.description])

  useEffect(() => {
    if (!selectedJobId) {
      setJobOps([])
      return
    }
    void loadJobOps(selectedJobId).catch((err) => setError(errorMessage(err)))
  }, [selectedJobId, loadJobOps])

  useEffect(() => {
    if (!scanning) return
    const timer = window.setInterval(() => {
      void callNestify((api) => api.scanProgress())
        .then(setScan)
        .catch((err) => setError(errorMessage(err)))
    }, 250)
    return () => window.clearInterval(timer)
  }, [scanning])

  useEffect(() => {
    if (tab !== 'jobs') return
    const timer = window.setInterval(() => {
      void loadJobs().catch((err) => setError(errorMessage(err)))
    }, 3000)
    return () => window.clearInterval(timer)
  }, [tab, loadJobs])

  const runSearch = useCallback(
    async (text: string, libraryId = selectedLibraryId, offset = 0) => {
      if (!libraryId) {
        setHits([])
        setHitTotal(0)
        setSearchElapsed(null)
        return
      }
      if (
        (searchScope === 'directory' && !searchDirectory.trim()) ||
        (searchScope === 'selection' && selectedEntryIds.length === 0)
      ) {
        setHits([])
        setHitTotal(0)
        setSearchElapsed(null)
        setSelectedHit(null)
        return
      }

      setSearchBusy(true)
      try {
        const { result } = await callNestify((api) =>
          api.searchQuery({
            libraryId,
            text,
            limit: 200,
            offset,
            kinds: searchKind ? [searchKind] : undefined,
            scope: searchScope,
            directory: searchScope === 'directory' ? searchDirectory.trim() : undefined,
            entryIds: searchScope === 'selection' ? selectedEntryIds : undefined,
            sort: { field: searchSort },
          }),
        )
        setHits(result.hits)
        setHitTotal(result.total)
        setSearchElapsed(result.elapsedMs)
        setSearchOffset(offset)
        setSelectedEntryIds((current) => current.filter((id) => result.hits.some((hit) => hit.entryId === id)))
        setSelectedHit((current) => {
          if (!current) return result.hits[0] ?? null
          return result.hits.find((hit) => hit.entryId === current.entryId) ?? result.hits[0] ?? null
        })
        setError(null)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setSearchBusy(false)
      }
    },
    [searchDirectory, searchKind, searchScope, searchSort, selectedEntryIds, selectedLibraryId],
  )

  useEffect(() => {
    if (!selectedLibraryId) return
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      void runSearch(query, selectedLibraryId)
    }, 300)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [query, selectedLibraryId, runSearch])

  useEffect(() => {
    if (!selectedHit) {
      setPreview(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const next = await callNestify((api) =>
          api.previewFile ? api.previewFile({ path: selectedHit.path }) : Promise.resolve({ kind: 'none' as const }),
        )
        if (!cancelled) setPreview(next)
      } catch {
        if (!cancelled) setPreview({ kind: 'none' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedHit])

  useEffect(() => {
    const imageHits = hits.filter((hit) => hit.kind === 'image')
    if (!ipcReady || !selectedLibraryId || imageHits.length === 0) {
      setThumbnailResults({})
      return
    }

    let cancelled = false
    void (async () => {
      const next = await Promise.all(
        imageHits.map(async (hit, index) => {
          try {
            return await callNestify((api) =>
              api.previewThumbnail
                ? api.previewThumbnail({
                    libraryId: selectedLibraryId,
                    entryId: hit.entryId,
                    kind: 'image',
                    priority: index < 20 ? 'visible' : 'background',
                  })
                : Promise.resolve(null),
            )
          } catch {
            return null
          }
        }),
      )
      if (cancelled) return

      const byEntryId: Record<string, ThumbnailPreviewResult | null> = {}
      imageHits.forEach((hit, index) => {
        byEntryId[hit.entryId] = next[index] ?? null
      })
      setThumbnailResults(byEntryId)
    })()

    return () => {
      cancelled = true
    }
  }, [hits, ipcReady, selectedLibraryId])

  const handleAddLibrary = async () => {
    setBusy('add')
    setError(null)
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked) {
        setNotice('已取消添加资料库')
        return
      }
      const name = parentName(picked.path)
      const { library } = await callNestify((api) => api.libraryAdd({ name, roots: [picked.path] }))
      await loadLibraries(library.id)
      setNotice(`已添加资料库 ${library.name}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleScan = async () => {
    if (!selectedLibraryId) return
    setBusy('scan')
    setError(null)
    try {
      const started = await callNestify((api) => api.scanStart({ libraryId: selectedLibraryId }))
      setScanJobId(started.job.id)
      setScan((current) => ({ ...current, phase: 'walk' }))
      setNotice('扫描已开始')
      await loadJobs({ preferJobId: started.job.id })
      window.setTimeout(() => void runSearch(query, selectedLibraryId), 600)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleScanControl = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!scanJobId) return
    setBusy(`scan:${action}`)
    setError(null)
    try {
      await callNestify((api) => {
        if (action === 'pause') {
          return api.scanPause ? api.scanPause({ jobId: scanJobId }) : Promise.reject(new Error('scan.pause is unavailable'))
        }
        if (action === 'resume') {
          return api.scanResume ? api.scanResume({ jobId: scanJobId }) : Promise.reject(new Error('scan.resume is unavailable'))
        }
        return api.scanCancel ? api.scanCancel({ jobId: scanJobId }) : Promise.reject(new Error('scan.cancel is unavailable'))
      })
      setNotice(action === 'pause' ? '扫描已暂停' : action === 'resume' ? '扫描已恢复' : '正在取消扫描')
      await loadJobs({ preferJobId: scanJobId })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleRemoveLibrary = async (libraryId: string, name: string) => {
    setBusy(`remove:${libraryId}`)
    setError(null)
    try {
      await callNestify((api) =>
        api.libraryRemove ? api.libraryRemove({ id: libraryId }) : Promise.reject(new Error('library.remove is unavailable')),
      )
      setNotice(`已移除资料库 ${name}`)
      await loadLibraries()
      await loadJobs()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleReveal = async (path: string) => {
    setBusy('reveal')
    setError(null)
    try {
      await callNestify((api) => api.shellReveal({ path }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleOpen = async (path: string) => {
    setBusy('open')
    setError(null)
    try {
      await callNestify((api) => api.shellOpen({ path }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const runRuleAction = async (
    key: string,
    action: (api: NestifyApi) => Promise<{ notice: string; preferredId?: string }>,
  ) => {
    setRuleActionBusy(key)
    setError(null)
    try {
      const result = await callNestify(action)
      if (result.preferredId) await loadRules(result.preferredId)
      setNotice(result.notice)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRuleActionBusy(null)
    }
  }

  const handleCreateRuleSet = () =>
    runRuleAction('rules:create', async (api) => {
      const { ruleSet } = await api.rulesCreate({
        name: `自定义规则 ${new Date().toISOString().slice(0, 10)}`,
        description: '用户自定义规则集',
        dryRunDefault: true,
        collision: 'suffix',
        rules: [],
        enabled: true,
        priority: 100,
      })
      return { notice: `已创建 ${ruleSet.name}`, preferredId: ruleSet.id }
    })

  const handleUpdateRuleSet = () => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    const name = ruleDraft.name.trim()
    if (!name) {
      setError('规则集名称不能为空')
      return
    }
    return runRuleAction('rules:update', async (api) => {
      const { ruleSet } = await api.rulesUpdate({
        id: selectedRuleSet.id,
        patch: {
          name,
          description: ruleDraft.description.trim() || undefined,
        },
      })
      return { notice: `已保存 ${ruleSet.name}`, preferredId: ruleSet.id }
    })
  }

  const handleRefreshRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:get', async (api) => {
      const { ruleSet } = await api.rulesGet({ id: selectedRuleSet.id })
      setRuleSets((current) => current.map((item) => (item.id === ruleSet.id ? ruleSet : item)))
      return { notice: `已刷新 ${ruleSet.name}` }
    })
  }

  const handleToggleRuleSet = () => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    return runRuleAction('rules:enable', async (api) => {
      const { ruleSet } = await api.rulesEnable({
        id: selectedRuleSet.id,
        enabled: !selectedRuleSet.enabled,
      })
      return {
        notice: ruleSet.enabled ? `已启用 ${ruleSet.name}` : `已禁用 ${ruleSet.name}`,
        preferredId: ruleSet.id,
      }
    })
  }

  const handleRuleSetPriority = (delta: number) => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    return runRuleAction('rules:priority', async (api) => {
      const { ruleSet } = await api.rulesPriority({
        id: selectedRuleSet.id,
        priority: selectedRuleSet.priority + delta,
      })
      return { notice: `${ruleSet.name} 优先级已更新为 ${ruleSet.priority}`, preferredId: ruleSet.id }
    })
  }

  const handleCloneRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:clone', async (api) => {
      const { ruleSet } = await api.rulesClone({
        sourceId: selectedRuleSet.id,
        name: `${selectedRuleSet.name} Copy`,
      })
      return { notice: `已克隆为 ${ruleSet.name}`, preferredId: ruleSet.id }
    })
  }

  const handleDeleteRuleSet = () => {
    if (!selectedRuleSet || selectedRuleSet.builtin) return
    return runRuleAction('rules:delete', async (api) => {
      await api.rulesDelete({ id: selectedRuleSet.id })
      return { notice: `已删除 ${selectedRuleSet.name}` }
    })
  }

  const handleExportRuleSet = () => {
    if (!selectedRuleSet) return
    return runRuleAction('rules:export', async (api) => {
      const result = await api.rulesExport({ id: selectedRuleSet.id })
      return { notice: result.path ? `已导出到 ${result.path}` : '已取消导出' }
    })
  }

  const handleImportRuleSet = () =>
    runRuleAction('rules:import', async (api) => {
      const result = await api.rulesImport()
      if (!result) return { notice: '已取消导入' }
      return { notice: `已导入 ${result.ruleSet.name}`, preferredId: result.ruleSet.id }
    })

  const applyPlan = (next: ChangePlan) => {
    setPlan(next)
    const map: Record<number, boolean> = {}
    next.ops.forEach((op, index) => {
      map[index] = op.selected && op.risk !== 'overwrite'
    })
    setSelectedOps(map)
  }

  const handleRulesPreview = async () => {
    if (!selectedLibraryId || !selectedRuleSetId) return
    if (!canPreviewScope) return
    setBusy('rules')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.rulesPreview({
          libraryId: selectedLibraryId,
          ruleSetId: selectedRuleSetId,
          scope: duplicateScope,
          entryIds: duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory: duplicateScope === 'directory' ? duplicateDirectory.trim() || undefined : undefined,
          collision,
        }),
      )
      applyPlan(next)
      setNotice(`Dry-run 完成，${next.ops.length} 条变更`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleRenamePreview = async () => {
    if (!selectedLibraryId) return
    if (!canPreviewScope) return
    setBusy('rename')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.renamePreview({
          libraryId: selectedLibraryId,
          template,
          scope: duplicateScope,
          entryIds: duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory: duplicateScope === 'directory' ? duplicateDirectory.trim() || undefined : undefined,
          collision,
        }),
      )
      applyPlan(next)
      setNotice(`改名预览完成，${next.ops.length} 条变更`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleAnalyzeDuplicates = async () => {
    if (!selectedLibraryId) return
    setBusy('duplicates')
    setError(null)
    try {
      const next = await callNestify((api) =>
        api.duplicatesAnalyze({
          libraryId: selectedLibraryId,
          scope: duplicateScope,
          entryIds: duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory:
            duplicateScope === 'directory' || keepStrategy === 'preferred_dir' ? duplicateDirectory : undefined,
          keepStrategy,
        }),
      )
      setDuplicateGroups(next.groups)
      applyPlan(next.plan)
      setNotice(`重复分析完成，${next.groups.length} 组 / 可释放 ${formatBytes(next.groups.reduce((sum, group) => sum + group.wastedBytes, 0))}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleExecutePlan = async () => {
    if (!selectedLibraryId || !plan) return
    const selected = plan.ops.map((op, index) => (selectedOps[index] ? index : -1)).filter((index) => index >= 0)
    setBusy('execute')
    setError(null)
    try {
      const result = await callNestify((api) =>
        api.planExecute({ libraryId: selectedLibraryId, plan, selectedOps: selected }),
      )
      setLastExecuteJobId(result.jobId)
      setNotice(`执行完成：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await loadJobOps(result.jobId)
      await runSearch(query, selectedLibraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleRollback = async () => {
    if (!lastExecuteJobId) return
    setBusy('rollback')
    setError(null)
    try {
      const result = await callNestify((api) => api.planRollback({ jobId: lastExecuteJobId }))
      setNotice(`回滚完成：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await loadJobOps(result.jobId)
      await runSearch(query, selectedLibraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleJobRollback = async (job: JobRecord) => {
    if (!canRollbackJob(job)) return
    setBusy(`rollback:${job.id}`)
    setError(null)
    try {
      const result = await callNestify((api) => api.planRollback({ jobId: job.id }))
      setNotice(`任务 ${job.id.slice(0, 8)} 回滚完成：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await loadJobOps(result.jobId)
      if (job.libraryId) await runSearch(query, job.libraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const selectedCount = useMemo(
    () => Object.values(selectedOps).filter(Boolean).length,
    [selectedOps],
  )
  const scopeNeedsDirectory = duplicateScope === 'directory'
  const canPreviewScope =
    (!scopeNeedsDirectory || duplicateDirectory.trim().length > 0) &&
    (duplicateScope !== 'selection' || selectedEntryIds.length > 0)

  const scanPercent = scanning
    ? Math.min(95, 8 + Math.log10(Math.max(1, scan.filesScanned + scan.dirsScanned)) * 18)
    : scan.phase === 'idle' && scan.filesScanned > 0
      ? 100
      : 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文件名 / ext:mp4 / parent:下载 / kind:video"
            className="pl-8"
            disabled={!selectedLibrary}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void runSearch(query, selectedLibraryId ?? undefined, searchOffset)}
          disabled={!selectedLibrary || searchBusy}
        >
          {searchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          立即搜索
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-[#1c1a18]">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">资料库</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleAddLibrary()}
              disabled={busy !== null}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              添加
            </Button>
          </div>
          <ScrollArea className="flex-1 px-2 pb-2">
            {libraries.length === 0 ? (
              <div className="rounded-sm border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                添加资料库并扫描
              </div>
            ) : (
              <div className="space-y-1">
                {libraries.map((library) => (
                  <div
                    key={library.id}
                    className={cn(
                       'flex w-full items-center gap-1 rounded-sm border px-2 py-2 text-left',
                      selectedLibraryId === library.id ? 'border-primary/50 bg-muted' : 'border-transparent hover:bg-muted/60',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1"
                      disabled={busy === 'add' || busy?.startsWith('remove:')}
                      onClick={() => setSelectedLibraryId(library.id)}
                    >
                      <div className="truncate text-sm">{library.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{library.roots[0]}</div>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0"
                      disabled={busy === `remove:${library.id}` || (scanning && selectedLibraryId === library.id)}
                      title="移除资料库"
                      onClick={() => void handleRemoveLibrary(library.id, library.name)}
                    >
                      {busy === `remove:${library.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="border-t p-2">
            <div className="flex gap-2">
              <Button
                className="min-w-0 flex-1"
                onClick={() => void handleScan()}
                disabled={!selectedLibrary || scanning || busy === 'scan'}
              >
                {scanning || busy === 'scan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                {scanning ? (scanPaused ? '已暂停' : '扫描中') : '扫描'}
              </Button>
              {scanning ? (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    title={scanPaused ? '恢复扫描' : '暂停扫描'}
                    disabled={!scanJobId || busy === 'scan:pause' || busy === 'scan:resume'}
                    onClick={() => void handleScanControl(scanPaused ? 'resume' : 'pause')}
                  >
                    {busy === 'scan:pause' || busy === 'scan:resume' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : scanPaused ? (
                      <Play className="h-4 w-4" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="取消扫描"
                    disabled={!scanJobId || busy === 'scan:cancel'}
                    onClick={() => void handleScanControl('cancel')}
                  >
                    {busy === 'scan:cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)}>
              <TabsList>
                <TabsTrigger value="search">搜索</TabsTrigger>
                <TabsTrigger value="rules">规则</TabsTrigger>
                <TabsTrigger value="rename">改名</TabsTrigger>
                <TabsTrigger value="duplicates">重复</TabsTrigger>
                <TabsTrigger value="jobs">任务</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {selectedLibrary ? selectedLibrary.roots[0] : '未选择资料库'}
              {searchElapsed != null ? <Badge>搜索 {searchElapsed}ms</Badge> : null}
            </div>
          </div>

          {error ? <div className="border-b bg-destructive/15 px-3 py-1.5 text-xs text-destructive">{error}</div> : null}
          {notice && !error ? <div className="border-b bg-primary/10 px-3 py-1.5 text-xs text-primary">{notice}</div> : null}

          <div className="flex min-h-0 flex-1">
            <section className="flex min-w-0 flex-1 flex-col">
              {tab === 'search' ? (
                <SearchPane
                  hits={hits}
                  total={hitTotal}
                  selected={selectedHit}
                  selectedIds={selectedEntryIds}
                  thumbnails={thumbnailResults}
                  kind={searchKind}
                  sort={searchSort}
                  scope={searchScope}
                  directory={searchDirectory}
                  offset={searchOffset}
                  busy={searchBusy}
                  canUseSelectedDirectory={Boolean(selectedHit?.parent)}
                  onSelect={setSelectedHit}
                  onKind={setSearchKind}
                  onSort={setSearchSort}
                  onScope={setSearchScope}
                  onDirectory={setSearchDirectory}
                  onUseSelectedDirectory={() => {
                    if (selectedHit?.parent) setSearchDirectory(selectedHit.parent)
                  }}
                  onPage={(delta) => {
                    const next = Math.max(0, searchOffset + delta * 200)
                    if (next === searchOffset) return
                    setSearchOffset(next)
                    void runSearch(query, selectedLibraryId ?? undefined, next)
                  }}
                  onToggleSelect={(entryId, checked) =>
                    setSelectedEntryIds((current) =>
                      checked ? [...new Set([...current, entryId])] : current.filter((id) => id !== entryId),
                    )
                  }
                  onReveal={(hit) => void handleReveal(hit.path)}
                  empty={!selectedLibrary}
                />
              ) : null}
              {tab === 'rules' ? (
                <RulesPane
                  ruleSets={ruleSets}
                  selectedRuleSet={selectedRuleSet}
                  collision={collision}
                  scope={duplicateScope}
                  directory={duplicateDirectory}
                  searchSelectedCount={selectedEntryIds.length}
                  canPreview={canPreviewScope}
                  canUseSelectedDirectory={Boolean(selectedHit?.parent)}
                  busy={busy === 'rules'}
                  actionBusy={ruleActionBusy}
                  ruleDraft={ruleDraft}
                  onSelectRuleSet={setSelectedRuleSetId}
                  onCollision={setCollision}
                  onScope={setDuplicateScope}
                  onDirectory={setDuplicateDirectory}
                  onUseSelectedDirectory={() => {
                    if (selectedHit?.parent) setDuplicateDirectory(selectedHit.parent)
                  }}
                  onRuleDraft={setRuleDraft}
                  onCreateRuleSet={() => void handleCreateRuleSet()}
                  onUpdateRuleSet={() => void handleUpdateRuleSet()}
                  onRefreshRuleSet={() => void handleRefreshRuleSet()}
                  onToggleRuleSet={() => void handleToggleRuleSet()}
                  onRuleSetPriority={(delta) => void handleRuleSetPriority(delta)}
                  onCloneRuleSet={() => void handleCloneRuleSet()}
                  onDeleteRuleSet={() => void handleDeleteRuleSet()}
                  onExportRuleSet={() => void handleExportRuleSet()}
                  onImportRuleSet={() => void handleImportRuleSet()}
                  onPreview={() => void handleRulesPreview()}
                  plan={plan}
                  selectedOps={selectedOps}
                  onToggleOp={(index, checked) => setSelectedOps((current) => ({ ...current, [index]: checked }))}
                  selectedCount={selectedCount}
                  busyExecute={busy === 'execute'}
                  busyRollback={busy === 'rollback'}
                  lastExecuteJobId={lastExecuteJobId}
                  onExecute={() => void handleExecutePlan()}
                  onRollback={() => void handleRollback()}
                />
              ) : null}
              {tab === 'rename' ? (
                <RenamePane
                  template={template}
                  collision={collision}
                  scope={duplicateScope}
                  directory={duplicateDirectory}
                  searchSelectedCount={selectedEntryIds.length}
                  canPreview={canPreviewScope}
                  canUseSelectedDirectory={Boolean(selectedHit?.parent)}
                  busy={busy === 'rename'}
                  onTemplate={setTemplate}
                  onCollision={setCollision}
                  onScope={setDuplicateScope}
                  onDirectory={setDuplicateDirectory}
                  onUseSelectedDirectory={() => {
                    if (selectedHit?.parent) setDuplicateDirectory(selectedHit.parent)
                  }}
                  onPreview={() => void handleRenamePreview()}
                  plan={plan}
                  selectedOps={selectedOps}
                  onToggleOp={(index, checked) => setSelectedOps((current) => ({ ...current, [index]: checked }))}
                  selectedCount={selectedCount}
                  busyExecute={busy === 'execute'}
                  busyRollback={busy === 'rollback'}
                  lastExecuteJobId={lastExecuteJobId}
                  onExecute={() => void handleExecutePlan()}
                  onRollback={() => void handleRollback()}
                />
              ) : null}
              {tab === 'duplicates' ? (
                <DuplicatePane
                  groups={duplicateGroups}
                  keepStrategy={keepStrategy}
                  scope={duplicateScope}
                  directory={duplicateDirectory}
                  searchSelectedCount={selectedEntryIds.length}
                  canUseSelectedDirectory={Boolean(selectedHit?.parent)}
                  busy={busy === 'duplicates'}
                  onKeepStrategy={setKeepStrategy}
                  onScope={setDuplicateScope}
                  onDirectory={setDuplicateDirectory}
                  onUseSelectedDirectory={() => {
                    if (selectedHit?.parent) setDuplicateDirectory(selectedHit.parent)
                  }}
                  onAnalyze={() => void handleAnalyzeDuplicates()}
                  plan={plan}
                  selectedOps={selectedOps}
                  onToggleOp={(index, checked) => setSelectedOps((current) => ({ ...current, [index]: checked }))}
                  selectedCount={selectedCount}
                  busyExecute={busy === 'execute'}
                  busyRollback={busy === 'rollback'}
                  lastExecuteJobId={lastExecuteJobId}
                  onExecute={() => void handleExecutePlan()}
                  onRollback={() => void handleRollback()}
                />
              ) : null}
              {tab === 'jobs' ? (
                <JobsPane
                  jobs={jobs}
                  libraries={libraries}
                  selectedJobId={selectedJobId}
                  ops={jobOps}
                  loading={jobsLoading}
                  opsLoading={jobOpsLoading}
                  busyJobId={busy?.startsWith('rollback:') ? busy.slice('rollback:'.length) : null}
                  onRefresh={() => void loadJobs().catch((err) => setError(errorMessage(err)))}
                  onSelect={setSelectedJobId}
                  onRollback={(job) => void handleJobRollback(job)}
                />
              ) : null}
            </section>

            <Inspector
              hit={selectedHit}
              preview={preview}
              busyReveal={busy === 'reveal'}
              busyOpen={busy === 'open'}
              actionsBusy={busy !== null}
              onOpen={() => selectedHit && void handleOpen(selectedHit.path)}
              onReveal={() => selectedHit && void handleReveal(selectedHit.path)}
            />
          </div>
        </main>
      </div>

      <footer className="flex h-8 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground">
        <span className="w-16">{scan.phase}</span>
        <Progress value={scanPercent} className="w-40" />
        <span>文件 {scan.filesScanned}</span>
        <span>目录 {scan.dirsScanned}</span>
        {scan.filesPerSecond ? <span>{Math.round(scan.filesPerSecond)}/s</span> : null}
        {scan.errors ? <span className="text-destructive">错误 {scan.errors}</span> : null}
        <span className="min-w-0 flex-1 truncate">{scan.currentPath || '就绪'}</span>
        {searchElapsed != null ? <span>搜索 {searchElapsed}ms / {hitTotal}</span> : null}
      </footer>
    </div>
  )
}

function SearchPane({
  hits,
  total,
  selected,
  selectedIds,
  thumbnails,
  kind,
  sort,
  scope,
  directory,
  offset,
  busy,
  canUseSelectedDirectory,
  onSelect,
  onKind,
  onSort,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onPage,
  onToggleSelect,
  onReveal,
  empty,
}: {
  hits: SearchHit[]
  total: number
  selected: SearchHit | null
  selectedIds: string[]
  thumbnails: Record<string, ThumbnailPreviewResult | null>
  kind: SearchKindFilter
  sort: SearchSortField
  scope: SearchScope
  directory: string
  offset: number
  busy: boolean
  canUseSelectedDirectory: boolean
  onSelect: (hit: SearchHit) => void
  onKind: (value: SearchKindFilter) => void
  onSort: (value: SearchSortField) => void
  onScope: (value: SearchScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onPage: (delta: number) => void
  onToggleSelect: (entryId: string, checked: boolean) => void
  onReveal: (hit: SearchHit) => void
  empty: boolean
}) {
  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        添加资料库并扫描
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <NativeSelect value={kind} disabled={busy} onChange={(event) => onKind(event.target.value as SearchKindFilter)}>
          {SEARCH_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={sort} disabled={busy} onChange={(event) => onSort(event.target.value as SearchSortField)}>
          {SEARCH_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={scope} disabled={busy} onChange={(event) => onScope(event.target.value as SearchScope)}>
          {(Object.keys(SEARCH_SCOPE_LABEL) as SearchScope[]).map((key) => (
            <option key={key} value={key}>
              {SEARCH_SCOPE_LABEL[key]}
            </option>
          ))}
        </NativeSelect>
        {scope === 'directory' ? (
          <div className="flex min-w-[16rem] flex-1 items-center gap-2">
            <Input
              value={directory}
              disabled={busy}
              onChange={(event) => onDirectory(event.target.value)}
              placeholder="D:\\目录"
            />
            <Button
              variant="outline"
              size="icon"
              title="使用当前选中文件所在目录"
              disabled={!canUseSelectedDirectory || busy}
              onClick={onUseSelectedDirectory}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {scope === 'selection' ? <Badge variant="outline">已选 {selectedIds.length}</Badge> : null}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" title="上一页" disabled={busy || offset === 0} onClick={() => onPage(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-24 text-center text-xs text-muted-foreground">
            {hits.length === 0 ? `0 / ${total}` : `${offset + 1}-${offset + hits.length} / ${total}`}
          </span>
          <Button
            variant="outline"
            size="icon"
            title="下一页"
            disabled={busy || offset + hits.length >= total}
            onClick={() => onPage(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
      <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>名称</TableHead>
            <TableHead className="w-20">类型</TableHead>
            <TableHead className="w-24">大小</TableHead>
            <TableHead className="w-36">修改时间</TableHead>
            <TableHead>路径</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {hits.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                {total === 0 ? '没有匹配结果。可试 ext:mp4 或 parent:下载' : '没有可见结果'}
              </TableCell>
            </TableRow>
          ) : (
            hits.map((hit) => {
              const thumbnail = thumbnails[hit.entryId]
              return (
              <TableRow
                key={hit.entryId}
                data-state={selected?.entryId === hit.entryId ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={() => onSelect(hit)}
                onDoubleClick={() => onReveal(hit)}
              >
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.includes(hit.entryId)}
                    disabled={busy}
                    onCheckedChange={(checked) => onToggleSelect(hit.entryId, checked === true)}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex min-w-0 items-center gap-2">
                    {hit.kind === 'image' ? (
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm border bg-black/30"
                        title={thumbnail?.error?.message ?? hit.name}
                      >
                        {thumbnail?.url ? (
                          <img
                            src={thumbnail.url}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : thumbnail ? null : (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                  </div>
                </TableCell>
                <TableCell>{kindLabel(hit.kind)}</TableCell>
                <TableCell>{hit.kind === 'dir' ? '-' : formatBytes(hit.size)}</TableCell>
                <TableCell>{formatTime(hit.mtime)}</TableCell>
                <TableCell className="max-w-[28rem] truncate text-muted-foreground" title={hit.path}>
                  {hit.path}
                </TableCell>
              </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
      </ScrollArea>
    </div>
  )
}

function JobsPane({
  jobs,
  libraries,
  selectedJobId,
  ops,
  loading,
  opsLoading,
  busyJobId,
  onRefresh,
  onSelect,
  onRollback,
}: {
  jobs: JobRecord[]
  libraries: LibrarySummary[]
  selectedJobId: string | null
  ops: JobOpRecord[]
  loading: boolean
  opsLoading: boolean
  busyJobId: string | null
  onRefresh: () => void
  onSelect: (jobId: string) => void
  onRollback: (job: JobRecord) => void
}) {
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null
  const libraryNames = new Map(libraries.map((library) => [library.id, library.name]))

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,38%)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-b">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            最近任务
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">开始时间</TableHead>
                <TableHead className="w-24">类型</TableHead>
                <TableHead className="w-20">状态</TableHead>
                <TableHead className="w-20">Dry-run</TableHead>
                <TableHead className="w-24">耗时</TableHead>
                <TableHead className="w-28">资料库</TableHead>
                <TableHead>操作统计</TableHead>
                <TableHead className="w-24">回滚</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    暂无任务
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job) => (
                  <TableRow
                    key={job.id}
                    data-state={selectedJobId === job.id ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => onSelect(job.id)}
                  >
                    <TableCell>{formatTime(job.startedAt ?? job.finishedAt)}</TableCell>
                    <TableCell>{jobKindLabel(job.kind)}</TableCell>
                    <TableCell>
                      <Badge variant={jobStatusVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={job.dryRun ? 'outline' : 'default'}>{job.dryRun ? '是' : '否'}</Badge>
                    </TableCell>
                    <TableCell>{formatDuration(job.startedAt, job.finishedAt)}</TableCell>
                    <TableCell className="truncate" title={job.libraryId ?? ''}>
                      {job.libraryId ? libraryNames.get(job.libraryId) ?? job.libraryId.slice(0, 8) : '-'}
                    </TableCell>
                    <TableCell className="max-w-64 truncate" title={job.error ?? jobStatsLabel(job)}>
                      <span className={job.error ? 'text-destructive' : undefined}>
                        {job.error ?? jobStatsLabel(job)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canRollbackJob(job) || busyJobId === job.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          onRollback(job)
                        }}
                      >
                        {busyJobId === job.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
                        回滚
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <div className="min-w-0 truncate">
            {selectedJob
              ? `${jobKindLabel(selectedJob.kind)} · ${selectedJob.id}`
              : '选择任务查看步骤'}
            {opsLoading ? <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" /> : null}
          </div>
          {selectedJob ? <Badge variant={jobStatusVariant(selectedJob.status)}>{jobStatusLabel(selectedJob.status)}</Badge> : null}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {ops.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {selectedJob ? '该任务没有逐步日志' : '选择一个任务'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                  <TableHead className="w-20">状态</TableHead>
                  <TableHead>原路径</TableHead>
                  <TableHead>新路径</TableHead>
                  <TableHead className="w-64">错误</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ops.map((op) => (
                  <TableRow key={`${op.jobId}:${op.seq}`}>
                    <TableCell>{op.seq + 1}</TableCell>
                    <TableCell>{opLabel(op.op)}</TableCell>
                    <TableCell>
                      <Badge variant={op.status === 'failed' ? 'danger' : op.status === 'ok' ? 'default' : 'outline'}>
                        {op.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={op.from}>
                      {op.from}
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={op.to ?? ''}>
                      {op.to ?? '-'}
                    </TableCell>
                    <TableCell className="text-destructive">{op.error ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}

function Inspector({
  hit,
  preview,
  busyReveal,
  busyOpen,
  actionsBusy,
  onOpen,
  onReveal,
}: {
  hit: SearchHit | null
  preview: FilePreview | null
  busyReveal: boolean
  busyOpen: boolean
  actionsBusy: boolean
  onOpen: () => void
  onReveal: () => void
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-[#1a1816]">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground">预览</div>
      <div className="mx-3 mb-3 flex h-44 items-center justify-center overflow-hidden rounded-sm border bg-black/30">
        {preview?.kind === 'image' && preview.dataUrl ? (
          <img src={preview.dataUrl} alt={hit?.name} className="h-full w-full object-contain" />
        ) : preview?.kind === 'video' && preview.src ? (
          <video src={preview.src} className="h-full w-full object-contain" controls muted />
        ) : (
          <div className="px-4 text-center text-xs text-muted-foreground">
            {preview?.kind === 'too-large' ? '图片过大，未内嵌预览' : hit ? '该类型暂无内嵌预览' : '选择一条结果'}
          </div>
        )}
      </div>
      <div className="space-y-2 px-3 text-xs">
        <Field label="名称" value={hit?.name ?? '-'} />
        <Field label="类型" value={hit ? kindLabel(hit.kind) : '-'} />
        <Field label="大小" value={hit && hit.kind !== 'dir' ? formatBytes(hit.size) : '-'} />
        <Field label="修改" value={formatTime(hit?.mtime)} />
        <Field label="父目录" value={parentName(hit?.parent)} />
        <Field label="路径" value={hit?.path ?? '-'} />
      </div>
      <div className="mt-auto flex gap-2 p-3">
        <Button
          variant="outline"
          className="flex-1"
          disabled={!hit || actionsBusy}
          onClick={onReveal}
        >
          {busyReveal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
          定位
        </Button>
        <Button className="flex-1" disabled={!hit || actionsBusy} onClick={onOpen}>
          {busyOpen ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          打开
        </Button>
      </div>
    </aside>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-all text-foreground">{value}</div>
    </div>
  )
}

function RulesPane({
  ruleSets,
  selectedRuleSet,
  collision,
  scope,
  directory,
  searchSelectedCount,
  canPreview,
  canUseSelectedDirectory,
  busy,
  actionBusy,
  ruleDraft,
  onSelectRuleSet,
  onCollision,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onRuleDraft,
  onCreateRuleSet,
  onUpdateRuleSet,
  onRefreshRuleSet,
  onToggleRuleSet,
  onRuleSetPriority,
  onCloneRuleSet,
  onDeleteRuleSet,
  onExportRuleSet,
  onImportRuleSet,
  onPreview,
  plan,
  selectedOps,
  onToggleOp,
  selectedCount,
  busyExecute,
  busyRollback,
  lastExecuteJobId,
  onExecute,
  onRollback,
}: {
  ruleSets: RuleSetSummary[]
  selectedRuleSet: RuleSetSummary | null
  collision: Collision
  scope: DuplicateScope
  directory: string
  searchSelectedCount: number
  canPreview: boolean
  canUseSelectedDirectory: boolean
  busy: boolean
  actionBusy: string | null
  ruleDraft: { name: string; description: string }
  onSelectRuleSet: (id: string) => void
  onCollision: (value: Collision) => void
  onScope: (value: DuplicateScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onRuleDraft: (value: { name: string; description: string }) => void
  onCreateRuleSet: () => void
  onUpdateRuleSet: () => void
  onRefreshRuleSet: () => void
  onToggleRuleSet: () => void
  onRuleSetPriority: (delta: number) => void
  onCloneRuleSet: () => void
  onDeleteRuleSet: () => void
  onExportRuleSet: () => void
  onImportRuleSet: () => void
  onPreview: () => void
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  onToggleOp: (index: number, checked: boolean) => void
  selectedCount: number
  busyExecute: boolean
  busyRollback: boolean
  lastExecuteJobId: string | null
  onExecute: () => void
  onRollback: () => void
}) {
  const anyRuleAction = actionBusy !== null
  const anyBusy = anyRuleAction || busy || busyExecute || busyRollback
  const ruleActionPending = (key: string) => actionBusy === key
  const draftDirty =
    selectedRuleSet &&
    !selectedRuleSet.builtin &&
    (ruleDraft.name.trim() !== selectedRuleSet.name ||
      ruleDraft.description.trim() !== (selectedRuleSet.description ?? ''))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <NativeSelect
          value={selectedRuleSet?.id ?? ''}
          disabled={anyBusy}
          onChange={(event) => onSelectRuleSet(event.target.value)}
        >
          {ruleSets.map((set) => (
            <option key={set.id} value={set.id}>
              {`${set.name}${set.builtin ? '（内置）' : set.enabled ? '' : '（禁用）'} · P${set.priority}`}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={collision}
          disabled={anyBusy}
          onChange={(event) => onCollision(event.target.value as Collision)}
        >
          {(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => (
            <option key={key} value={key}>
              {COLLISION_LABEL[key]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={scope}
          disabled={anyBusy}
          onChange={(event) => onScope(event.target.value as DuplicateScope)}
        >
          {(Object.keys(DUPLICATE_SCOPE_LABEL) as DuplicateScope[]).map((key) => (
            <option key={key} value={key}>
              {DUPLICATE_SCOPE_LABEL[key]}
            </option>
          ))}
        </NativeSelect>
        {scope === 'directory' ? (
          <div className="flex min-w-[16rem] flex-1 items-center gap-2">
            <Input
              value={directory}
              onChange={(event) => onDirectory(event.target.value)}
              placeholder="D:\\目录"
            />
            <Button
              variant="outline"
              size="icon"
              title="使用当前选中文件所在目录"
              disabled={!canUseSelectedDirectory || anyBusy}
              onClick={onUseSelectedDirectory}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {scope === 'selection' ? <Badge variant="outline">已选 {searchSelectedCount}</Badge> : null}
        <Button
          onClick={onPreview}
          disabled={!selectedRuleSet || !selectedRuleSet.enabled || anyBusy || !canPreview}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
          Dry-run
        </Button>
        <Button onClick={onExecute} disabled={anyBusy || selectedCount === 0}>
          {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          执行选中
        </Button>
        {lastExecuteJobId ? (
          <Button variant="outline" onClick={onRollback} disabled={anyBusy}>
            {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            回滚
          </Button>
        ) : null}
        {plan ? <Badge>{selectedCount}/{plan.ops.length} 勾选</Badge> : null}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)]">
        <ScrollArea className="border-r p-3">
          {selectedRuleSet ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{selectedRuleSet.name}</div>
                  <div className="text-[11px] text-muted-foreground">优先级 P{selectedRuleSet.priority}</div>
                </div>
                <Badge variant={selectedRuleSet.enabled ? 'default' : 'outline'}>
                  {selectedRuleSet.builtin ? '内置只读' : selectedRuleSet.enabled ? '启用' : '禁用'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" size="icon" title="新建自定义规则集" disabled={anyBusy} onClick={onCreateRuleSet}>
                  {ruleActionPending('rules:create') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="刷新当前规则集"
                  disabled={anyBusy}
                  onClick={onRefreshRuleSet}
                >
                  {ruleActionPending('rules:get') ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="克隆当前规则集"
                  disabled={!selectedRuleSet || anyBusy}
                  onClick={onCloneRuleSet}
                >
                  {ruleActionPending('rules:clone') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title={selectedRuleSet.enabled ? '禁用规则集' : '启用规则集'}
                  disabled={selectedRuleSet.builtin || anyBusy}
                  onClick={onToggleRuleSet}
                >
                  {ruleActionPending('rules:enable') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="提高优先级（数字更小）"
                  disabled={selectedRuleSet.builtin || anyBusy}
                  onClick={() => onRuleSetPriority(-1)}
                >
                  {ruleActionPending('rules:priority') ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="降低优先级（数字更大）"
                  disabled={selectedRuleSet.builtin || anyBusy}
                  onClick={() => onRuleSetPriority(1)}
                >
                  {ruleActionPending('rules:priority') ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDown className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="导出 YAML"
                  disabled={!selectedRuleSet || anyBusy}
                  onClick={onExportRuleSet}
                >
                  {ruleActionPending('rules:export') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" title="导入 YAML" disabled={anyBusy} onClick={onImportRuleSet}>
                  {ruleActionPending('rules:import') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="删除自定义规则集"
                  disabled={selectedRuleSet.builtin || anyBusy}
                  onClick={onDeleteRuleSet}
                >
                  {ruleActionPending('rules:delete') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
              {selectedRuleSet.builtin ? (
                <p className="text-[11px] text-muted-foreground">内置规则集只读。需要修改时先克隆为自定义规则集。</p>
              ) : (
                <div className="space-y-2 border-b pb-3">
                  <Input
                    value={ruleDraft.name}
                    disabled={anyBusy}
                    onChange={(event) => onRuleDraft({ ...ruleDraft, name: event.target.value })}
                    placeholder="规则集名称"
                  />
                  <Input
                    value={ruleDraft.description}
                    disabled={anyBusy}
                    onChange={(event) => onRuleDraft({ ...ruleDraft, description: event.target.value })}
                    placeholder="描述（可选）"
                  />
                  <Button
                    size="sm"
                                       disabled={anyBusy || !draftDirty || !ruleDraft.name.trim()}
                    onClick={onUpdateRuleSet}
                  >
                    {ruleActionPending('rules:update') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    保存信息
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{selectedRuleSet.description || '按优先级匹配后生成变更计划'}</p>
              {selectedRuleSet.rules.map((rule) => (
                <div key={rule.id} className="rounded-sm border px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{rule.id}</span>
                    <Badge variant={rule.enabled ? 'default' : 'outline'}>{rule.enabled ? '启用' : '禁用'}</Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    P{rule.priority} · {opLabel(rule.action)}
                  </div>
                  {rule.template ? <code className="mt-1 block break-all text-[11px]">{rule.template}</code> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">没有规则方案</div>
          )}
        </ScrollArea>
        <PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} />
      </div>
    </div>
  )
}

function RenamePane({
  template,
  collision,
  scope,
  directory,
  searchSelectedCount,
  canPreview,
  canUseSelectedDirectory,
  busy,
  onTemplate,
  onCollision,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onPreview,
  plan,
  selectedOps,
  onToggleOp,
  selectedCount,
  busyExecute,
  busyRollback,
  lastExecuteJobId,
  onExecute,
  onRollback,
}: {
  template: string
  collision: Collision
  scope: DuplicateScope
  directory: string
  searchSelectedCount: number
  canPreview: boolean
  canUseSelectedDirectory: boolean
  busy: boolean
  onTemplate: (value: string) => void
  onCollision: (value: Collision) => void
  onScope: (value: DuplicateScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onPreview: () => void
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  onToggleOp: (index: number, checked: boolean) => void
  selectedCount: number
  busyExecute: boolean
  busyRollback: boolean
  lastExecuteJobId: string | null
  onExecute: () => void
  onRollback: () => void
}) {
  const anyBusy = busy || busyExecute || busyRollback

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b px-3 py-2">
        <Input value={template} disabled={anyBusy} onChange={(event) => onTemplate(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={scope}
            disabled={anyBusy}
            onChange={(event) => onScope(event.target.value as DuplicateScope)}
          >
            {(Object.keys(DUPLICATE_SCOPE_LABEL) as DuplicateScope[]).map((key) => (
              <option key={key} value={key}>
                {DUPLICATE_SCOPE_LABEL[key]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={collision}
            disabled={anyBusy}
            onChange={(event) => onCollision(event.target.value as Collision)}
          >
            {(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => (
              <option key={key} value={key}>
                {COLLISION_LABEL[key]}
              </option>
            ))}
          </NativeSelect>
          {scope === 'directory' ? (
            <div className="flex min-w-[16rem] flex-1 items-center gap-2">
              <Input
                value={directory}
                disabled={anyBusy}
                onChange={(event) => onDirectory(event.target.value)}
                placeholder="D:\\目录"
              />
              <Button
                variant="outline"
                size="icon"
              title="使用当前选中文件所在目录"
              disabled={!canUseSelectedDirectory || anyBusy}
              onClick={onUseSelectedDirectory}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          {scope === 'selection' ? <Badge variant="outline">已选 {searchSelectedCount}</Badge> : null}
          <Button onClick={onPreview} disabled={anyBusy || !template.trim() || !canPreview}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            预览改名
          </Button>
          <Button onClick={onExecute} disabled={anyBusy || selectedCount === 0}>
            {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            执行选中
          </Button>
          {lastExecuteJobId ? (
            <Button variant="outline" onClick={onRollback} disabled={anyBusy}>
              {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
              回滚
            </Button>
          ) : null}
          {plan ? <Badge>{selectedCount}/{plan.ops.length} 勾选</Badge> : null}
        </div>
        <div className="text-[11px] text-muted-foreground">
          例：a/b/c/a.txt 用 {'{parent}{ext}'} 得到 c.txt，用 {'{grandparent}{ext}'} 得到 b.txt
        </div>
      </div>
      <PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} />
    </div>
  )
}

function DuplicatePane({
  groups,
  keepStrategy,
  scope,
  directory,
  searchSelectedCount,
  canUseSelectedDirectory,
  busy,
  onKeepStrategy,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onAnalyze,
  plan,
  selectedOps,
  onToggleOp,
  selectedCount,
  busyExecute,
  busyRollback,
  lastExecuteJobId,
  onExecute,
  onRollback,
}: {
  groups: DuplicateGroup[]
  keepStrategy: KeepStrategy
  scope: DuplicateScope
  directory: string
  searchSelectedCount: number
  canUseSelectedDirectory: boolean
  busy: boolean
  onKeepStrategy: (value: KeepStrategy) => void
  onScope: (value: DuplicateScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onAnalyze: () => void
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  onToggleOp: (index: number, checked: boolean) => void
  selectedCount: number
  busyExecute: boolean
  busyRollback: boolean
  lastExecuteJobId: string | null
  onExecute: () => void
  onRollback: () => void
}) {
  const wasted = groups.reduce((sum, group) => sum + group.wastedBytes, 0)
  const anyBusy = busy || busyExecute || busyRollback
  const needsDirectory = scope === 'directory' || keepStrategy === 'preferred_dir'
  const canAnalyze =
    !anyBusy &&
    (!needsDirectory || directory.trim().length > 0) &&
    (scope !== 'selection' || searchSelectedCount > 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <NativeSelect
          value={scope}
          disabled={anyBusy}
          onChange={(event) => onScope(event.target.value as DuplicateScope)}
        >
          {(Object.keys(DUPLICATE_SCOPE_LABEL) as DuplicateScope[]).map((key) => (
            <option key={key} value={key}>
              {DUPLICATE_SCOPE_LABEL[key]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={keepStrategy}
          disabled={anyBusy}
          onChange={(event) => onKeepStrategy(event.target.value as KeepStrategy)}
        >
          {(Object.keys(KEEP_LABEL) as KeepStrategy[]).map((key) => (
            <option key={key} value={key}>
              {KEEP_LABEL[key]}
            </option>
            ))}
        </NativeSelect>
        {needsDirectory ? (
          <div className="flex min-w-[18rem] flex-1 items-center gap-2">
            <Input
              value={directory}
              disabled={anyBusy}
              onChange={(event) => onDirectory(event.target.value)}
              placeholder="D:\\目录"
            />
            <Button
              variant="outline"
              size="icon"
              title="使用当前选中文件所在目录"
              disabled={!canUseSelectedDirectory || anyBusy}
              onClick={onUseSelectedDirectory}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        <Button onClick={onAnalyze} disabled={!canAnalyze}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          分析重复
        </Button>
        <Button onClick={onExecute} disabled={anyBusy || selectedCount === 0}>
          {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          隔离选中
        </Button>
        {lastExecuteJobId ? (
          <Button variant="outline" onClick={onRollback} disabled={anyBusy}>
            {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            回滚
          </Button>
        ) : null}
        {scope === 'selection' ? <Badge variant="outline">已选 {searchSelectedCount}</Badge> : null}
        {groups.length > 0 ? <Badge>{groups.length} 组 / {formatBytes(wasted)}</Badge> : null}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)]">
        <ScrollArea className="border-r p-2">
          {groups.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">先分析重复候选</div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => (
                <div key={group.id} className="rounded-sm border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{group.id}</span>
                    <Badge>{formatBytes(group.wastedBytes)} 可释放</Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">SHA256 {group.hash.slice(0, 16)}...</div>
                  <div className="mt-2 space-y-1">
                    {group.files.map((file) => (
                      <div key={file.entryId} className="truncate text-[11px]" title={file.path}>
                        {file.keep ? '保留 · ' : '隔离 · '}
                        {file.path}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <PlanTable plan={plan} selectedOps={selectedOps} disabled={anyBusy} onToggleOp={onToggleOp} />
      </div>
    </div>
  )
}

function PlanTable({
  plan,
  selectedOps,
  disabled,
  onToggleOp,
}: {
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  disabled?: boolean
  onToggleOp: (index: number, checked: boolean) => void
}) {
  if (!plan) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">先做 Dry-run，不会写盘</div>
  }
  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-wrap gap-2 px-3 py-2 text-[11px] text-muted-foreground">
        <Badge>改名 {plan.summary.rename}</Badge>
        <Badge>移动 {plan.summary.move}</Badge>
        <Badge>拍平 {plan.summary.flatten}</Badge>
        <Badge>隔离 {plan.summary.quarantine}</Badge>
        <Badge variant={plan.summary.conflicts ? 'warn' : 'default'}>冲突 {plan.summary.conflicts}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead className="w-16">操作</TableHead>
            <TableHead>原路径</TableHead>
            <TableHead>新路径</TableHead>
            <TableHead className="w-24">风险</TableHead>
            <TableHead>原因</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.ops.map((op, index) => (
            <PlanRow
              key={`${op.from}-${index}`}
              op={op}
              checked={Boolean(selectedOps[index])}
              disabled={disabled}
              onCheckedChange={(checked) => onToggleOp(index, checked)}
            />
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}

function PlanRow({
  op,
  checked,
  disabled,
  onCheckedChange,
}: {
  op: PlanOp
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <TableRow>
      <TableCell>
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      </TableCell>
      <TableCell>{opLabel(op.op)}</TableCell>
      <TableCell className="max-w-[18rem] truncate" title={op.from}>
        {op.from}
      </TableCell>
      <TableCell className="max-w-[18rem] truncate" title={op.to ?? ''}>
        {op.to ?? '-'}
      </TableCell>
      <TableCell>
        <Badge variant={op.risk === 'none' ? 'default' : op.risk === 'overwrite' ? 'danger' : 'warn'}>{op.risk}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{op.reason}</TableCell>
    </TableRow>
  )
}
