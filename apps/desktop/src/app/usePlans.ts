import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import {
  callNestify,
  getNestifyApi,
  type ChangePlan,
  type Collision,
  type DuplicateGroup,
  type DuplicateProgress,
  type DuplicateHashStrategy,
  type DuplicateScope,
  type KeepStrategy,
  type LibrarySummary,
  type OrganizePreviewPayload,
  type OrganizeRuleInput,
  type OrganizeSnapshotPayload,
  type ExecutionProgress,
  type RuleSetSummary,
  type SearchHit,
} from '@/lib/ipc'
import { isWithinDirectory, matchingRootPath, parentDirectoryPath } from '@/lib/path-crumbs'
import { canRollbackJob, errorMessage } from '@/lib/labels'
import { formatBytes } from '@/lib/utils'
import type { PlanSource, WorkspaceTab } from '@/lib/workspace'
import type { ConfirmationRequest } from '@/app/types'
import type { OrganizeStep } from '@/app/types'
import { useRuleSetActions } from '@/app/useRuleSetActions'
import { createRenameRuleGroup, type RenameRuleGroup } from '@/components/rules/RenameGroupsEditor'
import type { JobRecord } from '@nestify/shared'
import { fetchAllDirectoryChildren } from '@/lib/directory-children'

type PlanState = {
  plan: ChangePlan
  source: PlanSource
  fingerprint: string
}

