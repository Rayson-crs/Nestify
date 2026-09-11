import type { JobOpRecord, JobRecord } from '@nestify/shared'

export type Collision = 'suffix' | 'skip' | 'overwrite'
export type CollisionStrategy = Collision
export type LibraryHashStrategy = 'off' | 'on-demand' | 'duplicate-candidate-only' | 'all'
export type LibraryMediaStrategy = 'off' | 'standard' | 'deep'
export type LibraryPreviewStrategy = 'off' | 'standard' | 'on-demand' | 'visible' | 'eager'

export type LibrarySummary = {
  id: string
  name: string
  roots: string[]
  excludeGlobs: string[]
  maxDepth: number | null
  followSymlinks: boolean
  scanHidden: boolean
  hashStrategy: LibraryHashStrategy
  mediaStrategy: LibraryMediaStrategy
  previewStrategy: LibraryPreviewStrategy
  updatedAt?: number
}

export type LibraryPatchInput = Partial<
  Omit<LibrarySummary, 'id' | 'updatedAt'>
>

export const ALL_LIBRARIES_ID = '__all__'

export type NestifySettings = {
  scanConcurrency: number
  thumbnailConcurrency: number
  searchDebounceMs: number
  spotlightShortcut: string
  minimizeToTrayOnClose: boolean
}

export type SearchHit = {
  entryId: string
  libraryId: string
  name: string
  path: string
  ext: string
  parent: string | null
  kind: string
  size: number
  mtime: number | null
}

export type SearchResult = {
  hits: SearchHit[]
  total: number
  fileCount: number
  directoryCount: number
  kindCounts: Record<string, number>
  elapsedMs: number
  hasMore: boolean
  nextCursor?: string
  statsIncluded: boolean
}

export type SearchScope = 'library' | 'directory' | 'selection'
export type SearchSortField = 'relevance' | 'mtime' | 'size' | 'path' | 'name' | 'path_mtime'
export type SearchSort = {
  field: SearchSortField
  direction?: 'asc' | 'desc'
}

export type ActiveScanJobStatus = 'running' | 'paused' | 'cancelling'

export type SearchQueryInput = {
  libraryId: string
  text: string
  textMode?: 'full-text' | 'substring'
  limit?: number
  offset?: number
  cursor?: string
  resultMode?: 'hits-only' | 'hits-and-approximate-count' | 'hits-and-exact-stats'
  kinds?: string[]
  scope?: SearchScope
  directory?: string
  directChildren?: boolean
  entryIds?: string[]
  sort?: SearchSort
}

export type ScanProgress = {
  phase: string
  paused?: boolean
  jobId?: string | null
  libraryId?: string | null
  jobStatus?: ActiveScanJobStatus | null
  filesScanned: number
  dirsScanned: number
  bytesScanned: number
  currentPath?: string
  errors: number
  filesPerSecond?: number
}

export type NestifyUiEvent = 'window:close-requested' | 'spotlight:open'

export type DuplicateScope = 'library' | 'directory' | 'selection'
export type PlanPreviewScope = DuplicateScope
export type KeepStrategy = 'newest' | 'oldest' | 'shortest_path' | 'name_quality' | 'preferred_dir'
export type DuplicateHashStrategy = 'on-demand' | 'duplicate-candidate-only' | 'all'

export type PlanScopeInput = {
  scope?: PlanPreviewScope
  entryIds?: string[]
  directory?: string
}

export type RuleAction =
  | 'rename_dir'
  | 'flatten_dir'
  | 'rename_file'
  | 'move'
  | 'delete_to_quarantine'

export type RuleDefinitionSummary = {
  id: string
  enabled: boolean
  priority: number
  action: RuleAction
  match?: unknown
  template?: string
  extract?: Record<string, { from: string }>
  reason?: string
  /** v2：步骤链视图（IF/ELSE/FOR/transform/action）。存盘时由后端 validator 解析；
   *  留空则 plannner 走老 match+action+template 路径。 */
  steps?: RuleStepSummary[]
}

/** 步骤链节点：与 @nestify/rules RuleStep 同结构，但因 IPC 边界用 unknown target/when 简化。 */
export type RuleStepKind = 'filter' | 'ifElse' | 'forEach' | 'transform' | 'action'
export type RuleStepTarget =
  | { kind: 'self' }
  | { kind: 'children' }
  | { kind: 'scope'; step: string; var: string }
