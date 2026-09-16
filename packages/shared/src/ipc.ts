import type { EntryId, JobId, LibraryId, PlanId, RuleId, RuleSetId } from './ids.ts';
import type { Entry } from './entry.ts';
import type { Library, LibraryCreateInput, LibraryPatch } from './library.ts';
import type { SearchQuery, SearchResult } from './search.ts';
import type { Rule, RuleSet } from './rule.ts';
import type { ChangePlan, PlanExecuteRequest, PlanOpType, PlanPreviewRequest, PlanRollbackRequest } from './plan.ts';
import type { Job, JobProgress, PlanExecutionProgress } from './job.ts';
import type { DuplicateAnalyzeRequest, DuplicateAnalyzeResult } from './hash.ts';
import type { ThumbnailRequest, ThumbnailResult } from './preview.ts';
import type { ConflictStrategy } from './rule.ts';

export const IPC_CHANNELS = {
  libraryList: 'library.list',
  libraryAdd: 'library.add',
  libraryUpdate: 'library.update',
  libraryRemove: 'library.remove',
  scanStart: 'scan.start',
  scanPause: 'scan.pause',
  scanResume: 'scan.resume',
  scanCancel: 'scan.cancel',
  scanProgress: 'scan.progress',
  searchQuery: 'search.query',
  rulesList: 'rules.list',
  rulesPreview: 'rules.preview',
  rulesExecute: 'rules.execute',
  duplicatesAnalyze: 'duplicates.analyze',
  planPreview: 'plan.preview',
  planExecute: 'plan.execute',
  planRollback: 'plan.rollback',
  organizeSnapshot: 'organize.snapshot',
  organizePreview: 'organize.preview',
  previewThumbnail: 'preview.thumbnail',
  shellReveal: 'shell.reveal',
  shellOpen: 'shell.open',
  shellTrash: 'shell.trash',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface ScanStartRequest {
  libraryId: LibraryId;
  mode?: 'fast' | 'standard' | 'deep';
  resume?: boolean;
}

export interface ScanControlRequest {
  jobId: JobId;
}

export interface ScanProgressEvent {
  jobId: JobId;
  libraryId: LibraryId;
  progress: JobProgress;
  status: Job['status'];
}

export interface RulesPreviewRequest {
  libraryId: LibraryId;
  ruleSetId?: RuleSetId;
  ruleIds?: RuleId[];
  query?: SearchQuery;
  dryRun?: boolean;
}

export interface RulesExecuteRequest {
  libraryId: LibraryId;
  planId?: PlanId;
  ruleSetId?: RuleSetId;
  collision?: ConflictStrategy;
  dryRun?: boolean;
}

export type OrganizeScope = 'library' | 'directory' | 'selection';
export type OrganizeRisk = 'low' | 'conflict' | 'overwrite' | 'destructive';
export type OrganizeStage = 'directory' | 'location' | 'name' | 'safety';
export type OrganizeRuleAction = 'move' | 'rename_file' | 'rename_dir' | 'flatten_dir' | 'delete_to_quarantine';
export interface OrganizeRuleStep {
  id: string;
  action: OrganizeRuleAction;
  template?: string;
}
export interface OrganizeRuleInput {
  id: string;
  name: string;
  enabled: boolean;
  /** 兼容旧调用方；新页面用数组顺序表达优先级。 */
  priority?: number;
  target?: 'files' | 'directories' | 'both';
  scope?: 'current' | 'descendants' | 'all';
  /** 与搜索输入助手相同的可读条件表达式。 */
  filter?: string;
  /** 命中后是否继续检查后面的规则。 */
  continueMatching?: boolean;
  action: OrganizeRuleAction;
  match?: unknown;
  template?: string;
  reason?: string;
  /** 同一条规则内按顺序执行的动作；后一步读取前一步更新后的虚拟路径。 */
  steps?: OrganizeRuleStep[];
}
export interface OrganizeSnapshot {
  id: string;
  version: 1;
  createdAt: number;
  libraryId: LibraryId;
  scope: OrganizeScope;
  directory?: string;
  entryIds: EntryId[];
  entries: Entry[];
  fingerprint: string;
  stats: {
    total: number;
    files: number;
    directories: number;
    selected: number;
    selectedFiles: number;
    selectedDirectories: number;
    maxDepth: number;
  };
}
export interface OrganizePreviewRow {
  index: number;
  entryId?: EntryId;
  objectType: 'file' | 'directory' | 'plan';
  stage: OrganizeStage;
  from: string;
  to?: string;
  action: PlanOpType;
  ruleId?: RuleId;
  reason: string;
  explanation: string;
  risk: OrganizeRisk;
  selected: boolean;
}
export interface OrganizePreview {
  snapshot: OrganizeSnapshot;
  /** 第 2 步范围筛选后的完整对象 ID 集合，不受预览操作数量影响。 */
  candidateEntryIds: EntryId[];
  plan: ChangePlan;
  rows: OrganizePreviewRow[];
  summary: ChangePlan['summary'];
}
export interface OrganizeSnapshotRequest {
  libraryId: LibraryId;
  scope?: OrganizeScope;
  entryIds?: EntryId[];
  directory?: string;
}
export interface OrganizePreviewRequest extends OrganizeSnapshotRequest {
  rules: OrganizeRuleInput[];
  snapshotId?: string;
  filter?: string;
  collision?: ConflictStrategy;
}

export interface ShellPathRequest {
  path: string;
  entryId?: EntryId;
}

export interface ShellOkResponse {
  ok: true;
}

export interface IpcRequestMap {
  [IPC_CHANNELS.libraryList]: Record<string, never>;
  [IPC_CHANNELS.libraryAdd]: LibraryCreateInput;
  [IPC_CHANNELS.libraryUpdate]: { id: LibraryId; patch: LibraryPatch };
  [IPC_CHANNELS.libraryRemove]: { id: LibraryId };
  [IPC_CHANNELS.scanStart]: ScanStartRequest;
  [IPC_CHANNELS.scanPause]: ScanControlRequest;
  [IPC_CHANNELS.scanResume]: ScanControlRequest;
  [IPC_CHANNELS.scanCancel]: ScanControlRequest;
  [IPC_CHANNELS.scanProgress]: ScanControlRequest;
  [IPC_CHANNELS.searchQuery]: { query: SearchQuery };
  [IPC_CHANNELS.rulesList]: { libraryId?: LibraryId };
  [IPC_CHANNELS.rulesPreview]: RulesPreviewRequest;
  [IPC_CHANNELS.rulesExecute]: RulesExecuteRequest;
  [IPC_CHANNELS.duplicatesAnalyze]: DuplicateAnalyzeRequest;
  [IPC_CHANNELS.planPreview]: PlanPreviewRequest;
  [IPC_CHANNELS.planExecute]: PlanExecuteRequest;
  [IPC_CHANNELS.planRollback]: PlanRollbackRequest;
  [IPC_CHANNELS.organizeSnapshot]: OrganizeSnapshotRequest;
  [IPC_CHANNELS.organizePreview]: OrganizePreviewRequest;
  [IPC_CHANNELS.previewThumbnail]: ThumbnailRequest;
  [IPC_CHANNELS.shellReveal]: ShellPathRequest;
  [IPC_CHANNELS.shellOpen]: ShellPathRequest;
  [IPC_CHANNELS.shellTrash]: ShellPathRequest;
}

export interface IpcResponseMap {
  [IPC_CHANNELS.libraryList]: { libraries: Library[] };
  [IPC_CHANNELS.libraryAdd]: { library: Library };
  [IPC_CHANNELS.libraryUpdate]: { library: Library };
  [IPC_CHANNELS.libraryRemove]: { id: LibraryId };
  [IPC_CHANNELS.scanStart]: { job: Job };
  [IPC_CHANNELS.scanPause]: { job: Job };
  [IPC_CHANNELS.scanResume]: { job: Job };
  [IPC_CHANNELS.scanCancel]: { job: Job };
  [IPC_CHANNELS.scanProgress]: ScanProgressEvent;
  [IPC_CHANNELS.searchQuery]: { result: SearchResult };
  [IPC_CHANNELS.rulesList]: { rules: Rule[]; ruleSets: RuleSet[] };
  [IPC_CHANNELS.rulesPreview]: { plan: ChangePlan };
  [IPC_CHANNELS.rulesExecute]: { job: Job; plan: ChangePlan };
  [IPC_CHANNELS.duplicatesAnalyze]: DuplicateAnalyzeResult;
  [IPC_CHANNELS.planPreview]: { plan: ChangePlan };
  [IPC_CHANNELS.planExecute]: { job: Job };
  [IPC_CHANNELS.planRollback]: { job: Job };
  [IPC_CHANNELS.organizeSnapshot]: { snapshot: OrganizeSnapshot };
  [IPC_CHANNELS.organizePreview]: { preview: OrganizePreview };
  [IPC_CHANNELS.previewThumbnail]: ThumbnailResult;
  [IPC_CHANNELS.shellReveal]: ShellOkResponse;
  [IPC_CHANNELS.shellOpen]: ShellOkResponse;
  [IPC_CHANNELS.shellTrash]: ShellOkResponse;
}

export type PlanExecutionProgressEvent = PlanExecutionProgress;

export type IpcRequest<C extends IpcChannel> = IpcRequestMap[C];
export type IpcResponse<C extends IpcChannel> = IpcResponseMap[C];
