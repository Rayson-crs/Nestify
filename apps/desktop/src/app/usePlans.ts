import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import {
  callNestify,
  getNestifyApi,
  type ChangePlan,
  type Collision,
  type DuplicateGroup,
  type DuplicateHashStrategy,
  type DuplicateScope,
  type KeepStrategy,
  type LibrarySummary,
  type RuleSetSummary,
  type SearchHit,
} from '@/lib/ipc'
import { isWithinDirectory } from '@/lib/path-crumbs'
import { canRollbackJob, errorMessage } from '@/lib/labels'
import { formatBytes } from '@/lib/utils'
import type { PlanSource, WorkspaceTab } from '@/lib/workspace'
import type { ConfirmationRequest } from '@/app/types'
import { useRuleSetActions } from '@/app/useRuleSetActions'
import type { JobRecord } from '@nestify/shared'

type PlanState = {
  plan: ChangePlan
  source: PlanSource
  fingerprint: string
}

export function usePlans(options: {
  libraries: LibrarySummary[]
  selectedLibrary: LibrarySummary | null
  selectedLibraryId: string | null
  selectedEntryIds: string[]
  query: string
  tab: WorkspaceTab
  setTab: (tab: WorkspaceTab) => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  requestConfirmation: (request: ConfirmationRequest) => void
  runSearch: (text: string, libraryId?: string | null, offset?: number) => Promise<void>
  loadJobs: (options?: { preferJobId?: string }) => Promise<void>
  loadJobOps: (jobId: string) => Promise<void>
}) {
  const {
    libraries,
    selectedLibrary,
    selectedLibraryId,
    selectedEntryIds,
    query,
    tab,
    setTab,
    setError,
    setNotice,
    requestConfirmation,
    runSearch,
    loadJobs,
    loadJobOps,
  } = options

  const [ruleSets, setRuleSets] = useState<RuleSetSummary[]>([])
  const [selectedRuleSetId, setSelectedRuleSetId] = useState('')
  const [ruleActionBusy, setRuleActionBusy] = useState<string | null>(null)
  const [ruleDraft, setRuleDraft] = useState<RuleSetEditorValue>({
    name: '',
    description: '',
    dryRunDefault: true,
    collision: 'suffix',
    rules: [],
  })
  const [collision, setCollision] = useState<Collision>('suffix')
  const [template, setTemplate] = useState("{parent}_{name.regex_replace('\\\\[.*?\\\\]', '').trim()}{ext}")
  const [planState, setPlanState] = useState<PlanState | null>(null)
  const [selectedOps, setSelectedOps] = useState<Record<number, boolean>>({})
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [keepStrategy, setKeepStrategy] = useState<KeepStrategy>('newest')
  const [duplicateHashStrategy, setDuplicateHashStrategy] = useState<DuplicateHashStrategy>('duplicate-candidate-only')
  const [duplicateScope, setDuplicateScope] = useState<DuplicateScope>('library')
  const [duplicateDirectory, setDuplicateDirectory] = useState('')
  /** 重复向导当前步骤：pick=选目录 filter=配规则+开始 analyzing=分析中 result=看结果。 */
  const [duplicateStep, setDuplicateStep] = useState<'pick' | 'filter' | 'analyzing' | 'result'>('pick')
  /** 输入助手维护的重复匹配表达式（搜索语法：kind: image AND size:>1MB …）。 */
  const [duplicateFilter, setDuplicateFilter] = useState('')
  /** 选目录后加载的目录内容预览（前 N 项，帮助用户决定规则）。 */
  const [duplicatePreview, setDuplicatePreview] = useState<SearchHit[] | null>(null)
  const [duplicatePreviewTotal, setDuplicatePreviewTotal] = useState(0)
  /** 预览排序：字段 + 方向（三态：asc → desc → 默认，与搜索表格一致）。 */
  const [duplicatePreviewSort, setDuplicatePreviewSort] = useState<'name' | 'size' | 'mtime'>('name')
  const [duplicatePreviewSortDirection, setDuplicatePreviewSortDirection] = useState<'asc' | 'desc' | null>(null)
  const [lastExecuteJobId, setLastExecuteJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** 结果页左侧分组列表当前选中的组（null = 全部）。 */
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  /** 结果页左列表宽度（px，可拖动）。 */
  const [groupsPaneWidth, setGroupsPaneWidth] = useState(240)
  /** 规则即时预览：按当前查重范围规则过滤后的目录内容（null = 与全量预览一致，未单独计算）。 */
  const [duplicateFilterPreview, setDuplicateFilterPreview] = useState<SearchHit[] | null>(null)
  /** 即时预览防抖句柄。 */
  const filterPreviewTimer = useRef<number | null>(null)

  const selectedRuleSet = ruleSets.find((item) => item.id === selectedRuleSetId) ?? null
  const selectionKey = selectedEntryIds.join(',')
  const planFingerprint = useMemo(() => {
    const common = [selectedLibraryId ?? '', duplicateScope, duplicateDirectory.trim(), selectionKey]
    if (tab === 'rules') return [...common, selectedRuleSetId, collision, JSON.stringify(ruleDraft)].join('\n')
    if (tab === 'rename') return [...common, template, collision].join('\n')
    if (tab === 'duplicates') return [...common, keepStrategy, duplicateHashStrategy].join('\n')
    return ''
  }, [
    collision,
    duplicateDirectory,
    duplicateHashStrategy,
    duplicateScope,
    keepStrategy,
    ruleDraft,
    selectedLibraryId,
    selectedRuleSetId,
    selectionKey,
    tab,
    template,
  ])

  const loadRules = useCallback(async (preferId?: string) => {
    const { ruleSets: next } = await callNestify((api) => api.rulesList())
    const validSets = next.filter((set) => Boolean(set?.id))
    setRuleSets(validSets)
    setSelectedRuleSetId((current) => {
      const preferred = preferId ?? current
      return preferred && validSets.some((set) => set.id === preferred) ? preferred : validSets[0]?.id || ''
    })
    const firstCollision = validSets[0]?.collision
    if (firstCollision === 'suffix' || firstCollision === 'skip' || firstCollision === 'overwrite') {
      setCollision((current) => current || firstCollision)
    }
  }, [])

  useEffect(() => {
    if (!selectedRuleSet) return
    setRuleDraft({
      name: selectedRuleSet.name,
      description: selectedRuleSet.description ?? '',
      dryRunDefault: selectedRuleSet.dryRunDefault,
      collision: selectedRuleSet.collision,
      rules: selectedRuleSet.rules,
    })
  }, [selectedRuleSet?.id, selectedRuleSet?.updatedAt])

  useEffect(() => {
    setPlanState((current) =>
      current && (current.source !== tab || current.fingerprint !== planFingerprint) ? null : current,
    )
  }, [planFingerprint, tab])

  useEffect(() => {
    setDuplicateGroups([])
  }, [planFingerprint])

  useEffect(() => {
    if (!planState) setSelectedOps({})
  }, [planState])

  const activePlan = planState?.source === tab ? planState.plan : null
  const selectedCount = useMemo(() => Object.values(selectedOps).filter(Boolean).length, [selectedOps])
  const directoryForDuplicates = duplicateDirectory.trim()
  /** 分析前按目录自动匹配资料库：目录在某个库的 roots 内（或就是某个 root）即命中。 */
  const libraryForDirectory = useMemo(() => {
    if (!directoryForDuplicates) return null
    return (
      libraries.find((library) => library.roots.some((root) => isWithinDirectory(directoryForDuplicates, root))) ?? null
    )
  }, [libraries, directoryForDuplicates])
  const canPreviewScope =
    directoryForDuplicates.length > 0 &&
    libraryForDirectory !== null &&
    (keepStrategy !== 'preferred_dir' || duplicateDirectory.trim().length > 0)
  /** 重复分析固定目录模式：置灰原因（人话）；null = 可以分析。 */
  const analyzeBlockReason = (() => {
    if (libraries.length === 0) return '还没有任何资料库，先去左侧「资料库」里添加一个'
    if (directoryForDuplicates.length === 0) return '先在上面填入或选择要分析的目录'
    if (libraryForDirectory === null)
      return `目录不在任何资料库范围内（现有资料库：${libraries.map((library) => library.name).join('、')}），请把该目录加入某个资料库后再分析`
    return null
  })()

  const applyPlan = (next: ChangePlan, source: PlanSource) => {
    setPlanState({ plan: next, source, fingerprint: planFingerprint })
    setLastExecuteJobId(null)
    const map: Record<number, boolean> = {}
    next.ops.forEach((op, index) => {
      map[index] = op.selected && op.risk !== 'overwrite'
    })
    setSelectedOps(map)
  }

  const {
    handleCreateRuleSet,
    handleUpdateRuleSet,
    handleRefreshRuleSet,
    handleToggleRuleSet,
    handleRuleSetPriority,
    handleCloneRuleSet,
    handleDeleteRuleSet,
    handleExportRuleSet,
    handleImportRuleSet,
  } = useRuleSetActions({
    selectedRuleSet,
    ruleDraft,
    setError,
    setNotice,
    setRuleSets,
    setRuleActionBusy,
    loadRules,
    requestConfirmation,
  })

  const handleSendSelectionTo = (target: Exclude<WorkspaceTab, 'search' | 'jobs'>) => {
    const entryIds = selectedEntryIds.length > 0 ? selectedEntryIds : []
    if (entryIds.length === 0 && target !== 'duplicates') {
      setError('请先选择搜索结果')
      return
    }
    setDuplicateScope('selection')
    setTab(target)
    setNotice(`已加入 ${entryIds.length} 条记录`)
  }

  const handleRulesPreview = async () => {
    if (!selectedLibrary || !selectedRuleSetId || !canPreviewScope) return
    setBusy('rules')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.rulesPreview({
          libraryId: selectedLibrary.id,
          ruleSetId: selectedRuleSetId,
          scope: duplicateScope,
          entryIds: duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory: duplicateScope === 'directory' ? duplicateDirectory.trim() || undefined : undefined,
          collision,
        }),
      )
      applyPlan(next, tab === 'rename' ? 'rename' : 'rules')
      setNotice(`Dry-run 完成，${next.ops.length} 条变更`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleRenamePreview = async () => {
    if (!selectedLibrary || !canPreviewScope) return
    setBusy('rename')
    setError(null)
    try {
      const { plan: next } = await callNestify((api) =>
        api.renamePreview({
          libraryId: selectedLibrary.id,
          template,
          scope: duplicateScope,
          entryIds: duplicateScope === 'selection' ? selectedEntryIds : undefined,
          directory: duplicateScope === 'directory' ? duplicateDirectory.trim() || undefined : undefined,
          collision,
        }),
      )
      applyPlan(next, 'rename')
      setNotice(`改名预览完成，${next.ops.length} 条变更`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  /**
   * 结果页切换保留策略：不重新读盘哈希（那是最贵的步骤），直接按新策略
   * 重排各组 keep 标记并重建隔离计划。哈希分组结果保持不变。
   */
  const handleDuplicateKeepStrategyChange = (value: KeepStrategy) => {
    setKeepStrategy(value)
    if (duplicateGroups.length === 0) return
    const nextGroups = duplicateGroups.map((group) => {
      const sorted = [...group.files].sort((a, b) => compareKeepHit(a, b, value))
      return {
        ...group,
        files: sorted.map((file, index) => ({ ...file, keep: index === 0 })),
        wastedBytes: sorted[0] ? sorted[0].size * (sorted.length - 1) : group.wastedBytes,
      }
    })
    setDuplicateGroups(nextGroups)
    // 按新 losers 重建隔离计划：保留原计划中仍属于"非 keep"文件的 op，其余剔除。
    if (planState?.source === 'duplicates' && activePlan && activePlan.ops.length > 0) {
      const loserPaths = new Set(
        nextGroups.flatMap((group) => group.files.filter((file) => !file.keep).map((file) => file.path)),
      )
      const nextOps = activePlan.ops.filter((op) => loserPaths.has(op.from))
      setPlanState({ ...planState, plan: { ...activePlan, ops: nextOps } })
      const map: Record<number, boolean> = {}
      nextOps.forEach((op, index) => {
        map[index] = op.selected && op.risk !== 'overwrite'
      })
      setSelectedOps(map)
    }
  }

  /** 按保留策略比较两个重复命中（返回负数表示 a 优先保留）。 */
  const compareKeepHit = (a: DuplicateGroup['files'][number], b: DuplicateGroup['files'][number], strategy: KeepStrategy): number => {
    switch (strategy) {
      case 'newest':
        return b.mtime - a.mtime
      case 'oldest':
        return a.mtime - b.mtime
      case 'shortest_path':
        return a.path.length - b.path.length
      case 'name_quality':
        return b.path.length - a.path.length
      default:
        return 0
    }
  }

  const handleAnalyzeDuplicates = async () => {
    // 置灰原因三选一；按钮可点时 libraryForDirectory 必非空。
    if (libraries.length === 0) {
      setError('还没有任何资料库，先去左侧「资料库」里添加一个')
      setNotice(null)
      return
    }
    if (!directoryForDuplicates) {
      setError('请先填入或选择要分析的目录')
      setNotice(null)
      return
    }
    if (!libraryForDirectory) {
      setError('该目录不在任何资料库范围内，请先把目录加入某个资料库再分析')
      setNotice(null)
      return
    }
    void getNestifyApi()?.logEvent?.('renderer.duplicates.request', {
      libraryId: libraryForDirectory.id,
      scope: 'directory',
      directory: directoryForDuplicates,
      filter: duplicateFilter.trim() || null,
      keepStrategy,
    })
    setBusy('duplicates')
    setDuplicateStep('analyzing')
    setError(null)
    try {
      const next = await callNestify((api) =>
        api.duplicatesAnalyze({
          libraryId: libraryForDirectory.id,
          scope: 'directory',
          directory: directoryForDuplicates,
          filter: duplicateFilter.trim() || undefined,
          hashStrategy: duplicateHashStrategy,
          keepStrategy,
          dispose: 'delete',
        }),
      )
      setDuplicateGroups(next.groups)
      applyPlan(next.plan, 'duplicates')
      setActiveGroupId(next.groups.length > 0 ? next.groups[0]!.id : null)
      setDuplicateStep('result')
      setNotice(
        `重复分析完成（资料库「${libraryForDirectory.name}」），${next.groups.length} 组 / 可释放 ${formatBytes(
          next.groups.reduce((sum, group) => sum + group.wastedBytes, 0),
        )}`,
      )
    } catch (err) {
      setError(errorMessage(err))
      setDuplicateStep('filter')
    } finally {
      setBusy(null)
    }
  }

  /** 加载目录内容预览（带排序）。 */
  const loadDuplicatePreview = useCallback(
    async (directory: string, sort?: { field: 'name' | 'size' | 'mtime'; direction: 'asc' | 'desc' }) => {
      const library = libraries.find((item) => item.roots.some((root) => isWithinDirectory(directory, root)))
      if (!library) {
        setDuplicatePreview(null)
        setDuplicatePreviewTotal(0)
        return
      }
      try {
        const next = await callNestify((api) =>
          api.directoryChildren({ libraryId: library.id, directory, limit: 200, sort }),
        )
        setDuplicatePreview(next.result.hits)
        setDuplicatePreviewTotal(next.result.total)
      } catch {
        setDuplicatePreview(null)
        setDuplicatePreviewTotal(0)
      }
    },
    [libraries],
  )

  /** 预览排序切换：同列三态 asc→desc→默认；异列换列重置。 */
  const handleDuplicatePreviewSort = (field: 'name' | 'size' | 'mtime') => {
    const nextDirection: 'asc' | 'desc' | null =
      duplicatePreviewSort === field
        ? duplicatePreviewSortDirection === 'asc'
          ? 'desc'
          : duplicatePreviewSortDirection === 'desc'
            ? null
            : 'asc'
        : 'asc'
    setDuplicatePreviewSort(field)
    setDuplicatePreviewSortDirection(nextDirection)
    if (duplicateDirectory.trim()) {
      void loadDuplicatePreview(duplicateDirectory.trim(), nextDirection ? { field, direction: nextDirection } : undefined)
    }
  }

  /** 规则即时预览：按"目录 + 查重规则"执行一次搜索（防抖 300ms），让用户看到规则筛掉了什么。 */
  const runDuplicateFilterPreview = useCallback(
    async (expression: string) => {
      const directory = duplicateDirectory.trim()
      const library = libraries.find((item) => item.roots.some((root) => isWithinDirectory(directory, root)))
      if (!expression.trim() || !directory || !library) {
        setDuplicateFilterPreview(null)
        return
      }
      try {
        const next = await callNestify((api) =>
          api.searchQuery({
            libraryId: library.id,
            text: expression.trim(),
            scope: 'directory',
            directory,
            limit: 200,
          }),
        )
        setDuplicateFilterPreview(next.result.hits)
      } catch {
        // 表达式非法或搜索失败：不阻塞输入，仅不展示即时预览。
        setDuplicateFilterPreview(null)
      }
    },
    [duplicateDirectory, libraries],
  )

  /** 规则输入变化：重置选中组、防抖触发即时预览。 */
  const handleDuplicateFilterChange = (value: string) => {
    setDuplicateFilter(value)
    setActiveGroupId(null)
    if (filterPreviewTimer.current) window.clearTimeout(filterPreviewTimer.current)
    filterPreviewTimer.current = window.setTimeout(() => {
      void runDuplicateFilterPreview(value)
    }, 300)
  }

  /** 双击预览里的目录行 → 把查重目录切进去（目录钻取）。 */
  const handleDuplicateEnterDirectory = (hit: SearchHit) => {
    if (hit.kind !== 'dir' || !hit.path) return
    setDuplicateDirectory(hit.path)
    setDuplicateGroups([])
    void loadDuplicatePreview(hit.path)
  }

  /** 预览返回上一级目录。 */
  const handleDuplicateGoParent = () => {
    const current = duplicateDirectory.trim()
    if (!current) return
    const normalized = current.replace(/[\\/]+$/, '')
    const parent = normalized.replace(/[\\/][^\\/]+$/, '')
    if (!parent || parent === normalized || !/^[A-Za-z]:/i.test(parent)) return
    setDuplicateDirectory(parent)
    setDuplicateGroups([])
    void loadDuplicatePreview(parent)
  }

  /** 结果页：组内点击某文件切换 保留↔删除（每组必须保留至少一份；选中组为 null 时先选中该组）。 */
  const handleDuplicateToggleKeep = (groupId: string, entryId: string) => {
    setActiveGroupId(groupId)
    setDuplicateGroups((current) =>
      current.map((group) => {
        if (group.id !== groupId) return group
        const target = group.files.find((file) => file.entryId === entryId)
        if (!target) return group
        const keeping = group.files.filter((file) => file.keep)
        // 已是唯一保留的一份 → 不允许取消（每组至少保留一份）。
        if (target.keep && keeping.length <= 1) return group
        return {
          ...group,
          files: group.files.map((file) => (file.entryId === entryId ? { ...file, keep: !file.keep } : file)),
        }
      }),
    )
    // 同步计划勾选：keep=true 的文件对应 op 取消勾选，keep=false 的勾上（执行时删除）。
    if (planState?.source === 'duplicates' && activePlan) {
      const group = duplicateGroups.find((item) => item.id === groupId)
      if (!group) return
      const target = group.files.find((file) => file.entryId === entryId)
      if (!target || (target.keep && group.files.filter((file) => file.keep).length <= 1)) return
      const nextKeep = !target.keep
      setSelectedOps((current) => {
        const map = { ...current }
        activePlan.ops.forEach((op, index) => {
          if (op.entryId === entryId) map[index] = !nextKeep
        })
        return map
      })
    }
  }

  /** 结果页：整组按保留策略重置勾选。 */
  const handleDuplicateResetGroup = (groupId: string) => {
    setActiveGroupId(groupId)
    const group = duplicateGroups.find((item) => item.id === groupId)
    if (!group || !activePlan || planState?.source !== 'duplicates') return
    // 按当前 keepStrategy 重新计算 keep：与 handleDuplicateKeepStrategyChange 同一套比较器。
    const sorted = [...group.files].sort((a, b) => compareKeepHit(a, b, keepStrategy))
    const keepId = sorted[0]?.entryId
    setDuplicateGroups((current) =>
      current.map((item) =>
        item.id === groupId
          ? { ...item, files: item.files.map((file) => ({ ...file, keep: file.entryId === keepId })) }
          : item,
      ),
    )
    setSelectedOps((current) => {
      const map = { ...current }
      activePlan.ops.forEach((op, index) => {
        if (op.entryId && group.files.some((file) => file.entryId === op.entryId)) {
          map[index] = op.entryId !== keepId
        }
      })
      return map
    })
  }

  /** 系统目录选择对话框 → 填入目录、加载内容预览、进入规则配置步骤。 */
  const handlePickDuplicateDirectory = async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked?.path) return
      setDuplicateDirectory(picked.path)
      setDuplicateGroups([])
      setDuplicateStep('filter')
      setBusy('duplicates')
      try {
        await loadDuplicatePreview(picked.path)
      } finally {
        setBusy(null)
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** 目录变更（手输/粘贴）时重置向导到第一步。 */
  const handleDuplicateDirectoryChange = (value: string) => {
    setDuplicateDirectory(value)
    setDuplicateGroups([])
    setDuplicatePreview(null)
    setDuplicatePreviewTotal(0)
    setDuplicateStep(value.trim() ? 'filter' : 'pick')
  }

  const performExecutePlan = async () => {
    // 重复分析固定目录模式：执行计划用目录匹配到的库（左侧选"全部资料库"也能执行）。
    const executeLibrary = planState?.source === 'duplicates' ? libraryForDirectory : selectedLibrary
    if (!executeLibrary || !activePlan) return
    const selected = activePlan.ops.map((op, index) => (selectedOps[index] ? index : -1)).filter((index) => index >= 0)
    setBusy('execute')
    setError(null)
    try {
      const result = await callNestify((api) =>
        api.planExecute({ libraryId: executeLibrary.id, plan: activePlan, selectedOps: selected }),
      )
      setLastExecuteJobId(result.jobId)
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`执行存在失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      } else {
        setPlanState(null)
      }
      setNotice(`执行结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await loadJobOps(result.jobId)
      await runSearch(query, selectedLibraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleExecutePlan = () => {
    if (!selectedLibraryId || !activePlan) return
    requestConfirmation({
      title: '执行变更计划',
      description: `将执行 ${selectedCount} 个已勾选操作。此操作会修改磁盘文件，请确认预览内容。`,
      confirmLabel: '执行',
      action: performExecutePlan,
    })
  }

  const handleRollback = async () => {
    if (!lastExecuteJobId) return
    setBusy('rollback')
    setError(null)
    try {
      const result = await callNestify((api) => api.planRollback({ jobId: lastExecuteJobId }))
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`回滚存在失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      } else {
        setLastExecuteJobId(null)
        setPlanState(null)
      }
      setNotice(`回滚结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
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
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`任务 ${job.id.slice(0, 8)} 回滚失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      }
      setNotice(`任务 ${job.id.slice(0, 8)} 回滚结束：成功 ${result.ok} / 跳过 ${result.skipped} / 失败 ${result.failed}`)
      await loadJobs({ preferJobId: result.jobId })
      await loadJobOps(result.jobId)
      if (job.libraryId) await runSearch(query, job.libraryId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return {
    ruleSets,
    selectedRuleSetId,
    setSelectedRuleSetId,
    selectedRuleSet,
    ruleActionBusy,
    ruleDraft,
    setRuleDraft,
    collision,
    setCollision,
    template,
    setTemplate,
    selectedOps,
    setSelectedOps,
    duplicateGroups,
    keepStrategy,
    setKeepStrategy,
    duplicateHashStrategy,
    setDuplicateHashStrategy,
    duplicateScope,
    setDuplicateScope,
    duplicateDirectory,
    setDuplicateDirectory,
    handlePickDuplicateDirectory,
    lastExecuteJobId,
    planBusy: busy,
    loadRules,
    handleCreateRuleSet,
    handleUpdateRuleSet,
    handleRefreshRuleSet,
    handleToggleRuleSet,
    handleRuleSetPriority,
    handleCloneRuleSet,
    handleDeleteRuleSet,
    handleExportRuleSet,
    handleImportRuleSet,
    handleSendSelectionTo,
    activePlan,
    handleRulesPreview,
    handleRenamePreview,
    handleAnalyzeDuplicates,
    handleExecutePlan,
    handleRollback,
    handleJobRollback,
    selectedCount,
    canPreviewScope,
    analyzeBlockReason,
    libraryForDirectory,
    duplicateStep,
    setDuplicateStep,
    duplicateFilter,
    setDuplicateFilter,
    handleDuplicateFilterChange,
    duplicateFilterPreview,
    activeGroupId,
    setActiveGroupId,
    groupsPaneWidth,
    setGroupsPaneWidth,
    handleDuplicateToggleKeep,
    handleDuplicateResetGroup,
    duplicatePreview,
    duplicatePreviewTotal,
    duplicatePreviewSort,
    duplicatePreviewSortDirection,
    handleDuplicatePreviewSort,
    handleDuplicateEnterDirectory,
    handleDuplicateGoParent,
    handleDuplicateDirectoryChange,
    handleDuplicateKeepStrategyChange,
  }
}
