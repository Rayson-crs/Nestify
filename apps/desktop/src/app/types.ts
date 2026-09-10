import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { RuleSetEditorValue } from '@/components/RuleSetEditor'
import type {
  ChangePlan,
  Collision,
  DuplicateGroup,
  DuplicateHashStrategy,
  DuplicateScope,
  FilePreview,
  KeepStrategy,
  LibrarySummary,
  RuleSetSummary,
  ScanProgress,
  SearchHit,
  SearchScope,
  SearchSortField,
} from '@/lib/ipc'
import type { JobOpRecord, JobRecord } from '@nestify/shared'
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
  action: () => void | Promise<void>
}

export type FileOperationRequest = {
  kind: 'rename' | 'move' | 'delete'
  hit: SearchHit
}

export type AppViewModel = {
  ipcReady: boolean
  libraries: LibrarySummary[]
  selectedLibraryId: string | null
  setSelectedLibraryId: Dispatch<SetStateAction<string | null>>
  editingLibraryId: string | null
  setEditingLibraryId: Dispatch<SetStateAction<string | null>>
  libraryDraft: LibraryDraft
  setLibraryDraft: Dispatch<SetStateAction<LibraryDraft>>
  ruleSets: RuleSetSummary[]
  selectedRuleSetId: string
  setSelectedRuleSetId: Dispatch<SetStateAction<string>>
  tab: WorkspaceTab
  setTab: Dispatch<SetStateAction<WorkspaceTab>>
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
  treeHits: SearchHit[]
  treeTotal: number
  treeBusy: boolean
  treeSort: SearchSortField
  treeSortDirection: TriStateSortDirection
  selectedEntryIds: string[]
  setSelectedEntryIds: Dispatch<SetStateAction<string[]>>
  preview: FilePreview | null
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
  setFileOperation: Dispatch<SetStateAction<FileOperationRequest | null>>
  handleFileRename: (hit: SearchHit) => void
  handleFileMove: (hit: SearchHit) => void
  handleFileDelete: (hit: SearchHit) => void
  submitFileOperation: (input: { kind: 'rename' | 'move' | 'delete'; hit: SearchHit; name?: string; directory?: string }) => Promise<void>
  pickFileOperationDirectory: () => Promise<string | null>
  ruleActionBusy: string | null
  ruleDraft: RuleSetEditorValue
  setRuleDraft: Dispatch<SetStateAction<RuleSetEditorValue>>
  collision: Collision
  setCollision: Dispatch<SetStateAction<Collision>>
  template: string
  setTemplate: Dispatch<SetStateAction<string>>
  selectedOps: Record<number, boolean>
  setSelectedOps: Dispatch<SetStateAction<Record<number, boolean>>>
  duplicateGroups: DuplicateGroup[]
  keepStrategy: KeepStrategy
  setKeepStrategy: Dispatch<SetStateAction<KeepStrategy>>
  duplicateScope: DuplicateScope
  setDuplicateScope: Dispatch<SetStateAction<DuplicateScope>>
  duplicateDirectory: string
  setDuplicateDirectory: Dispatch<SetStateAction<string>>
  duplicateHashStrategy: DuplicateHashStrategy
  setDuplicateHashStrategy: Dispatch<SetStateAction<DuplicateHashStrategy>>
  handlePickDuplicateDirectory: () => Promise<void>
  analyzeBlockReason: string | null
  libraryForDirectory: LibrarySummary | null
  lastExecuteJobId: string | null
  jobs: JobRecord[]
  jobsLoading: boolean
  selectedJobId: string | null
  setSelectedJobId: Dispatch<SetStateAction<string | null>>
  jobOps: JobOpRecord[]
  jobOpsLoading: boolean
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
  selectedRuleSet: RuleSetSummary | null
  scanning: boolean
  scanPaused: boolean
  removingLibrary: boolean
  libraryRootHits: SearchHit[]
  treeRootPath: string | null
  pendingTreePath: RefObject<string | null>
  loadJobs: (options?: { preferJobId?: string }) => Promise<void>
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
  handleQuitApp: () => Promise<void>
  openSpotlightHit: (hit: SearchHit) => void
  handleCopyPath: (path: string) => Promise<void>
  handleSendSelectionTo: (target: Exclude<WorkspaceTab, 'search' | 'jobs'>) => void
  handleUpdateLibrary: () => Promise<void>
  handleCreateRuleSet: () => void | Promise<void>
  handleUpdateRuleSet: () => void | Promise<void>
  handleRefreshRuleSet: () => void | Promise<void>
  handleToggleRuleSet: () => void | Promise<void>
  handleRuleSetPriority: (delta: number) => void | Promise<void>
  handleCloneRuleSet: () => void | Promise<void>
  handleDeleteRuleSet: () => void
  handleExportRuleSet: () => void | Promise<void>
  handleImportRuleSet: () => void | Promise<void>
  activePlan: ChangePlan | null
  handleRulesPreview: () => Promise<void>
  handleRenamePreview: () => Promise<void>
  handleAnalyzeDuplicates: () => Promise<void>
  handleExecutePlan: () => void
  handleRollback: () => Promise<void>
  handleJobRollback: (job: JobRecord) => Promise<void>
  selectedCount: number
  canPreviewScope: boolean
  scanPercentDisplay: number
  scanCompleted: boolean
  scanPhaseLabel: string
  changeSearchSort: (field: SearchSortField) => void
  changeTreeSort: (field: SearchSortField) => void
  revealInTree: (hit: SearchHit) => void
}
