import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import type { RenameRuleGroup } from '@/components/rules/RenameGroupsEditor'
import type {
  ChangePlan,
  Collision,
  DuplicateGroup,
  DuplicateProgress,
  DuplicateHashStrategy,
  DuplicateScope,
  FilePreview,
  ThumbnailPreviewResult,
  KeepStrategy,
  LibrarySummary,
  RuleSetSummary,
  ScanProgress,
  SearchHit,
  SearchScope,
  SearchSortField,
  WorkspaceSendTarget,
  OrganizePreviewPayload,
  OrganizeSnapshotPayload,
  OrganizeRuleInput,
  ExecutionProgress,
  LibraryRemovalProgress,
} from '@/lib/ipc'
import type { FileOperationProgress, JobRecord } from '@nestify/shared'
import type { WorkspaceFeatureBridge } from '@/app/workspace-feature-bridge'
import type { PlanOpView } from '@/app/plan-state'
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
  cancelLabel?: string
  action: () => void | Promise<void>
}

export type FileOperationRequest = {
  kind: 'rename' | 'move' | 'delete'
  hit: SearchHit
}
export type { FileOperationProgress }

export type OrganizeStep = 'pick' | 'filter' | 'rules' | 'result'
export type OrganizeRuleDraft = OrganizeRuleInput

