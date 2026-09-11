import { useCallback, useEffect, useState } from 'react'
import { callNestify, getNestifyApi, type SearchHit } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { WorkspaceTab } from '@/lib/workspace'
import type { AppViewModel, ConfirmationRequest, FileOperationRequest } from '@/app/types'
import { useLibraries } from '@/app/useLibraries'
import { usePlans } from '@/app/usePlans'
import { useSearchWorkspace } from '@/app/useSearchWorkspace'
import { useSpotlight } from '@/app/useSpotlight'
import type { JobOpRecord, JobRecord } from '@nestify/shared'

export function useAppWorkspace(): AppViewModel {
  const [tab, setTab] = useState<WorkspaceTab>('search')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [fileOperation, setFileOperation] = useState<FileOperationRequest | null>(null)
  const [fileOperationBusy, setFileOperationBusy] = useState(false)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [jobOps, setJobOps] = useState<JobOpRecord[]>([])
  const [jobOpsLoading, setJobOpsLoading] = useState(false)

  const requestConfirmation = useCallback((request: ConfirmationRequest) => setConfirmation(request), [])

  const libraries = useLibraries({ setError, setNotice, requestConfirmation })
  const search = useSearchWorkspace({
    selectedLibraryId: libraries.selectedLibraryId,
    selectedLibrary: libraries.selectedLibrary,
    allLibrariesSelected: libraries.allLibrariesSelected,
    setError,
  })
  const spotlight = useSpotlight({
    ipcReady: libraries.ipcReady,
    hasLibraries: libraries.hasLibraries,
  })

  const loadJobs = useCallback(async (options?: { preferJobId?: string }) => {
    setJobsLoading(true)
    try {
      const { jobs: next } = await callNestify((api) => api.jobsList({ limit: 100 }))
      const validJobs = next.filter((job) => Boolean(job?.id))
      setJobs(validJobs)
      setSelectedJobId((current) => {
        const preferred = options?.preferJobId
        if (preferred && validJobs.some((job) => job.id === preferred)) return preferred
        return validJobs.some((job) => job.id === current) ? current : validJobs[0]?.id ?? null
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

  const plans = usePlans({
    libraries: libraries.libraries,
    selectedLibrary: libraries.selectedLibrary,
    selectedLibraryId: libraries.selectedLibraryId,
    selectedEntryIds: search.selectedEntryIds,
    query: search.query,
    tab,
    setTab,
    setError,
    setNotice,
    requestConfirmation,
    runSearch: search.runSearch,
    loadJobs,
    loadJobOps,
  })

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onUiEvent) return
    return api.onUiEvent((event) => {
      if (event === 'window:close-requested') {
        spotlight.setSpotlightOpen(false, 'window-close')
        setClosePromptOpen(true)
      }
    })
  }, [spotlight.setSpotlightOpen])

  // 文件系统无感同步：writer worker 处理完变更后推送 sync.updated，
  // 渲染端静默刷新库统计与当前搜索/目录视图（不弹任何提示）。
  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onSyncUpdated) return
    let last = 0
    return api.onSyncUpdated(() => {
      const now = Date.now()
      // 通知风暴防抖：500ms 内合并为一次刷新。
      if (now - last < 500) return
      last = now
      void libraries.loadLibraries().catch(() => {})
      void search
        .runSearch(search.query, libraries.selectedLibraryId, search.searchOffset)
        .catch(() => {})
      void search.refreshTree().catch(() => {})
    })
  }, [libraries.loadLibraries, libraries.selectedLibraryId, search.query, search.searchOffset, search.runSearch, search.refreshTree])

  useEffect(() => {
    if (!libraries.ipcReady) {
      setError('Nestify IPC 未就绪。请从 Electron 启动，而不是单独打开网页。')
      return
    }
    void (async () => {
      try {
        await Promise.all([libraries.loadLibraries(), plans.loadRules(), loadJobs()])
      } catch (err) {
        setError(errorMessage(err))
      }
    })()
  }, [libraries.ipcReady, libraries.loadLibraries, loadJobs, plans.loadRules])

  useEffect(() => {
    if (!selectedJobId) {
      setJobOps([])
      return
    }
    void loadJobOps(selectedJobId).catch((err) => setError(errorMessage(err)))
  }, [loadJobOps, selectedJobId])

  useEffect(() => {
    if (tab !== 'jobs') return
    const timer = window.setInterval(() => {
      void loadJobs().catch((err) => setError(errorMessage(err)))
    }, 3000)
    return () => window.clearInterval(timer)
  }, [loadJobs, tab])

  const handleOpen = async (path: string) => {
    libraries.setBusy('open')
    setError(null)
    try {
      await callNestify((api) => api.shellOpen({ path }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      libraries.setBusy(null)
    }
  }

  const handleCopyPath = async (path: string) => {
    libraries.setBusy('copy')
    setError(null)
    try {
      await callNestify((api) => api.clipboardWriteText({ text: path }))
      setNotice('已复制完整路径')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      libraries.setBusy(null)
    }
  }

  const handleFileRename = (hit: SearchHit) => setFileOperation({ kind: 'rename', hit })
  const handleFileMove = (hit: SearchHit) => setFileOperation({ kind: 'move', hit })
  const handleFileDelete = (hit: SearchHit) => setFileOperation({ kind: 'delete', hit })

  const refreshFileViews = async () => {
    await Promise.all([
      search.runSearch(search.query, libraries.selectedLibraryId, search.searchOffset),
      search.refreshTree(),
    ])
  }

  const submitFileOperation = async (input: {
    kind: 'rename' | 'move' | 'delete'
    hit: SearchHit
    name?: string
    directory?: string
  }) => {
    setFileOperationBusy(true)
    setError(null)
    try {
      await callNestify((api) => {
        if (input.kind === 'rename') {
          return api.fileRename
            ? api.fileRename({ libraryId: input.hit.libraryId, path: input.hit.path, name: input.name?.trim() ?? '' })
            : Promise.reject(new Error('file.rename is unavailable'))
        }
        if (input.kind === 'move') {
          return api.fileMove
            ? api.fileMove({ libraryId: input.hit.libraryId, path: input.hit.path, directory: input.directory?.trim() ?? '' })
            : Promise.reject(new Error('file.move is unavailable'))
        }
        return api.fileDelete
          ? api.fileDelete({ libraryId: input.hit.libraryId, path: input.hit.path })
          : Promise.reject(new Error('file.delete is unavailable'))
      })
      setFileOperation(null)
      setNotice(input.kind === 'rename' ? '已重命名' : input.kind === 'move' ? '已移动文件' : '已删除')
      await refreshFileViews()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setFileOperationBusy(false)
    }
  }

  const pickFileOperationDirectory = async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      return picked?.path ?? null
    } catch (err) {
      setError(errorMessage(err))
      return null
    }
  }

  const handleMinimizeToTray = async () => {
    setClosePromptOpen(false)
    spotlight.setSpotlightOpen(false, 'minimize')
    try {
      await callNestify((api) =>
        api.minimizeToTray
          ? api.minimizeToTray()
          : Promise.reject(new Error('window.minimize-to-tray is unavailable')),
      )
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const handleQuitApp = async () => {
    setClosePromptOpen(false)
    spotlight.setSpotlightOpen(false, 'quit')
    try {
      await callNestify((api) =>
        api.quitApp ? api.quitApp() : Promise.reject(new Error('window.quit is unavailable')),
      )
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const openSpotlightHit = (hit: SearchHit) => {
    spotlight.setSpotlightOpen(false, 'open-hit')
    void handleOpen(hit.path)
  }

  const runConfirmation = async () => {
    if (!confirmation) return
    const action = confirmation.action
    setConfirmation(null)
    await action()
  }

  const handleScan = async () => {
    await libraries.handleScan(async (jobId) => {
      await loadJobs({ preferJobId: jobId })
      window.setTimeout(() => void search.runSearch(search.query, libraries.selectedLibraryId), 600)
    })
  }

  const handleScanControl = async (action: 'pause' | 'resume' | 'cancel') => {
    await libraries.handleScanControl(action, () => loadJobs({ preferJobId: libraries.scanJobId ?? undefined }))
  }

  const handleRemoveLibrary = (libraryId: string, name: string) => {
    libraries.handleRemoveLibrary(libraryId, name, () => loadJobs())
  }

  const handleSendSelectionTo = (target: Exclude<WorkspaceTab, 'search' | 'jobs'>) => {
    const entryIds =
      search.selectedEntryIds.length > 0
        ? search.selectedEntryIds
        : search.selectedHit
          ? [search.selectedHit.entryId]
          : []
    // 重复分析固定"目录"模式：把选中文件所在目录带过去，而不是塞选择集。
    if (target === 'duplicates') {
      const parent = search.selectedHit?.parent
      if (parent) plans.setDuplicateDirectory(parent)
      search.setSelectedEntryIds(entryIds)
      plans.setTab('duplicates')
      setNotice(parent ? `已定位到目录：${parent}` : '请在重复分析里填入或选择目录')
      return
    }
    if (entryIds.length === 0) {
      setError('请先选择搜索结果')
      return
    }
    search.setSelectedEntryIds(entryIds)
    plans.handleSendSelectionTo(target)
  }

  const scanJob = jobs.find((job) => job.id === libraries.scanJobId) ?? null
  const scanPercent = libraries.scanning
    ? Math.min(95, 8 + Math.log10(Math.max(1, libraries.scan.filesScanned + libraries.scan.dirsScanned)) * 18)
    : 0
  const scanCompleted = !libraries.scanning && scanJob?.status === 'completed'
  const scanPercentDisplay = scanCompleted ? 100 : scanPercent
  const scanPhaseLabel = libraries.scanning
    ? libraries.scanPaused
      ? '暂停'
      : '扫描中'
    : scanJob?.status === 'cancelled'
      ? '已取消'
      : scanJob?.status === 'failed'
        ? '失败'
        : scanCompleted
          ? '完成'
          : libraries.scan.phase === 'idle'
            ? '就绪'
            : libraries.scan.phase

  const busy = libraries.busy ?? plans.planBusy

  return {
    ipcReady: libraries.ipcReady,
    libraries: libraries.libraries,
    selectedLibraryId: libraries.selectedLibraryId,
    setSelectedLibraryId: libraries.setSelectedLibraryId,
    editingLibraryId: libraries.editingLibraryId,
    setEditingLibraryId: libraries.setEditingLibraryId,
    libraryDraft: libraries.libraryDraft,
    setLibraryDraft: libraries.setLibraryDraft,
    ruleSets: plans.ruleSets,
    selectedRuleSetId: plans.selectedRuleSetId,
    setSelectedRuleSetId: plans.setSelectedRuleSetId,
    tab,
    setTab,
    query: search.query,
    setQuery: search.setQuery,
    hits: search.hits,
    hitTotal: search.hitTotal,
    searchElapsed: search.searchElapsed,
    searchBusy: search.searchBusy,
    searchKind: search.searchKind,
    setSearchKind: search.setSearchKind,
    searchSort: search.searchSort,
    searchSortDirection: search.searchSortDirection,
    setSearchSortDirection: search.setSearchSortDirection,
    searchScope: search.searchScope,
    setSearchScope: search.setSearchScope,
    searchDirectory: search.searchDirectory,
    setSearchDirectory: search.setSearchDirectory,
    searchOffset: search.searchOffset,
    searchHasMore: search.searchHasMore,
    selectedHit: search.selectedHit,
    setSelectedHit: search.setSelectedHit,
    fileViewMode: search.fileViewMode,
    setFileViewMode: search.setFileViewMode,
    treePath: search.treePath,
    setTreePath: search.setTreePath,
    treeHits: search.treeHits,
    treeTotal: search.treeTotal,
    treeBusy: search.treeBusy,
    treeSort: search.treeSort,
    treeSortDirection: search.treeSortDirection,
    selectedEntryIds: search.selectedEntryIds,
    setSelectedEntryIds: search.setSelectedEntryIds,
    preview: search.preview,
    inspectorOpen: search.inspectorOpen,
    setInspectorOpen: search.setInspectorOpen,
    scan: libraries.scan,
    scanJobId: libraries.scanJobId,
    busy,
    error,
    setError,
    notice,
    setNotice,
    confirmation,
    setConfirmation,
    fileOperation,
    fileOperationBusy,
    setFileOperation,
    handleFileRename,
    handleFileMove,
    handleFileDelete,
    submitFileOperation,
    pickFileOperationDirectory,
    ruleActionBusy: plans.ruleActionBusy,
    ruleDraft: plans.ruleDraft,
    setRuleDraft: plans.setRuleDraft,
    collision: plans.collision,
    setCollision: plans.setCollision,
    template: plans.template,
    setTemplate: plans.setTemplate,
    selectedOps: plans.selectedOps,
    setSelectedOps: plans.setSelectedOps,
    duplicateGroups: plans.duplicateGroups,
    keepStrategy: plans.keepStrategy,
    setKeepStrategy: plans.setKeepStrategy,
    duplicateScope: plans.duplicateScope,
    setDuplicateScope: plans.setDuplicateScope,
    duplicateDirectory: plans.duplicateDirectory,
    setDuplicateDirectory: plans.setDuplicateDirectory,
    duplicateHashStrategy: plans.duplicateHashStrategy,
    setDuplicateHashStrategy: plans.setDuplicateHashStrategy,
    handlePickDuplicateDirectory: plans.handlePickDuplicateDirectory,
    duplicateStep: plans.duplicateStep,
    setDuplicateStep: plans.setDuplicateStep,
    duplicateFilter: plans.duplicateFilter,
    setDuplicateFilter: plans.setDuplicateFilter,
    handleDuplicateFilterChange: plans.handleDuplicateFilterChange,
    duplicateFilterPreview: plans.duplicateFilterPreview,
    activeGroupId: plans.activeGroupId,
    setActiveGroupId: plans.setActiveGroupId,
    groupsPaneWidth: plans.groupsPaneWidth,
    setGroupsPaneWidth: plans.setGroupsPaneWidth,
    handleDuplicateToggleKeep: plans.handleDuplicateToggleKeep,
    handleDuplicateResetGroup: plans.handleDuplicateResetGroup,
    duplicatePreview: plans.duplicatePreview,
    duplicatePreviewTotal: plans.duplicatePreviewTotal,
    duplicatePreviewSort: plans.duplicatePreviewSort,
    duplicatePreviewSortDirection: plans.duplicatePreviewSortDirection,
    handleDuplicatePreviewSort: plans.handleDuplicatePreviewSort,
    handleDuplicateEnterDirectory: plans.handleDuplicateEnterDirectory,
    handleDuplicateGoParent: plans.handleDuplicateGoParent,
    handleDuplicateDirectoryChange: plans.handleDuplicateDirectoryChange,
    handleDuplicateKeepStrategyChange: plans.handleDuplicateKeepStrategyChange,
    analyzeBlockReason: plans.analyzeBlockReason,
    libraryForDirectory: plans.libraryForDirectory,
    lastExecuteJobId: plans.lastExecuteJobId,
    jobs,
    jobsLoading,
    selectedJobId,
    setSelectedJobId,
    jobOps,
    jobOpsLoading,
    closePromptOpen,
    setClosePromptOpen,
    librarySourceOpen: libraries.librarySourceOpen,
    setLibrarySourceOpen: libraries.setLibrarySourceOpen,
    spotlightOpen: spotlight.spotlightOpen,
    setSpotlightOpen: spotlight.setSpotlightOpen,
    spotlightQuery: spotlight.spotlightQuery,
    setSpotlightQuery: spotlight.setSpotlightQuery,
    spotlightHits: spotlight.spotlightHits,
    spotlightBusy: spotlight.spotlightBusy,
    spotlightActiveIndex: spotlight.spotlightActiveIndex,
    setSpotlightActiveIndex: spotlight.setSpotlightActiveIndex,
    allLibrariesSelected: libraries.allLibrariesSelected,
    hasLibraries: libraries.hasLibraries,
    selectedLibrary: libraries.selectedLibrary,
    selectedRuleSet: plans.selectedRuleSet,
    scanning: libraries.scanning,
    scanPaused: libraries.scanPaused,
    removingLibrary: libraries.removingLibrary,
    libraryRootHits: libraries.libraryRootHits,
    treeRootPath: libraries.treeRootPathFor(search.treePath),
    pendingTreePath: search.pendingTreePath,
    loadJobs,
    runSearch: search.runSearch,
    handleAddLibrary: libraries.handleAddLibrary,
    handleAddCustomLibrary: libraries.handleAddCustomLibrary,
    handleAddEntireComputer: libraries.handleAddEntireComputer,
    handleScan,
    handleScanControl,
    runConfirmation,
    handleRemoveLibrary,
    handleOpen,
    handleMinimizeToTray,
    handleQuitApp,
    openSpotlightHit,
    handleCopyPath,
    handleSendSelectionTo,
    handleUpdateLibrary: libraries.handleUpdateLibrary,
    handleCreateRuleSet: plans.handleCreateRuleSet,
    handleUpdateRuleSet: plans.handleUpdateRuleSet,
    handleRefreshRuleSet: plans.handleRefreshRuleSet,
    handleToggleRuleSet: plans.handleToggleRuleSet,
    handleRuleSetPriority: plans.handleRuleSetPriority,
    handleCloneRuleSet: plans.handleCloneRuleSet,
    handleDeleteRuleSet: plans.handleDeleteRuleSet,
    handleExportRuleSet: plans.handleExportRuleSet,
    handleImportRuleSet: plans.handleImportRuleSet,
    activePlan: plans.activePlan,
    handleRulesPreview: plans.handleRulesPreview,
    handleRenamePreview: plans.handleRenamePreview,
    handleAnalyzeDuplicates: plans.handleAnalyzeDuplicates,
    handleExecutePlan: plans.handleExecutePlan,
    handleRollback: plans.handleRollback,
    handleJobRollback: plans.handleJobRollback,
    selectedCount: plans.selectedCount,
    canPreviewScope: plans.canPreviewScope,
    scanPercentDisplay,
    scanCompleted,
    scanPhaseLabel,
    changeSearchSort: search.changeSearchSort,
    changeTreeSort: search.changeTreeSort,
    revealInTree: (hit) => search.revealInTree(hit, libraries.setSelectedLibraryId),
  }
}
