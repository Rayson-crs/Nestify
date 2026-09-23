import { useCallback, useEffect, useRef, useState } from 'react'
import { assembleAppViewModel } from '@/app/assemble-app-view-model'
import { getNestifyApi } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { WorkspaceTab } from '@/lib/workspace'
import type { AppViewModel, ConfirmationRequest } from '@/app/types'
import { useLibraries } from '@/app/useLibraries'
import { useFileOperations } from '@/app/useFileOperations'
import { useJobs } from '@/app/useJobs'
import { useMediaMerge } from '@/app/useMediaMerge'
import { usePlans } from '@/app/usePlans'
import { useScanStatus } from '@/app/useScanStatus'
import { useSearchWorkspace } from '@/app/useSearchWorkspace'
import { useShellActions } from '@/app/useShellActions'
import { useSpotlight } from '@/app/useSpotlight'
import { sendSelectionTo } from '@/app/selection-transfer'

export function useAppWorkspace(): AppViewModel {
  const [tab, setTab] = useState<WorkspaceTab>('search')
  const previousTabRef = useRef<WorkspaceTab>('search')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [closePromptOpen, setClosePromptOpen] = useState(false)

  const requestConfirmation = useCallback((request: ConfirmationRequest) => setConfirmation(request), [])

  const libraries = useLibraries({ setError, setNotice, requestConfirmation })
  const search = useSearchWorkspace({
    selectedLibraryId: libraries.selectedLibraryId,
    selectedLibrary: libraries.selectedLibrary,
    allLibrariesSelected: libraries.allLibrariesSelected,
    libraries: libraries.libraries,
    onSelectLibrary: libraries.setSelectedLibraryId,
    setError,
  })
  const spotlight = useSpotlight({
    ipcReady: libraries.ipcReady,
    hasLibraries: libraries.hasLibraries,
  })

  const jobsState = useJobs({ setError, setNotice })
  const { loadJobs, loadJobOps } = jobsState

  const scanRunSearch = useCallback(
    () => search.runSearch(search.query, libraries.selectedLibraryId, search.searchOffset),
    [libraries.selectedLibraryId, search.query, search.searchOffset, search.runSearch],
  )
  const scanRefreshTree = useCallback(() => search.refreshTree(), [search.refreshTree])

  const merge = useMediaMerge({
    ipcReady: libraries.ipcReady,
    setError,
    setNotice,
    loadJobs,
  })

  useEffect(() => {
    const previousTab = previousTabRef.current
    previousTabRef.current = tab
    const mergeFinished = merge.progress?.status === 'completed'
      || merge.progress?.status === 'failed'
      || merge.progress?.status === 'cancelled'
    if (tab === 'merge' && previousTab !== 'merge' && mergeFinished) merge.reset()
  }, [merge.progress?.status, merge.reset, tab])

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

  const shellActions = useShellActions({
    setBusy: libraries.setBusy,
    setClosePromptOpen,
    setError,
    setNotice,
    closeSpotlight: spotlight.setSpotlightOpen,
  })
  const {
    handleOpen,
    handleCopyPath,
    handleMinimizeToTray,
    handleQuitApp,
    openSpotlightHit,
  } = shellActions

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

  const refreshFileViews = async () => {
    await Promise.all([
      search.runSearch(search.query, libraries.selectedLibraryId, search.searchOffset),
      search.refreshTree(),
    ])
  }

  const fileOperations = useFileOperations({
    setError,
    setNotice,
    refreshFileViews,
  })

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
    sendSelectionTo({
      target,
      searchHits: search.hits,
      selectedHit: search.selectedHit,
      selectedEntryIds: search.selectedEntryIds,
      setSelectedEntryIds: search.setSelectedEntryIds,
      merge,
      plans,
      setError,
      setNotice,
    })
  }

  const {
    scanCompleted,
    scanPercentDisplay,
    scanPhaseLabel,
  } = useScanStatus({
    scanning: libraries.scanning,
    scanPaused: libraries.scanPaused,
    scanJobId: libraries.scanJobId,
    filesScanned: libraries.scan.filesScanned,
    dirsScanned: libraries.scan.dirsScanned,
    scanPhase: libraries.scan.phase,
    jobs: jobsState.jobs,
    tab,
    loadJobs,
    runSearch: scanRunSearch,
    refreshTree: scanRefreshTree,
    setError,
  })

  const busy = libraries.removalProgress ? 'library-remove' : libraries.busy ?? plans.planBusy

  return assembleAppViewModel({
    tab,
    setTab,
    error,
    setError,
    notice,
    setNotice,
    confirmation,
    setConfirmation,
    closePromptOpen,
    setClosePromptOpen,
    busy,
    scanCompleted,
    scanPercentDisplay,
    scanPhaseLabel,
    libraries,
    search,
    spotlight,
    jobs: jobsState,
    merge,
    plans,
    fileOperations,
    runConfirmation,
    handleScan,
    handleScanControl,
    handleRemoveLibrary,
    handleSendSelectionTo,
    handleOpen,
    handleCopyPath,
    handleMinimizeToTray,
    handleQuitApp,
    openSpotlightHit,
  })
}