export type RuleStepSummary =
  | { id: string; kind: 'filter'; when?: unknown; target?: RuleStepTarget; why?: string }
  | { id: string; kind: 'ifElse'; when?: unknown; then: RuleStepSummary[]; else?: RuleStepSummary[]; why?: string }
  | { id: string; kind: 'forEach'; of: RuleStepTarget; as: string; steps: RuleStepSummary[]; why?: string }
  | { id: string; kind: 'transform'; from?: RuleStepTarget; as: string; expr: string; why?: string }
  | { id: string; kind: 'action'; action: RuleAction; target?: RuleStepTarget; template?: string; reason?: string }

export type RuleStepKindOf<T extends RuleStepSummary['kind']> = Extract<RuleStepSummary, { kind: T }>

export type RuleSetSummary = {
  id: string
  name: string
  description?: string
  dryRunDefault: boolean
  collision: Collision | string
  rules: RuleDefinitionSummary[]
  builtin: boolean
  enabled: boolean
  priority: number
  createdAt: number
  updatedAt: number
}

export type RuleSetCreateInput = Omit<RuleSetSummary, 'id' | 'builtin' | 'enabled' | 'priority' | 'createdAt' | 'updatedAt'> & {
  id?: string
  enabled?: boolean
  priority?: number
}

export type RuleSetPatchInput = Partial<
  Omit<RuleSetSummary, 'id' | 'builtin' | 'enabled' | 'priority' | 'createdAt' | 'updatedAt'>
>

export type DuplicateHit = {
  entryId: string
  name: string
  path: string
  size: number
  mtime: number
  keep: boolean
}

export type DuplicateGroup = {
  id: string
  hash: string
  size: number
  wastedBytes: number
  files: DuplicateHit[]
}

export type PlanOperation = 'rename' | 'move' | 'mkdir' | 'quarantine' | 'delete' | 'flatten'
export type PlanRisk =
  | 'none'
  | 'overwrite'
  | 'long_path'
  | 'occupied'
  | 'network'
  | 'ambiguous'
  | 'illegal_name'
  | 'protected'
  | 'out_of_library'
  | 'case_conflict'
export type PlanStatus =
  | 'draft'
  | 'validated'
  | 'confirmed'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled_back'

export type PlanOp = {
  op: PlanOperation
  from: string
  to: string | null
  entryId?: string
  ruleId: string | null
  reason: string
  risk: PlanRisk
  confidence: number
  selected: boolean
}

export type ChangePlan = {
  id: string
  libraryId: string
  jobId?: string
  createdAt: number
  status: PlanStatus
  dryRun: boolean
  collision: Collision
  summary: {
    selected: number
    rename: number
    move: number
    mkdir: number
    quarantine: number
    delete: number
    flatten: number
    conflicts: number
  }
  ops: PlanOp[]
}

export type FilePreview = {
  kind: 'image' | 'video' | 'none' | 'too-large'
  dataUrl?: string
  src?: string
}

export type ThumbnailPreviewErrorCode =
  | 'invalid_request'
  | 'not_implemented'
  | 'entry_not_found'
  | 'unsupported_kind'
  | 'generation_failed'
  | 'cancelled'

export type ThumbnailPreviewError = {
  code: ThumbnailPreviewErrorCode
  message: string
  retryable: boolean
}

export type ThumbnailPreviewResult = {
  entryId: string
  kind: string | null
  cacheKey: string
  mime: string | null
  width: number | null
  height: number | null
  url: string | null
  error: ThumbnailPreviewError | null
}

export type ThumbnailPreviewRequest = {
  requestId?: string
  libraryId: string
  entryId: string
  kind?: 'image' | 'video'
  width?: number
  height?: number
  size?: number
  priority?: 'selected' | 'visible' | 'background'
}

