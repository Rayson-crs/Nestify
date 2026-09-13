export const MODULE_IDS = [
  'scan',
  'search',
  'duplicates',
  'rename',
  'preview',
  'organize',
] as const

export type ModuleId = (typeof MODULE_IDS)[number]

export type CollisionStrategy = 'suffix' | 'skip' | 'overwrite'
export type KeepStrategy =
  | 'newest'
  | 'oldest'
  | 'shortest_path'
  | 'longest_path'
  | 'shortest_name'
  | 'longest_name'
  | 'name_quality'
  | 'preferred_dir'
export type ScanMode = 'fast' | 'deep'
export type HashStrategy = 'off' | 'on-demand' | 'duplicate-candidate-only' | 'all'
export type OrganizeScope = 'library' | 'directory' | 'selection'
export type ActiveScanJobStatus = 'running' | 'paused' | 'cancelling'

export interface ModuleContext {
  libraryId: string
  libraryRoot?: string
  dbPath?: string
  abortSignal?: AbortSignal
  pauseGate?: PauseGate
  onProgress?: (progress: ScanProgress) => void
  concurrency?: number
}

export interface PauseGate {
  pause(): void
  resume(): void
  cancel(): void
  isPaused(): boolean
  waitWhilePaused(signal?: AbortSignal): Promise<void>
}

export interface ScanRequest {
  roots: string[]
  mode?: ScanMode
  incremental?: boolean
  hashStrategy?: HashStrategy
  excludes?: string[]
}

export interface ScanResult {
  filesScanned: number
  dirsScanned: number
  errors: number
  errorDetails?: ScanErrorDetail[]
  errorSummary?: Record<string, number>
}

export interface ScanErrorDetail {
  path: string
  operation: 'stat' | 'readdir' | 'upsert' | 'worker'
  message: string
  code?: string
}

export interface ScanProgress {
  phase: 'walk' | 'upsert' | 'idle' | 'cancelled'
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

export interface SearchRequest {
  query: string
  limit?: number
  offset?: number
  debounceMs?: number
  kinds?: string[]
}

export interface DuplicateAnalyzeRequest {
  scope?: OrganizeScope
  entryIds?: string[]
  directory?: string
  hashStrategy?: Exclude<HashStrategy, 'off'>
  keepStrategy?: KeepStrategy
}

export interface RenamePreviewGroup {
  filter?: string
  template: string
}

export interface RenamePreviewRequest {
  template: string
  groups?: RenamePreviewGroup[]
  match?: unknown
  scope?: OrganizeScope
  entryIds?: string[]
  directory?: string
  filter?: string
  collision?: CollisionStrategy
}

export interface OrganizeRequest {
  rules?: import('@nestify/shared').OrganizeRuleInput[]
  /** @deprecated migration compatibility for callers from the old ruleset flow. */
  profileId?: string
  snapshotId?: string
  scope?: OrganizeScope
  entryIds?: string[]
  directory?: string
  dryRun?: boolean
  collision?: CollisionStrategy
}

export interface ThumbnailRequest {
  entryId: string
  kind?: 'image' | 'video'
  width?: number
  height?: number
  priority?: 'selected' | 'visible' | 'background'
}

export interface ModuleDefinition<TController> {
  id: ModuleId
  createController(): TController
}

export function notImplemented(op = 'execute'): Promise<never> {
  return Promise.reject(new Error('not_implemented'))
}
