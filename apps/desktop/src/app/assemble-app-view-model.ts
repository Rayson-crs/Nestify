import type { Dispatch, SetStateAction } from 'react'
import type { SearchHit } from '@/lib/ipc'
import type { WorkspaceTab } from '@/lib/workspace'
import type { AppViewModel, ConfirmationRequest } from '@/app/types'
import type { useFileOperations } from '@/app/useFileOperations'
import type { useJobs } from '@/app/useJobs'
import type { useLibraries } from '@/app/useLibraries'
import type { WorkspaceFeatureBridge } from '@/app/workspace-feature-bridge'
import type { useSearchWorkspace } from '@/app/useSearchWorkspace'
import type { useSpotlight } from '@/app/useSpotlight'

type Libraries = ReturnType<typeof useLibraries>
type Search = ReturnType<typeof useSearchWorkspace>
type Jobs = ReturnType<typeof useJobs>
type Spotlight = ReturnType<typeof useSpotlight>
type FileOperations = ReturnType<typeof useFileOperations>

export function assembleAppViewModel(input: {
  tab: WorkspaceTab
  setTab: Dispatch<SetStateAction<WorkspaceTab>>
    error: string | null
  setError: Dispatch<SetStateAction<string | null>>
  notice: string | null
  setNotice: Dispatch<SetStateAction<string | null>>
  confirmation: ConfirmationRequest | null
  setConfirmation: Dispatch<SetStateAction<ConfirmationRequest | null>>
  closePromptOpen: boolean
    setClosePromptOpen: Dispatch<SetStateAction<boolean>>
    busy: string | null
  scanCompleted: boolean
  scanPercentDisplay: number | null
  scanPhaseLabel: string
  libraries: Libraries
  search: Search
  spotlight: Spotlight
  jobs: Jobs
  featureBridge: WorkspaceFeatureBridge | null
  rememberFeatureBridge: (bridge: WorkspaceFeatureBridge | null) => void
  featureInput: AppViewModel['featureInput']
  mergeInput: AppViewModel['mergeInput']
  fileOperations: FileOperations
  runConfirmation: () => Promise<void>
  handleScan: () => Promise<void>
  handleScanControl: (action: 'pause' | 'resume' | 'cancel') => Promise<void>
  handleRemoveLibrary: (libraryId: string, name: string) => void
  handleSendSelectionTo: (target: Exclude<WorkspaceTab, 'search' | 'jobs'>) => void
  handleOpen: (hit: SearchHit) => Promise<void>
  handleCopyPath: (hit: SearchHit) => Promise<void>
  handleMinimizeToTray: () => Promise<void>
  handleMinimizeWindow: () => Promise<void>
  handleQuitApp: () => Promise<void>
  openSpotlightHit: (hit: SearchHit) => Promise<void>
}): AppViewModel {
  const {
    libraries,
    search,
    spotlight,
    jobs,
    featureBridge,
    rememberFeatureBridge,
    featureInput,
    mergeInput,
    fileOperations,
  } = input

  return {
    ipcReady: libraries.ipcReady,
    libraries: libraries.libraries,
    selectedLibraryId: libraries.selectedLibraryId,
    setSelectedLibraryId: libraries.setSelectedLibraryId,
    editingLibraryId: libraries.editingLibraryId,
    setEditingLibraryId: libraries.setEditingLibraryId,
    libraryDraft: libraries.libraryDraft,
    setLibraryDraft: libraries.setLibraryDraft,
    featureBridge,
    rememberFeatureBridge,
    featureInput,
    mergeInput,
    executeProgress: featureBridge?.executeProgress ?? null,
    jobs: jobs.jobs,
    jobsLoading: jobs.jobsLoading,
    selectedJobId: jobs.selectedJobId,
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
    scanning: libraries.scanning,
    scanPaused: libraries.scanPaused,
    scan: libraries.scan,
    scanJobId: libraries.scanJobId,
    removingLibrary: libraries.removingLibrary,
    removalProgress: libraries.removalProgress,
    refreshingLibraries: libraries.refreshing,
    libraryRootHits: libraries.libraryRootHits,
    treeRootPath: libraries.treeRootPathFor(search.treePath),
    pendingTreePath: search.pendingTreePath,
    loadJobs: jobs.loadJobs,
    openJobDetails: jobs.openJobDetails,
    resumeMediaMerge: jobs.resumeMediaMerge,
    clearJobs: jobs.clearJobs,
    handleRefreshLibraries: libraries.handleRefreshLibraries,
    runSearch: search.runSearch,
    handleAddLibrary: libraries.handleAddLibrary,
    handleAddCustomLibrary: libraries.handleAddCustomLibrary,
    handleAddEntireComputer: libraries.handleAddEntireComputer,
    handleScan: input.handleScan,
    handleScanControl: input.handleScanControl,
    runConfirmation: input.runConfirmation,
    handleRemoveLibrary: input.handleRemoveLibrary,
    handleOpen: input.handleOpen,
    handleMinimizeToTray: input.handleMinimizeToTray,
    handleMinimizeWindow: input.handleMinimizeWindow,
    handleQuitApp: input.handleQuitApp,
    openSpotlightHit: input.openSpotlightHit,
    handleCopyPath: input.handleCopyPath,
    handleSendSelectionTo: input.handleSendSelectionTo,
    handleUpdateLibrary: libraries.handleUpdateLibrary,
    scanPercentDisplay: input.scanPercentDisplay,
    scanCompleted: input.scanCompleted,
    scanPhaseLabel: input.scanPhaseLabel,
    error: input.error,
    setError: input.setError,
    notice: input.notice,
    setNotice: input.setNotice,
    confirmation: input.confirmation,
    setConfirmation: input.setConfirmation,
    closePromptOpen: input.closePromptOpen,
    setClosePromptOpen: input.setClosePromptOpen,
    busy: input.busy,
    tab: input.tab,
    setTab: input.setTab,
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
    enterTreeDirectory: search.enterTreeDirectory,
    treeHits: search.treeHits,
    treeTotal: search.treeTotal,
    treeOffset: search.treeOffset,
    treeHasMore: search.treeHasMore,
    treeBusy: search.treeBusy,
    treeSort: search.treeSort,
    treeSortDirection: search.treeSortDirection,
    selectedEntryIds: search.selectedEntryIds,
    setSelectedEntryIds: search.setSelectedEntryIds,
    preview: search.preview,
    thumbnail: search.thumbnail,
    inspectorOpen: search.inspectorOpen,
    setInspectorOpen: search.setInspectorOpen,
    fileOperation: fileOperations.fileOperation,
    setFileOperation: fileOperations.setFileOperation,
    fileOperationBusy: fileOperations.fileOperationBusy,
    fileOperationProgress: fileOperations.fileOperationProgress,
    handleFileRename: fileOperations.handleFileRename,
    handleFileMove: fileOperations.handleFileMove,
    handleFileDelete: fileOperations.handleFileDelete,
    submitFileOperation: fileOperations.submitFileOperation,
    pickFileOperationDirectory: fileOperations.pickFileOperationDirectory,
    changeSearchSort: search.changeSearchSort,
    changeTreeSort: search.changeTreeSort,
    changeTreePage: search.changeTreePage,
    revealInTree: (hit) => search.revealInTree(hit, libraries.setSelectedLibraryId),
  }
}