export interface NestifyApi {
  settingsGet?(): Promise<NestifySettings>
  settingsUpdate?(input: Partial<NestifySettings>): Promise<NestifySettings>
  libraryList(): Promise<{ libraries: LibrarySummary[] }>
  libraryAdd(input: { name: string; roots: string[] }): Promise<{ library: LibrarySummary }>
  libraryUpdate?(input: { id: string; patch: LibraryPatchInput }): Promise<{ library: LibrarySummary }>
  libraryRemove?(input: { id: string }): Promise<{ ok: true }>
  pickDirectory(): Promise<{ path: string } | null>
  listDriveRoots?(): Promise<{ roots: string[] }>
  minimizeToTray?(): Promise<{ ok: true }>
  quitApp?(): Promise<{ ok: true }>
  openSpotlight?(): Promise<{ ok: true }>
  closeSpotlight?(): Promise<{ ok: true }>
  resizeSpotlight?(input: { height: number }): Promise<{ ok: true }>
  onUiEvent?(listener: (event: NestifyUiEvent) => void): () => void
  onSyncUpdated?(listener: (payload: { libraryId: string; count: number }) => void): () => void
  scanStart(input: { libraryId: string }): Promise<{
    job: { id: string; status: string }
    result?: { filesScanned: number; dirsScanned: number; errors: number }
  }>
  scanProgress(): Promise<ScanProgress>
  scanPause?(input: { jobId: string }): Promise<{ job: { id: string; status: string } }>
  scanResume?(input: { jobId: string }): Promise<{ job: { id: string; status: string } }>
  scanCancel?(input: { jobId: string }): Promise<{ job: { id: string; status: string } }>
  searchCancel?(): Promise<{ cancelled: boolean }>
  searchQuery(input: SearchQueryInput): Promise<{ result: SearchResult }>
  directoryChildren(input: {
    libraryId: string
    directory: string
    limit?: number
    offset?: number
    sort?: SearchSort
  }): Promise<{ result: {
    hits: SearchHit[]
    total: number
    hasMore: boolean
    nextCursor?: string
    elapsedMs: number
  } }>
  rulesList(): Promise<{ ruleSets: RuleSetSummary[] }>
  rulesGet(input: { id: string }): Promise<{ ruleSet: RuleSetSummary }>
  rulesCreate(input: RuleSetCreateInput): Promise<{ ruleSet: RuleSetSummary }>
  rulesUpdate(input: { id: string; patch: RuleSetPatchInput }): Promise<{ ruleSet: RuleSetSummary }>
  rulesDelete(input: { id: string }): Promise<{ ok: true }>
  rulesEnable(input: { id: string; enabled: boolean }): Promise<{ ruleSet: RuleSetSummary }>
  rulesPriority(input: { id: string; priority: number }): Promise<{ ruleSet: RuleSetSummary }>
  rulesClone(input: { sourceId: string; name?: string; priority?: number; enabled?: boolean }): Promise<{ ruleSet: RuleSetSummary }>
  rulesExport(input: { id: string }): Promise<{ yaml: string; path: string | null }>
  rulesImport(): Promise<{ ruleSet: RuleSetSummary } | null>
  rulesPreview(input: PlanScopeInput & {
    libraryId: string
    ruleSetId: string
    collision?: Collision
  }): Promise<{ plan: ChangePlan }>
  renamePreview(input: PlanScopeInput & {
    libraryId: string
    template: string
    collision?: Collision
  }): Promise<{ plan: ChangePlan }>
  planExecute(input: {
    libraryId: string
    plan: ChangePlan
    selectedOps?: number[]
  }): Promise<{
    jobId: string
    status: string
    total: number
    ok: number
    skipped: number
    failed: number
    errors: string[]
  }>
  planRollback(input: { jobId: string }): Promise<{
    jobId: string
    status: string
    ok: number
    skipped: number
    failed: number
    errors: string[]
  }>
  jobsList(input?: { libraryId?: string; limit?: number }): Promise<{ jobs: JobRecord[] }>
  jobOps(input: { jobId: string }): Promise<{ ops: JobOpRecord[] }>
  duplicatesAnalyze(input: {
    libraryId: string
    scope?: DuplicateScope
    entryIds?: string[]
    directory?: string
    filter?: string
    hashStrategy?: DuplicateHashStrategy
    keepStrategy?: KeepStrategy
    dispose?: 'quarantine' | 'delete'
  }): Promise<{ groups: DuplicateGroup[]; plan: ChangePlan }>
  shellReveal(input: { path: string }): Promise<{ ok: true }>
  shellOpen(input: { path: string }): Promise<{ ok: true }>
  clipboardWriteText(input: { text: string }): Promise<{ ok: true }>
  fileRename?(input: { libraryId: string; path: string; name: string }): Promise<{ ok: true }>
  fileMove?(input: { libraryId: string; path: string; directory: string }): Promise<{ ok: true }>
  fileDelete?(input: { libraryId: string; path: string }): Promise<{ ok: true }>
  logEvent?(event: string, details?: unknown): Promise<{ ok: true }>
  previewFile?(input: { path: string }): Promise<FilePreview>
  previewThumbnail?(
    input: Omit<ThumbnailPreviewRequest, 'requestId'>,
    options?: { signal?: AbortSignal },
  ): Promise<ThumbnailPreviewResult>
}

export type NestifyAPI = NestifyApi

export function getNestifyApi(): NestifyApi | null {
  return window.nestify ?? null
}

export async function callNestify<T>(fn: (api: NestifyApi) => Promise<T>): Promise<T> {
  const api = getNestifyApi()
  if (!api) {
    throw new Error('Nestify IPC 未就绪。请从 Electron 启动，而不是单独打开网页。')
  }
  return fn(api)
}
