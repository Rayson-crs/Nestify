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
import { callNestify, type ChangePlan, type Collision, type DuplicateGroup, type FilePreview, type LibrarySummary, type PlanOp, type RuleSetSummary, type ScanProgress, type SearchHit } from '@/lib/ipc'
import type { JobOpRecord, JobRecord } from '@nestify/shared'
import { cn, formatBytes, formatTime } from '@/lib/utils'

const DEFAULT_TEMPLATE = "{parent}_{name.regex_replace('\\[.*?\\]', '').trim()}{ext}"
const COLLISION_LABEL: Record<Collision, string> = {
  suffix: '自动追加序号',
  skip: '跳过冲突',
  overwrite: '覆盖（不默认勾选）',
}

type WorkspaceTab = 'search' | 'rules' | 'rename' | 'duplicates' | 'jobs'

type KeepStrategy = 'newest' | 'oldest' | 'shortest_path'

const KEEP_LABEL: Record<KeepStrategy, string> = {
  newest: '保留最新',
  oldest: '保留最旧',
  shortest_path: '保留路径最短',
}

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
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [scan, setScan] = useState<ScanProgress>({
    phase: 'idle',
    filesScanned: 0,
    dirsScanned: 0,
    bytesScanned: 0,
    errors: 0,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [collision, setCollision] = useState<Collision>('suffix')
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [plan, setPlan] = useState<ChangePlan | null>(null)
  const [selectedOps, setSelectedOps] = useState<Record<number, boolean>>({})
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [keepStrategy, setKeepStrategy] = useState<KeepStrategy>('newest')
  const [lastExecuteJobId, setLastExecuteJobId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [jobOps, setJobOps] = useState<JobOpRecord[]>([])
  const [jobOpsLoading, setJobOpsLoading] = useState(false)
  const searchTimer = useRef<number | null>(null)

  const selectedLibrary = libraries.find((item) => item.id === selectedLibraryId) ?? null
  const selectedRuleSet = ruleSets.find((item) => item.id === selectedRuleSetId) ?? null
  const scanning = scan.phase === 'walk' || scan.phase === 'upsert'

  const loadLibraries = useCallback(async (preferId?: string) => {
    const { libraries: next } = await callNestify((api) => api.libraryList())
    setLibraries(next)
    setSelectedLibraryId((current) => preferId ?? current ?? next[0]?.id ?? null)
  }, [])

  const loadRules = useCallback(async () => {
    const { ruleSets: next } = await callNestify((api) => api.rulesList())
    setRuleSets(next)
    setSelectedRuleSetId((current) => current || next[0]?.id || '')
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
    void (async () => {
      try {
        await Promise.all([loadLibraries(), loadRules(), loadJobs()])
      } catch (err) {
        setError(errorMessage(err))
      }
    })()
  }, [loadLibraries, loadRules, loadJobs])

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
    async (text: string, libraryId = selectedLibraryId) => {
      if (!libraryId) {
        setHits([])
        setHitTotal(0)
        setSearchElapsed(null)
        return
      }
      try {
        const { result } = await callNestify((api) => api.searchQuery({ libraryId, text, limit: 200 }))
        setHits(result.hits)
        setHitTotal(result.total)
        setSearchElapsed(result.elapsedMs)
        setSelectedHit((current) => {
          if (!current) return result.hits[0] ?? null
          return result.hits.find((hit) => hit.entryId === current.entryId) ?? result.hits[0] ?? null
        })
        setError(null)
      } catch (err) {
        setError(errorMessage(err))
      }
    },
    [selectedLibraryId],
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

  const handleAddLibrary = async () => {
    setBusy('add')
    setError(null)
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked) return
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

  const handleReveal = async (path: string) => {
    try {
      await callNestify((api) => api.shellReveal({ path }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const handleOpen = async (path: string) => {
    try {
      await callNestify((api) => api.shellOpen({ path }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

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
    setBusy('rules')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.rulesPreview({ libraryId: selectedLibraryId, ruleSetId: selectedRuleSetId, collision }),
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
    setBusy('rename')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.renamePreview({ libraryId: selectedLibraryId, template, collision }),
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
        api.duplicatesAnalyze({ libraryId: selectedLibraryId, keepStrategy }),
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
        <Button variant="outline" size="sm" onClick={() => void runSearch(query)} disabled={!selectedLibrary}>
          立即搜索
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-[#1c1a18]">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">资料库</span>
            <Button size="sm" variant="outline" onClick={() => void handleAddLibrary()} disabled={busy === 'add'}>
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
                  <button
                    key={library.id}
                    type="button"
                    className={cn(
                      'w-full rounded-sm border px-2 py-2 text-left',
                      selectedLibraryId === library.id ? 'border-primary/50 bg-muted' : 'border-transparent hover:bg-muted/60',
                    )}
                    onClick={() => setSelectedLibraryId(library.id)}
                  >
                    <div className="truncate text-sm">{library.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{library.roots[0]}</div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="border-t p-2">
            <Button className="w-full" onClick={() => void handleScan()} disabled={!selectedLibrary || scanning}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              {scanning ? '扫描中' : '扫描'}
            </Button>
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
                  onSelect={setSelectedHit}
                  onReveal={(hit) => void handleReveal(hit.path)}
                  empty={!selectedLibrary}
                />
              ) : null}
              {tab === 'rules' ? (
                <RulesPane
                  ruleSets={ruleSets}
                  selectedRuleSet={selectedRuleSet}
                  collision={collision}
                  busy={busy === 'rules'}
                  onSelectRuleSet={setSelectedRuleSetId}
                  onCollision={setCollision}
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
                  busy={busy === 'rename'}
                  onTemplate={setTemplate}
                  onCollision={setCollision}
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
                  busy={busy === 'duplicates'}
                  onKeepStrategy={setKeepStrategy}
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
  onSelect,
  onReveal,
  empty,
}: {
  hits: SearchHit[]
  total: number
  selected: SearchHit | null
  onSelect: (hit: SearchHit) => void
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
    <ScrollArea className="flex-1">
      <Table>
        <TableHeader>
          <TableRow>
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
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                {total === 0 ? '没有匹配结果。可试 ext:mp4 或 parent:下载' : '没有可见结果'}
              </TableCell>
            </TableRow>
          ) : (
            hits.map((hit) => (
              <TableRow
                key={hit.entryId}
                data-state={selected?.entryId === hit.entryId ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={() => onSelect(hit)}
                onDoubleClick={() => onReveal(hit)}
              >
                <TableCell className="font-medium">{hit.name}</TableCell>
                <TableCell>{kindLabel(hit.kind)}</TableCell>
                <TableCell>{hit.kind === 'dir' ? '-' : formatBytes(hit.size)}</TableCell>
                <TableCell>{formatTime(hit.mtime)}</TableCell>
                <TableCell className="max-w-[28rem] truncate text-muted-foreground" title={hit.path}>
                  {hit.path}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ScrollArea>
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
  onOpen,
  onReveal,
}: {
  hit: SearchHit | null
  preview: FilePreview | null
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
        <Button variant="outline" className="flex-1" disabled={!hit} onClick={onReveal}>
          <FolderOpen className="h-3.5 w-3.5" />
          定位
        </Button>
        <Button className="flex-1" disabled={!hit} onClick={onOpen}>
          <ExternalLink className="h-3.5 w-3.5" />
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
  busy,
  onSelectRuleSet,
  onCollision,
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
  busy: boolean
  onSelectRuleSet: (id: string) => void
  onCollision: (value: Collision) => void
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <NativeSelect value={selectedRuleSet?.id ?? ''} onChange={(event) => onSelectRuleSet(event.target.value)}>
          {ruleSets.map((set) => (
            <option key={set.id} value={set.id}>
              {set.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={collision} onChange={(event) => onCollision(event.target.value as Collision)}>
          {(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => (
            <option key={key} value={key}>
              {COLLISION_LABEL[key]}
            </option>
          ))}
        </NativeSelect>
        <Button onClick={onPreview} disabled={!selectedRuleSet || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
          Dry-run
        </Button>
        <Button onClick={onExecute} disabled={busyExecute || selectedCount === 0}>
          {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          执行选中
        </Button>
        {lastExecuteJobId ? (
          <Button variant="outline" onClick={onRollback} disabled={busyRollback}>
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
              <div className="text-sm font-medium">{selectedRuleSet.name}</div>
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
        <PlanTable plan={plan} selectedOps={selectedOps} onToggleOp={onToggleOp} />
      </div>
    </div>
  )
}

function RenamePane({
  template,
  collision,
  busy,
  onTemplate,
  onCollision,
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
  busy: boolean
  onTemplate: (value: string) => void
  onCollision: (value: Collision) => void
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b px-3 py-2">
        <Input value={template} onChange={(event) => onTemplate(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect value={collision} onChange={(event) => onCollision(event.target.value as Collision)}>
            {(Object.keys(COLLISION_LABEL) as Collision[]).map((key) => (
              <option key={key} value={key}>
                {COLLISION_LABEL[key]}
              </option>
            ))}
          </NativeSelect>
          <Button onClick={onPreview} disabled={busy || !template.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            预览改名
          </Button>
          <Button onClick={onExecute} disabled={busyExecute || selectedCount === 0}>
            {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            执行选中
          </Button>
          {lastExecuteJobId ? (
            <Button variant="outline" onClick={onRollback} disabled={busyRollback}>
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
      <PlanTable plan={plan} selectedOps={selectedOps} onToggleOp={onToggleOp} />
    </div>
  )
}

function DuplicatePane({
  groups,
  keepStrategy,
  busy,
  onKeepStrategy,
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
  busy: boolean
  onKeepStrategy: (value: KeepStrategy) => void
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <NativeSelect value={keepStrategy} onChange={(event) => onKeepStrategy(event.target.value as KeepStrategy)}>
          {(Object.keys(KEEP_LABEL) as KeepStrategy[]).map((key) => (
            <option key={key} value={key}>
              {KEEP_LABEL[key]}
            </option>
          ))}
        </NativeSelect>
        <Button onClick={onAnalyze} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          分析重复
        </Button>
        <Button onClick={onExecute} disabled={busyExecute || selectedCount === 0}>
          {busyExecute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          隔离选中
        </Button>
        {lastExecuteJobId ? (
          <Button variant="outline" onClick={onRollback} disabled={busyRollback}>
            {busyRollback ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            回滚
          </Button>
        ) : null}
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
        <PlanTable plan={plan} selectedOps={selectedOps} onToggleOp={onToggleOp} />
      </div>
    </div>
  )
}

function PlanTable({
  plan,
  selectedOps,
  onToggleOp,
}: {
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
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
  onCheckedChange,
}: {
  op: PlanOp
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <TableRow>
      <TableCell>
        <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
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
