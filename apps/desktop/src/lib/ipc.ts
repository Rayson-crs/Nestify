export type Collision = 'suffix' | 'skip' | 'overwrite'
export type CollisionStrategy = Collision

export type LibrarySummary = {
  id: string
  name: string
  roots: string[]
  updatedAt?: number
}

export type SearchHit = {
  entryId: string
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
  elapsedMs: number
}

export type SearchScope = 'library' | 'directory' | 'selection'
export type SearchSortField = 'relevance' | 'mtime' | 'size' | 'path' | 'name'
export type SearchSort = {
  field: SearchSortField
  direction?: 'asc' | 'desc'
}
export type SearchQueryInput = {
  libraryId: string
  text: string
  limit?: number
  offset?: number
  kinds?: string[]
  scope?: SearchScope
  directory?: string
  entryIds?: string[]
  sort?: SearchSort
}

export type ScanProgress = {
  phase: string
  paused?: boolean
  filesScanned: number
  dirsScanned: number
  bytesScanned: number
  currentPath?: string
  errors: number
  filesPerSecond?: number
}

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
}

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

export type PlanOp = {
  op: string
  from: string
  to: string | null
  reason: string
  risk: string
  selected: boolean
  ruleId: string | null
}

export type ChangePlan = {
  id: string
  dryRun: boolean
  collision: Collision | string
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
  libraryId: string
  entryId: string
  kind?: 'image' | 'video'
  width?: number
  height?: number
  size?: number
  priority?: 'selected' | 'visible' | 'background'
}

export interface NestifyApi {
  libraryList(): Promise<{ libraries: LibrarySummary[] }>
  libraryAdd(input: { name: string; roots: string[] }): Promise<{ library: LibrarySummary }>
  libraryRemove?(input: { id: string }): Promise<{ ok: true }>
  pickDirectory(): Promise<{ path: string } | null>
  scanStart(input: { libraryId: string }): Promise<{
    job: { id: string; status: string }
    result?: { filesScanned: number; dirsScanned: number; errors: number }
  }>
  scanProgress(): Promise<ScanProgress>
  scanPause?(input: { jobId: string }): Promise<{ job: { id: string; status: string } }>
  scanResume?(input: { jobId: string }): Promise<{ job: { id: string; status: string } }>
  scanCancel?(input: { jobId: string }): Promise<{ job: { id: string; status: string } }>
  searchQuery(input: SearchQueryInput): Promise<{ result: SearchResult }>
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
    hashStrategy?: DuplicateHashStrategy
    keepStrategy?: KeepStrategy
  }): Promise<{ groups: DuplicateGroup[]; plan: ChangePlan }>
  shellReveal(input: { path: string }): Promise<{ ok: true }>
  shellOpen(input: { path: string }): Promise<{ ok: true }>
  previewFile?(input: { path: string }): Promise<FilePreview>
  previewThumbnail?(input: ThumbnailPreviewRequest): Promise<ThumbnailPreviewResult>
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
import type { JobOpRecord, JobRecord } from '@nestify/shared'