export type AppViewModel = {
  ipcReady: boolean
  libraries: LibrarySummary[]
  selectedLibraryId: string | null
  setSelectedLibraryId: Dispatch<SetStateAction<string | null>>
  editingLibraryId: string | null
  setEditingLibraryId: Dispatch<SetStateAction<string | null>>
  libraryDraft: LibraryDraft
  setLibraryDraft: Dispatch<SetStateAction<LibraryDraft>>
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  hits: SearchHit[]
  hitTotal: number
  searchElapsed: number | null
  searchBusy: boolean
  searchKind: SearchKindFilter
  setSearchKind: Dispatch<SetStateAction<SearchKindFilter>>
  searchSort: SearchSortField
  searchSortDirection: TriStateSortDirection
  setSearchSortDirection: Dispatch<SetStateAction<TriStateSortDirection>>
  searchScope: SearchScope
  setSearchScope: Dispatch<SetStateAction<SearchScope>>
  searchDirectory: string
  setSearchDirectory: Dispatch<SetStateAction<string>>
  searchOffset: number
  searchHasMore: boolean
  selectedHit: SearchHit | null
  setSelectedHit: Dispatch<SetStateAction<SearchHit | null>>
  fileViewMode: FileViewMode
  setFileViewMode: Dispatch<SetStateAction<FileViewMode>>
  treePath: string | null
  setTreePath: Dispatch<SetStateAction<string | null>>
  enterTreeDirectory: (path: string, entryId?: string, libraryId?: string) => void
  treeHits: SearchHit[]
  treeTotal: number
  treeOffset: number
  treeHasMore: boolean
  treeBusy: boolean
  treeSort: SearchSortField
  treeSortDirection: TriStateSortDirection
  selectedEntryIds: string[]
  setSelectedEntryIds: Dispatch<SetStateAction<string[]>>
  preview: FilePreview | null
  thumbnail: ThumbnailPreviewResult | null
  inspectorOpen: boolean
  setInspectorOpen: Dispatch<SetStateAction<boolean>>
  scan: ScanProgress
  scanJobId: string | null
  busy: string | null
  error: string | null
  setError: Dispatch<SetStateAction<string | null>>
  notice: string | null
  setNotice: Dispatch<SetStateAction<string | null>>
  confirmation: ConfirmationRequest | null
  setConfirmation: Dispatch<SetStateAction<ConfirmationRequest | null>>
  fileOperation: FileOperationRequest | null
  fileOperationBusy: boolean
  fileOperationProgress: FileOperationProgress | null
  setFileOperation: Dispatch<SetStateAction<FileOperationRequest | null>>
  handleFileRename: (hit: SearchHit) => void
  handleFileMove: (hit: SearchHit) => void
  handleFileDelete: (hit: SearchHit) => void
  submitFileOperation: (input: { kind: 'rename' | 'move' | 'delete'; hit: SearchHit; name?: string; directory?: string }) => Promise<void>
  pickFileOperationDirectory: () => Promise<string | null>
  ruleActionBusy: string | null
  handleRenamePlanPage: (delta: -1 | 1) => void
  lastExecuteJobId: string | null
  rememberFeatureBridge: (bridge: WorkspaceFeatureBridge | null) => void
  featureBridge: WorkspaceFeatureBridge | null
  featureInput: {
    libraries: LibrarySummary[]
    selectedLibrary: LibrarySummary | null
    selectedLibraryId: string | null
    selectedEntryIds: string[]
    query: string
    tab: WorkspaceTab
    setTab: Dispatch<SetStateAction<WorkspaceTab>>
    setError: Dispatch<SetStateAction<string | null>>
    setNotice: Dispatch<SetStateAction<string | null>>
    requestConfirmation: (request: ConfirmationRequest) => void
    runSearch: (text: string, libraryId?: string | null, offset?: number) => Promise<void>
    loadJobs: (options?: { preferJobId?: string }) => Promise<void>
  }
  mergeInput: {
    ipcReady: boolean
    setError: Dispatch<SetStateAction<string | null>>
    setNotice: Dispatch<SetStateAction<string | null>>
    loadJobs: (options?: { preferJobId?: string }) => Promise<void>
  }
  executeProgress: ExecutionProgress | null
  jobs: JobRecord[]
  jobsLoading: boolean
  selectedJobId: string | null
  closePromptOpen: boolean
  setClosePromptOpen: Dispatch<SetStateAction<boolean>>
  librarySourceOpen: boolean
  setLibrarySourceOpen: Dispatch<SetStateAction<boolean>>
  spotlightOpen: boolean
  setSpotlightOpen: (open: boolean, source?: string) => void
  spotlightQuery: string
  setSpotlightQuery: Dispatch<SetStateAction<string>>
  spotlightHits: SearchHit[]
  spotlightBusy: boolean
  spotlightActiveIndex: number
  setSpotlightActiveIndex: Dispatch<SetStateAction<number>>
  allLibrariesSelected: boolean
  hasLibraries: boolean
  selectedLibrary: LibrarySummary | null
  scanning: boolean
  scanPaused: boolean
  removingLibrary: boolean
  refreshingLibraries: boolean
  removalProgress: LibraryRemovalProgress | null
  libraryRootHits: SearchHit[]
  treeRootPath: string | null
  pendingTreePath: RefObject<string | null>
  loadJobs: (options?: { preferJobId?: string }) => Promise<void>
  openJobDetails: (jobId: string) => Promise<void>
  resumeMediaMerge: (jobId: string) => Promise<void>
  clearJobs: () => Promise<void>
  handleRefreshLibraries: () => Promise<void>
  runSearch: (text: string, libraryId?: string | null, offset?: number) => Promise<void>
  handleAddLibrary: () => Promise<void>
  handleAddCustomLibrary: () => Promise<void>
  handleAddEntireComputer: (splitByDrive?: boolean) => Promise<void>
  handleScan: () => Promise<void>
  handleScanControl: (action: 'pause' | 'resume' | 'cancel') => Promise<void>
  runConfirmation: () => Promise<void>
  handleRemoveLibrary: (libraryId: string, name: string) => void
  handleOpen: (path: string) => Promise<void>
  handleMinimizeToTray: () => Promise<void>
  handleMinimizeWindow: () => Promise<void>
  handleQuitApp: () => Promise<void>
  openSpotlightHit: (hit: SearchHit) => void
  handleCopyPath: (path: string) => Promise<void>
  handleSendSelectionTo: (target: WorkspaceSendTarget) => void
  handleUpdateLibrary: () => Promise<void>
  scanPercentDisplay: number | null
  scanCompleted: boolean
  scanPhaseLabel: string
  changeSearchSort: (field: SearchSortField) => void
  changeTreeSort: (field: SearchSortField) => void
  changeTreePage: (delta: number) => void
  revealInTree: (hit: SearchHit) => void
}
