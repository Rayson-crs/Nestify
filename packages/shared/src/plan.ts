import type { EntryId, JobId, LibraryId, PlanId, RuleId } from './ids.ts';
import type { ConflictStrategy } from './rule.ts';

export const PLAN_OPS = ['rename', 'move', 'mkdir', 'quarantine', 'delete', 'flatten'] as const;
export type PlanOpType = (typeof PLAN_OPS)[number];

export const PLAN_RISKS = [
  'none',
  'overwrite',
  'long_path',
  'occupied',
  'network',
  'ambiguous',
  'illegal_name',
  'protected',
  'out_of_library',
  'case_conflict',
] as const;
export type PlanRisk = (typeof PLAN_RISKS)[number];

export const PLAN_STATUSES = ['draft', 'validated', 'confirmed', 'executing', 'completed', 'failed', 'rolled_back'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface PlanOp {
  op: PlanOpType;
  from: string;
  to: string | null;
  entryId?: EntryId;
  ruleId: RuleId | null;
  reason: string;
  risk: PlanRisk;
  confidence: number;
  selected: boolean;
}

export interface ChangePlan {
  id: PlanId;
  libraryId: LibraryId;
  jobId?: JobId;
  createdAt: number;
  status: PlanStatus;
  collision: ConflictStrategy;
  dryRun: boolean;
  ops: PlanOp[];
  summary: PlanSummary;
}

export interface PlanSummary {
  selected: number;
  rename: number;
  move: number;
  mkdir: number;
  quarantine: number;
  delete: number;
  flatten: number;
  conflicts: number;
}

export interface PlanPreviewRequest {
  libraryId: LibraryId;
  ruleSetId?: string;
  ruleIds?: string[];
  scopePath?: string;
  dryRun?: boolean;
  collision?: ConflictStrategy;
}

export interface PlanExecuteRequest {
  planId: PlanId;
  selectedOnly?: boolean;
  collision?: ConflictStrategy;
}

export interface PlanRollbackRequest {
  planId: PlanId;
  jobId?: JobId;
}
