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

export type ScanProgress = {
  phase: string
  filesScanned: number
  dirsScanned: number
  bytesScanned: number
  currentPath?: string
  errors: number
  filesPerSecond?: number
}

export type RuleSetSummary = {
  id: string
  name: string
  description?: string
  dryRunDefault: boolean
  collision: Collision | string
  rules: Array<{
    id: string
    enabled: boolean
    priority: number
    action: string
    template?: string
  }>
}

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
  searchQuery(input: { libraryId: string; text: string; limit?: number }): Promise<{ result: SearchResult }>
  rulesList(): Promise<{ ruleSets: RuleSetSummary[] }>
  rulesPreview(input: {
    libraryId: string
    ruleSetId: string
    collision?: Collision
  }): Promise<{ plan: ChangePlan }>
  renamePreview(input: {
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
    keepStrategy?: 'newest' | 'oldest' | 'shortest_path'
  }): Promise<{ groups: DuplicateGroup[]; plan: ChangePlan }>
  shellReveal(input: { path: string }): Promise<{ ok: true }>
  shellOpen(input: { path: string }): Promise<{ ok: true }>
  previewFile?(input: { path: string }): Promise<FilePreview>
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