const DEFAULT_ORGANIZE_RULES: OrganizeRuleInput[] = [
  {
    id: 'organize-images',
    name: '图片归类',
    enabled: true,
    priority: 10,
    target: 'files',
    scope: 'all',
    filter: 'kind:image',
    continueMatching: false,
    action: 'move',
    template: '图片/{name}{ext}',
    reason: '按图片扩展名移动到图片目录',
  },
  {
    id: 'organize-videos',
    name: '视频归类',
    enabled: true,
    priority: 20,
    target: 'files',
    scope: 'all',
    filter: 'kind:video',
    continueMatching: false,
    action: 'move',
    template: '视频/{name}{ext}',
    reason: '按视频扩展名移动到视频目录',
  },
  {
    id: 'organize-documents',
    name: '文档归类',
    enabled: true,
    priority: 30,
    target: 'files',
    scope: 'all',
    filter: 'kind:document',
    continueMatching: false,
    action: 'move',
    template: '文档/{name}{ext}',
    reason: '按文档扩展名移动到文档目录',
  },
]

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
  const [organizeDirectory, setOrganizeDirectory] = useState('')
  const [organizeDirectoryId, setOrganizeDirectoryId] = useState<string | null>(null)
  const [organizeStep, setOrganizeStep] = useState<OrganizeStep>('pick')
  const [organizeFilter, setOrganizeFilter] = useState('')
  const [organizeFilterPreview, setOrganizeFilterPreview] = useState<SearchHit[] | null>(null)
  const [organizeDirectoryPreview, setOrganizeDirectoryPreview] = useState<SearchHit[] | null>(null)
  const [organizeDirectoryPreviewTotal, setOrganizeDirectoryPreviewTotal] = useState(0)
  const [organizeDirectoryPreviewSort, setOrganizeDirectoryPreviewSort] = useState<'name' | 'size' | 'mtime'>('name')
  const [organizeDirectoryPreviewSortDirection, setOrganizeDirectoryPreviewSortDirection] = useState<'asc' | 'desc' | null>(null)
  const [organizeRuleDraft, setOrganizeRuleDraft] = useState<OrganizeRuleInput[]>(() => structuredClone(DEFAULT_ORGANIZE_RULES))
  const [organizePreview, setOrganizePreview] = useState<OrganizePreviewPayload | null>(null)
  const [organizeSnapshot, setOrganizeSnapshot] = useState<OrganizeSnapshotPayload | null>(null)
  const [renameGroups, setRenameGroups] = useState<RenameRuleGroup[]>(() => [
    createRenameRuleGroup({
      template: "{parent}_{name.regex_replace('\\\\[.*?\\\\]', '').trim()}{ext}",
    }),
  ])
  const template = renameGroups[0]?.template ?? ''
  const [renameRuleSelected, setRenameRuleSelected] = useState<Record<string, boolean>>({})
  const [planState, setPlanState] = useState<PlanState | null>(null)
  const [selectedOps, setSelectedOps] = useState<Record<number, boolean>>({})
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [keepStrategy, setKeepStrategy] = useState<KeepStrategy>('newest')
  const [duplicateHashStrategy, setDuplicateHashStrategy] = useState<DuplicateHashStrategy>('duplicate-candidate-only')
  const [duplicateScope, setDuplicateScope] = useState<DuplicateScope>('library')
  const [duplicateDirectory, setDuplicateDirectory] = useState('')
  const [duplicateDirectoryId, setDuplicateDirectoryId] = useState<string | null>(null)
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
  const [executeProgress, setExecuteProgress] = useState<ExecutionProgress | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** 结果页左侧分组列表当前选中的组（null = 全部）。 */
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  /** 结果页左列表宽度（px，可拖动）。 */
  const [groupsPaneWidth, setGroupsPaneWidth] = useState(240)
  /** 规则即时预览：按当前查重范围规则过滤后的目录内容（null = 与全量预览一致，未单独计算）。 */
  const [duplicateFilterPreview, setDuplicateFilterPreview] = useState<SearchHit[] | null>(null)
  const [duplicateAnalysisProgress, setDuplicateAnalysisProgress] = useState<DuplicateProgress | null>(null)
  /** 即时预览防抖句柄。 */
  const filterPreviewTimer = useRef<number | null>(null)
  const [renameDirectory, setRenameDirectory] = useState('')
  const [renameDirectoryId, setRenameDirectoryId] = useState<string | null>(null)
  const [renameStep, setRenameStep] = useState<'pick' | 'filter' | 'rules' | 'result'>('pick')
  const [renameFilter, setRenameFilter] = useState('')
  const [renamePreview, setRenamePreview] = useState<SearchHit[] | null>(null)
  const [renamePreviewTotal, setRenamePreviewTotal] = useState(0)
  const [renamePreviewSort, setRenamePreviewSort] = useState<'name' | 'size' | 'mtime'>('name')
  const [renamePreviewSortDirection, setRenamePreviewSortDirection] = useState<'asc' | 'desc' | null>(null)
  const [renameFilterPreview, setRenameFilterPreview] = useState<SearchHit[] | null>(null)
  const renameFilterPreviewTimer = useRef<number | null>(null)
  const renamePreviewRequestId = useRef(0)
  const [renamePreviewBusy, setRenamePreviewBusy] = useState(false)

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onPlanExecutionProgress) return
    return api.onPlanExecutionProgress((progress) => setExecuteProgress(progress))
  }, [])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onDuplicateAnalysisProgress) return
    return api.onDuplicateAnalysisProgress((progress) => setDuplicateAnalysisProgress(progress))
  }, [])

  const selectedRuleSet = ruleSets.find((item) => item.id === selectedRuleSetId) ?? null
  const selectionKey = selectedEntryIds.join(',')
  const duplicateFingerprint = useMemo(
    () =>
      [
        duplicateDirectory.trim(),
        duplicateFilter.trim(),
        duplicateHashStrategy,
      ].join('\n'),
    [duplicateDirectory, duplicateFilter, duplicateHashStrategy],
  )
  const planFingerprint = useMemo(() => {
    const common = [selectedLibraryId ?? '', duplicateScope, duplicateDirectory.trim(), selectionKey]
    if (tab === 'rules') return [...common, selectedRuleSetId, collision, JSON.stringify(ruleDraft)].join('\n')
    if (tab === 'rename') {
      return [
        renameDirectory.trim(),
        renameFilter.trim(),
        JSON.stringify(renameGroups.map((group) => ({ filter: group.filter, template: group.template }))),
        collision,
      ].join('\n')
    }
    if (tab === 'duplicates') return duplicateFingerprint
    if (tab === 'organize') return [organizeDirectory.trim(), organizeFilter.trim(), JSON.stringify(organizeRuleDraft), collision].join('\n')
    return ''
  }, [
    collision,
    duplicateDirectory,
    duplicateHashStrategy,
    duplicateScope,
    keepStrategy,
    organizeDirectory,
    organizeFilter,
    organizeRuleDraft,
    renameDirectory,
    renameFilter,
    renameGroups,
    ruleDraft,
    selectedLibraryId,
    selectedRuleSetId,
    selectionKey,
    tab,
    template,
    duplicateFingerprint,
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
      current && current.source === tab && current.fingerprint !== planFingerprint ? null : current,
    )
  }, [planFingerprint, tab])

  useEffect(() => {
    if (tab !== 'organize' || (organizeStep !== 'rules' && organizeStep !== 'result')) return
    if (organizeStep === 'result' && (!planState || planState.source !== 'organize')) setOrganizeStep('rules')
  }, [organizeStep, planState, tab])

  useEffect(() => {
    setDuplicateGroups([])
  }, [duplicateFingerprint])

  useEffect(() => {
    if (!planState) setSelectedOps({})
  }, [planState])

  const activePlan = planState?.source === tab ? planState.plan : null
  const selectedCount = useMemo(() => Object.values(selectedOps).filter(Boolean).length, [selectedOps])
  const directoryForDuplicates = duplicateDirectory.trim()
  const directoryForRename = renameDirectory.trim()
  /** 分析前按目录自动匹配资料库：目录在某个库的 roots 内（或就是某个 root）即命中。 */
  const libraryForDirectory = useMemo(() => {
    if (!directoryForDuplicates) return null
    return libraries.find((library) => matchingRootPath(directoryForDuplicates, library.roots)) ?? null
  }, [libraries, directoryForDuplicates])
  const libraryForRename = useMemo(() => {
    if (!directoryForRename) return null
    return libraries.find((library) => matchingRootPath(directoryForRename, library.roots)) ?? null
  }, [libraries, directoryForRename])
  const canPreviewScope =
    directoryForDuplicates.length > 0 &&
    libraryForDirectory !== null &&
    (keepStrategy !== 'preferred_dir' || duplicateDirectory.trim().length > 0)
  const canRenameScope = directoryForRename.length > 0 && libraryForRename !== null
  const canDuplicateGoParent = Boolean(
    parentDirectoryPath(directoryForDuplicates, libraryForDirectory ? matchingRootPath(directoryForDuplicates, libraryForDirectory.roots) : null),
  )
  const canRenameGoParent = Boolean(
    parentDirectoryPath(directoryForRename, libraryForRename ? matchingRootPath(directoryForRename, libraryForRename.roots) : null),
  )
  /** 重复分析固定目录模式：置灰原因（人话）；null = 可以分析。 */
  const analyzeBlockReason = (() => {
    if (libraries.length === 0) return '还没有任何资料库，先去左侧「资料库」里添加一个'
    if (directoryForDuplicates.length === 0) return '先在上面填入或选择要分析的目录'
    if (libraryForDirectory === null)
      return `目录不在任何资料库范围内（现有资料库：${libraries.map((library) => library.name).join('、')}），请把该目录加入某个资料库后再分析`
    return null
  })()
  const renameBlockReason = (() => {
    if (libraries.length === 0) return '还没有任何资料库，先去左侧「资料库」里添加一个'
    if (directoryForRename.length === 0) return '先在上面填入或选择要改名的目录'
    if (libraryForRename === null)
      return `目录不在任何资料库范围内（现有资料库：${libraries.map((library) => library.name).join('、')}），请把该目录加入某个资料库后再改名`
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

  const organizeDirectoryValue = organizeDirectory.trim()
  const libraryForOrganize = useMemo(() => {
    if (!organizeDirectoryValue) return null
    return libraries.find((library) => matchingRootPath(organizeDirectoryValue, library.roots)) ?? null
  }, [libraries, organizeDirectoryValue])
  const organizeCanPick = organizeDirectoryValue.length > 0 && libraryForOrganize !== null
  const organizeCanRules = organizeCanPick && organizeRuleDraft.some((rule) => {
    if (!rule.enabled || !rule.name.trim() || !rule.action) return false
    if (rule.action === 'delete_to_quarantine' || rule.action === 'flatten_dir') return true
    return Boolean(rule.template?.trim()) || Boolean(rule.steps?.some((step) => step.template?.trim()))
  })
  const organizeBlockReason = (() => {
    if (libraries.length === 0) return '还没有任何资料库，先去左侧「资料库」里添加一个'
    if (!organizeDirectoryValue) return '先在上面填入或选择要整理的文件夹'
    if (!libraryForOrganize) return '该文件夹不在任何资料库范围内，请先把它加入资料库后再整理'
    return null
  })()
  const canOrganizeGoParent = Boolean(
    parentDirectoryPath(organizeDirectoryValue, libraryForOrganize ? matchingRootPath(organizeDirectoryValue, libraryForOrganize.roots) : null),
  )

  const handlePickOrganizeDirectory = async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked?.path) return
      await handleUseOrganizeDirectory(picked.path)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const loadOrganizeDirectoryPreview = useCallback(
    async (directory: string, sort?: { field: 'name' | 'size' | 'mtime'; direction: 'asc' | 'desc' }, parentId?: string | null) => {
      const library = libraries.find((item) => matchingRootPath(directory, item.roots))
      if (!library) {
        setOrganizeDirectoryPreview(null)
        setOrganizeDirectoryPreviewTotal(0)
        return
      }
      try {
        const next = await fetchAllDirectoryChildren({
          libraryId: library.id,
          directory,
          parentId: parentId ?? undefined,
          sort,
        })
        setOrganizeDirectoryPreview(next.hits)
        setOrganizeDirectoryPreviewTotal(next.total)
      } catch {
        setOrganizeDirectoryPreview(null)
        setOrganizeDirectoryPreviewTotal(0)
      }
    },
    [libraries],
  )

  const runOrganizeFilterPreview = useCallback(async (expression: string) => {
    const directory = organizeDirectory.trim()
    const library = libraries.find((item) => matchingRootPath(directory, item.roots))
    if (!expression.trim() || !directory || !library) {
      setOrganizeFilterPreview(null)
      return
    }
    try {
      const next = await callNestify((api) => api.searchQuery({ libraryId: library.id, text: expression.trim(), scope: 'directory', directory, limit: 200 }))
      setOrganizeFilterPreview(next.result.hits)
    } catch {
      setOrganizeFilterPreview(null)
    }
  }, [libraries, organizeDirectory])

  const handleOrganizeFilterChange = (value: string) => {
    setOrganizeFilter(value)
    if (filterPreviewTimer.current) window.clearTimeout(filterPreviewTimer.current)
    filterPreviewTimer.current = window.setTimeout(() => void runOrganizeFilterPreview(value), 300)
  }

  const handleOrganizeDirectoryChange = (value: string) => {
    setOrganizeDirectory(value)
    setOrganizeDirectoryId(null)
    setOrganizeFilterPreview(null)
    setOrganizeDirectoryPreview(null)
    setOrganizeDirectoryPreviewTotal(0)
    setOrganizePreview(null)
    setPlanState(null)
    setOrganizeStep(value.trim() ? 'filter' : 'pick')
  }

  const handleUseOrganizeDirectory = async (path: string) => {
    setOrganizeDirectory(path)
    setOrganizeDirectoryId(null)
    setOrganizeFilterPreview(null)
    setOrganizePreview(null)
    setPlanState(null)
    setOrganizeStep(path.trim() ? 'filter' : 'pick')
    if (!path.trim()) {
      setOrganizeDirectoryPreview(null)
      setOrganizeDirectoryPreviewTotal(0)
      return
    }
    setBusy('organize')
    try {
      await loadOrganizeDirectoryPreview(path)
    } finally {
      setBusy(null)
    }
  }

  const handleOrganizePreviewSort = (field: 'name' | 'size' | 'mtime') => {
    const nextDirection: 'asc' | 'desc' | null = organizeDirectoryPreviewSort === field
      ? organizeDirectoryPreviewSortDirection === 'asc' ? 'desc' : organizeDirectoryPreviewSortDirection === 'desc' ? null : 'asc'
      : 'asc'
    setOrganizeDirectoryPreviewSort(field)
    setOrganizeDirectoryPreviewSortDirection(nextDirection)
    if (organizeDirectoryValue) void loadOrganizeDirectoryPreview(organizeDirectoryValue, nextDirection ? { field, direction: nextDirection } : undefined, organizeDirectoryId)
  }

  const handleOrganizeEnterDirectory = (hit: SearchHit) => {
    if (hit.kind !== 'dir' || !hit.path) return
    setOrganizeDirectory(hit.path)
    setOrganizeDirectoryId(hit.entryId)
    setOrganizeFilterPreview(null)
    void loadOrganizeDirectoryPreview(hit.path, undefined, hit.entryId)
  }

  const handleOrganizeGoParent = () => {
    const parent = parentDirectoryPath(organizeDirectoryValue, libraryForOrganize ? matchingRootPath(organizeDirectoryValue, libraryForOrganize.roots) : null)
    if (!parent) return
    setOrganizeDirectory(parent)
    setOrganizeDirectoryId(null)
    setOrganizeFilterPreview(null)
    void loadOrganizeDirectoryPreview(parent)
  }

  const handleOrganizeNextFromFilter = () => {
    if (organizeBlockReason) {
      setError(organizeBlockReason)
      return
    }
    setOrganizeStep('rules')
  }

  const handleOrganizeNextFromRules = async () => {
    if (!organizeCanRules) {
      setError('请至少启用一条完整的整理规则')
      return
    }
    const ok = await handleOrganizePreview()
    if (ok) setOrganizeStep('result')
  }

  const handleOrganizePreview = async () => {
    if (!organizeCanRules || !libraryForOrganize) return false
    setBusy('organize')
    setError(null)
    try {
      const scopeInput = { libraryId: libraryForOrganize.id, scope: 'directory' as const, directory: organizeDirectoryValue }
      const { snapshot } = await callNestify((api) => api.organizeSnapshot(scopeInput))
      const { preview } = await callNestify((api) => api.organizePreview({
        ...scopeInput,
        rules: organizeRuleDraft,
        snapshotId: snapshot.id,
        filter: organizeFilter.trim() || undefined,
        collision,
      }))
      setOrganizeSnapshot(snapshot)
      setOrganizePreview(preview)
      applyPlan(preview.plan, 'organize')
      setNotice(`整理预览完成：${preview.rows.length} 项变更，范围 ${snapshot.stats.selected} 项`)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(null)
    }
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
    if (entryIds.length === 0 && target !== 'duplicates' && target !== 'rename') {
      setError('请先选择搜索结果')
      return
    }
    if (target !== 'duplicates' && target !== 'rename') setDuplicateScope('selection')
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

  const handleRenamePreview = async (options?: { silent?: boolean; entryIds?: string[] }) => {
    const requestId = ++renamePreviewRequestId.current
    const payloadGroups = renameGroups
      .map((group) => ({
        filter: group.filter.trim() || undefined,
        template: group.template.trim(),
      }))
      .filter((group) => group.template.length > 0)
    if (!libraryForRename || !canRenameScope || payloadGroups.length === 0) return false
    if (!options?.silent) {
      setBusy('rename')
      setError(null)
    } else {
      setRenamePreviewBusy(true)
    }
    try {
      const { plan: next } = await callNestify((api) =>
        api.renamePreview({
          libraryId: libraryForRename.id,
          template: payloadGroups[0]!.template,
          groups: payloadGroups,
          scope: 'directory',
          directory: directoryForRename,
          entryIds: options?.entryIds,
          filter: renameFilter.trim() || undefined,
          collision,
        }),
      )
      if (requestId !== renamePreviewRequestId.current) return false
      if (options?.silent) {
        setPlanState({ plan: next, source: 'rename', fingerprint: planFingerprint })
        setRenameRuleSelected((current) => {
          const map = { ...current }
          for (const op of next.ops) {
            if (op.entryId && map[op.entryId] === undefined) map[op.entryId] = true
          }
          return map
        })
      } else {
        applyPlan(next, 'rename')
        setNotice(`改名预览完成，${next.ops.length} 条变更`)
      }
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      if (!options?.silent) setBusy(null)
      else setRenamePreviewBusy(false)
    }
  }

  const loadRenamePreview = useCallback(
    async (directory: string, sort?: { field: 'name' | 'size' | 'mtime'; direction: 'asc' | 'desc' }, parentId?: string | null) => {
      const library = libraries.find((item) => matchingRootPath(directory, item.roots))
      if (!library) {
        setRenamePreview(null)
        setRenamePreviewTotal(0)
        return
      }
      try {
        const next = await fetchAllDirectoryChildren({
          libraryId: library.id,
          directory,
          parentId: parentId ?? undefined,
          sort,
        })
        setRenamePreview(next.hits)
        setRenamePreviewTotal(next.total)
      } catch {
        setRenamePreview(null)
        setRenamePreviewTotal(0)
      }
    },
    [libraries],
  )

  const handleRenamePreviewSort = (field: 'name' | 'size' | 'mtime') => {
    const nextDirection: 'asc' | 'desc' | null =
      renamePreviewSort === field
        ? renamePreviewSortDirection === 'asc'
          ? 'desc'
          : renamePreviewSortDirection === 'desc'
            ? null
            : 'asc'
        : 'asc'
    setRenamePreviewSort(field)
    setRenamePreviewSortDirection(nextDirection)
    if (renameDirectory.trim()) {
      void loadRenamePreview(renameDirectory.trim(), nextDirection ? { field, direction: nextDirection } : undefined, renameDirectoryId)
    }
  }

  const runRenameFilterPreview = useCallback(
    async (expression: string) => {
      const directory = renameDirectory.trim()
      const library = libraries.find((item) => matchingRootPath(directory, item.roots))
      if (!expression.trim() || !directory || !library) {
        setRenameFilterPreview(null)
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
        setRenameFilterPreview(next.result.hits)
      } catch {
        setRenameFilterPreview(null)
      }
    },
    [libraries, renameDirectory],
  )

  const handleRenameFilterChange = (value: string) => {
    setRenameFilter(value)
    if (renameFilterPreviewTimer.current) window.clearTimeout(renameFilterPreviewTimer.current)
    renameFilterPreviewTimer.current = window.setTimeout(() => {
      void runRenameFilterPreview(value)
    }, 300)
  }

  const handleRenameEnterDirectory = (hit: SearchHit) => {
    if (hit.kind !== 'dir' || !hit.path) return
    setRenameDirectory(hit.path)
    setRenameDirectoryId(hit.entryId)
    setRenameFilterPreview(null)
    void loadRenamePreview(hit.path, undefined, hit.entryId)
  }

  const handleRenameGoParent = () => {
    const current = renameDirectory.trim()
    if (!current) return
    const rootPath = libraryForRename ? matchingRootPath(current, libraryForRename.roots) : null
    const parent = parentDirectoryPath(current, rootPath)
    if (!parent) return
    setRenameDirectory(parent)
    setRenameDirectoryId(null)
    setRenameFilterPreview(null)
    void loadRenamePreview(parent)
  }

  const handleUseRenameDirectory = async (path: string) => {
    setRenameDirectory(path)
    setRenameDirectoryId(null)
    setRenameFilterPreview(null)
    setRenameRuleSelected({})
    setRenameStep(path.trim() ? 'filter' : 'pick')
    if (!path.trim()) {
      setRenamePreview(null)
      setRenamePreviewTotal(0)
      return
    }
    setBusy('rename')
    try {
      await loadRenamePreview(path)
    } finally {
      setBusy(null)
    }
  }

  const handlePickRenameDirectory = async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked?.path) return
      await handleUseRenameDirectory(picked.path)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const handleRenameDirectoryChange = (value: string) => {
    setRenameDirectory(value)
    setRenameDirectoryId(null)
    setRenamePreview(null)
    setRenamePreviewTotal(0)
    setRenameFilterPreview(null)
    setRenameRuleSelected({})
    setRenameStep(value.trim() ? 'filter' : 'pick')
  }

  const handleRenameNextFromFilter = () => {
    if (renameBlockReason) {
      setError(renameBlockReason)
      return
    }
    setRenameStep('rules')
  }

  const handleRenameNextFromRules = async () => {
    const ok = await handleRenamePreview()
    if (ok) setRenameStep('result')
  }

  useEffect(() => {
    if (tab !== 'rename' || renameStep !== 'rules' || !canRenameScope) return
    if (!renameGroups.some((group) => group.template.trim())) return
    const timer = window.setTimeout(() => {
      void handleRenamePreview({ silent: true })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [tab, renameStep, renameGroups, collision, renameDirectory, renameFilter, canRenameScope])

  const handleToggleRenameRule = (entryId: string, checked: boolean) => {
    setRenameRuleSelected((current) => ({ ...current, [entryId]: checked }))
  }

  const handleToggleAllRenameRules = (checked: boolean) => {
    const currentPlan = planState?.source === 'rename' ? planState.plan : null
    setRenameRuleSelected((current) => {
      const map = { ...current }
      for (const op of currentPlan?.ops ?? []) {
        if (op.entryId) map[op.entryId] = checked
      }
      return map
    })
  }

  /**
   * 结果页切换保留策略：不重新读盘哈希（那是最贵的步骤），直接按新策略
   * 重排各组 keep 标记并重建隔离计划。哈希分组结果保持不变。
   */
  const handleDuplicateKeepStrategyChange = (value: KeepStrategy) => {
    setKeepStrategy(value)
    if (duplicateGroups.length === 0) return
    const nextGroups = applyKeepStrategyToGroups(duplicateGroups, value)
    setDuplicateGroups(nextGroups)
    if (planState?.source === 'duplicates' && activePlan && activePlan.ops.length > 0) {
      const nextPlan = ensureDuplicateLoserOps(activePlan, nextGroups)
      setPlanState({ ...planState, plan: nextPlan })
      setSelectedOps(syncDuplicateSelectedOps(nextGroups, nextPlan))
    }
  }


  /** 按保留策略比较两个重复命中（返回负数表示 a 优先保留）。 */
  const compareKeepHit = (a: DuplicateGroup['files'][number], b: DuplicateGroup['files'][number], strategy: KeepStrategy): number => {
    switch (strategy) {
      case 'newest':
        return b.mtime - a.mtime || a.path.localeCompare(b.path)
      case 'oldest':
        return a.mtime - b.mtime || a.path.localeCompare(b.path)
      case 'shortest_path':
        return a.path.length - b.path.length || a.path.localeCompare(b.path)
      case 'longest_path':
        return b.path.length - a.path.length || a.path.localeCompare(b.path)
      case 'shortest_name':
        return a.name.length - b.name.length || a.path.localeCompare(b.path)
      case 'longest_name':
        return b.name.length - a.name.length || a.path.localeCompare(b.path)
      case 'name_quality':
        return nameQualityScore(a) - nameQualityScore(b) || a.path.localeCompare(b.path)
      case 'preferred_dir':
        return (
          Number(!isWithinDirectory(a.path, directoryForDuplicates)) - Number(!isWithinDirectory(b.path, directoryForDuplicates)) ||
          b.mtime - a.mtime ||
          a.path.localeCompare(b.path)
        )
      default:
        return 0
    }
  }

  function applyKeepStrategyToGroups(groups: DuplicateGroup[], strategy: KeepStrategy): DuplicateGroup[] {
    return groups.map((group) => {
      const sorted = [...group.files].sort((a, b) => compareKeepHit(a, b, strategy))
      const files = sorted.map((file, index) => ({ ...file, keep: index === 0 }))
      return {
        ...group,
        files,
        wastedBytes: files.reduce((sum, file) => (file.keep ? sum : sum + file.size), 0),
      }
    })
  }

  function ensureDuplicateLoserOps(plan: ChangePlan, groups: DuplicateGroup[]): ChangePlan {
    const ops = [...plan.ops]
    const knownIds = new Set(ops.map((op) => op.entryId).filter(Boolean))
    const knownPaths = new Set(ops.map((op) => op.from))
    for (const group of groups) {
      const template = ops.find((op) => group.files.some((file) => file.entryId === op.entryId || file.path === op.from))
      for (const file of group.files) {
        if (file.keep || knownIds.has(file.entryId) || knownPaths.has(file.path) || !template) continue
        const to = template.to ? template.to.replace(/[^\\/]+$/, file.name) : null
        ops.push({
          ...template,
          from: file.path,
          to,
          entryId: file.entryId,
          selected: true,
        })
        knownIds.add(file.entryId)
        knownPaths.add(file.path)
      }
    }
    return { ...plan, ops }
  }

  function syncDuplicateSelectedOps(groups: DuplicateGroup[], plan: ChangePlan): Record<number, boolean> {
    const filesById = new Map(groups.flatMap((group) => group.files.map((file) => [file.entryId, file] as const)))
    const filesByPath = new Map(groups.flatMap((group) => group.files.map((file) => [file.path, file] as const)))
    const map: Record<number, boolean> = {}
    plan.ops.forEach((op, index) => {
      const file = (op.entryId ? filesById.get(op.entryId) : undefined) ?? filesByPath.get(op.from)
      map[index] = file ? !file.keep : false
    })
    return map
  }

  function nameQualityScore(file: DuplicateGroup['files'][number]): number {
    const name = file.name.toLowerCase()
    let score = 0
    if (/\bcopy\b|\b副本\b|\(?\d+\)?(?:\.\w+)?$/.test(name)) score += 40
    if (/\[[^\]]+\]|\([^)]*\)|【[^】]*】/.test(name)) score += 20
    if (/[-_.\s]{2,}/.test(name)) score += 10
    if (/^\d+(?:\.\w+)?$/.test(name)) score += 20
    if (name.length < 3) score += 10
    return score
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
    setDuplicateAnalysisProgress(null)
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
          dispose: 'quarantine',
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
      setDuplicateAnalysisProgress(null)
    } finally {
      setBusy(null)
    }
  }

  /** 加载目录内容预览（带排序）。 */
  const loadDuplicatePreview = useCallback(
    async (directory: string, sort?: { field: 'name' | 'size' | 'mtime'; direction: 'asc' | 'desc' }, parentId?: string | null) => {
      const library = libraries.find((item) => item.roots.some((root) => isWithinDirectory(directory, root)))
      if (!library) {
        setDuplicatePreview(null)
        setDuplicatePreviewTotal(0)
        return
      }
      try {
        const next = await fetchAllDirectoryChildren({
          libraryId: library.id,
          directory,
          parentId: parentId ?? undefined,
          sort,
        })
        setDuplicatePreview(next.hits)
        setDuplicatePreviewTotal(next.total)
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
      void loadDuplicatePreview(duplicateDirectory.trim(), nextDirection ? { field, direction: nextDirection } : undefined, duplicateDirectoryId)
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
    setDuplicateDirectoryId(hit.entryId)
    setDuplicateGroups([])
    void loadDuplicatePreview(hit.path, undefined, hit.entryId)
  }

  /** 预览返回上一级目录。 */
  const handleDuplicateGoParent = () => {
    const current = duplicateDirectory.trim()
    if (!current) return
    const rootPath = libraryForDirectory ? matchingRootPath(current, libraryForDirectory.roots) : null
    const parent = parentDirectoryPath(current, rootPath)
    if (!parent) return
    setDuplicateDirectory(parent)
    setDuplicateDirectoryId(null)
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
  const handleUseDuplicateDirectory = async (path: string) => {
    setDuplicateDirectory(path)
    setDuplicateDirectoryId(null)
    setDuplicateGroups([])
    setDuplicateFilterPreview(null)
    setDuplicateStep(path.trim() ? 'filter' : 'pick')
    if (!path.trim()) {
      setDuplicatePreview(null)
      setDuplicatePreviewTotal(0)
      return
    }
    setBusy('duplicates')
    try {
      await loadDuplicatePreview(path)
    } finally {
      setBusy(null)
    }
  }

  const handlePickDuplicateDirectory = async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked?.path) return
      await handleUseDuplicateDirectory(picked.path)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** 目录变更（手输/粘贴）时重置向导到第一步。 */
  const handleDuplicateDirectoryChange = (value: string) => {
    setDuplicateDirectory(value)
    setDuplicateDirectoryId(null)
    setDuplicateGroups([])
    setDuplicatePreview(null)
    setDuplicatePreviewTotal(0)
    setDuplicateStep(value.trim() ? 'filter' : 'pick')
  }

  const performExecutePlan = async () => {
    // 重复/改名固定目录模式：执行计划用目录匹配到的库（左侧选"全部资料库"也能执行）。
    const executeLibrary =
      planState?.source === 'duplicates'
        ? libraryForDirectory
        : planState?.source === 'rename'
          ? libraryForRename
          : planState?.source === 'organize'
            ? libraryForOrganize
            : selectedLibrary
    if (!executeLibrary || !activePlan) return
    const selected = activePlan.ops.map((op, index) => (selectedOps[index] ? index : -1)).filter((index) => index >= 0)
    const module = planState?.source
    if (!module) return
    setBusy('execute')
    setExecuteProgress({ module, status: 'running', current: 0, total: selected.length, ok: 0, skipped: 0, failed: 0, path: null })
    setError(null)
    try {
      const result = await callNestify((api) =>
        api.planExecute({ libraryId: executeLibrary.id, plan: activePlan, selectedOps: selected, module }),
      )
      setLastExecuteJobId(result.jobId)
      if (result.status === 'failed' || result.errors.length > 0) {
        const detail = result.errors.slice(0, 3).join('；')
        setError(`执行存在失败：${result.failed} 项${detail ? `：${detail}` : ''}`)
      } else if (module === 'duplicates') {
        // 保留重复分组和计划，方便切换模块后回来查看执行结果；已执行操作不可再次提交。
        setSelectedOps({})
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
      setExecuteProgress(null)
      setBusy(null)
    }
  }

  const handleExecutePlan = () => {
    if (!activePlan) return
    if (planState?.source === 'duplicates' && !libraryForDirectory) return
    if (planState?.source === 'rename' && !libraryForRename) return
    if (planState?.source === 'organize' && !libraryForOrganize) return
    if (planState?.source !== 'duplicates' && planState?.source !== 'rename' && planState?.source !== 'organize' && !selectedLibraryId) return
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
    renameGroups,
    setRenameGroups,
    renameRuleSelected,
    handleToggleRenameRule,
    handleToggleAllRenameRules,
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
    handleUseDuplicateDirectory,
    lastExecuteJobId,
    executeProgress,
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
    organizeDirectory,
    setOrganizeDirectory,
    organizeDirectoryId,
    organizeStep,
    setOrganizeStep,
    organizeFilter,
    setOrganizeFilter,
    organizeFilterPreview,
    organizeDirectoryPreview,
    organizeDirectoryPreviewTotal,
    organizeDirectoryPreviewSort,
    organizeDirectoryPreviewSortDirection,
    organizeRuleDraft,
    setOrganizeRuleDraft,
    organizePreview,
    organizeSnapshot,
    organizeCanPick,
    organizeCanRules,
    organizeBlockReason,
    libraryForOrganize,
    handlePickOrganizeDirectory,
    handleUseOrganizeDirectory,
    handleOrganizeDirectoryChange,
    handleOrganizeFilterChange,
    handleOrganizePreviewSort,
    handleOrganizeEnterDirectory,
    handleOrganizeGoParent,
    canOrganizeGoParent,
    handleOrganizeNextFromFilter,
    handleOrganizeNextFromRules,
    handleOrganizePreview,
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
    duplicateAnalysisProgress,
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
    canDuplicateGoParent,
    renameDirectory,
    setRenameDirectory,
    renameStep,
    setRenameStep,
    renameFilter,
    handleRenameFilterChange,
    renameFilterPreview,
    renamePreview,
    renamePreviewTotal,
    renamePreviewSort,
    renamePreviewSortDirection,
    handleRenamePreviewSort,
    handleRenameEnterDirectory,
    handleRenameGoParent,
    handlePickRenameDirectory,
    handleUseRenameDirectory,
    handleRenameDirectoryChange,
    handleRenameNextFromFilter,
    handleRenameNextFromRules,
    renameBlockReason,
    libraryForRename,
    canRenameScope,
    canRenameGoParent,
    renamePreviewBusy,
  }
}
