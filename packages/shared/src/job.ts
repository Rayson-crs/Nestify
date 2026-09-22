import type { EntryId, JobId, LibraryId, PlanId, RuleId, RuleSetId } from './ids.ts';
import type { PlanOpType, PlanRisk } from './plan.ts';
import type { ModuleId } from './modules.ts';

export const JOB_KINDS = [
  'scan',
  'library-remove',
  'search',
  'duplicates',
  'rules-preview',
  'plan-execute',
  'plan-rollback',
  'preview',
  'media-merge',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  'queued',
  'running',
  'paused',
  'cancelling',
  'cancelled',
  'completed',
  'failed',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_OP_STATUSES = ['pending', 'running', 'ok', 'skipped', 'failed'] as const;
export type JobOpStatus = (typeof JOB_OP_STATUSES)[number];

export type ExecutionModule = 'rules' | 'organize' | 'rename' | 'duplicates';

export interface PlanExecutionProgress {
  module: ExecutionModule;
  status: 'running' | 'completed' | 'failed';
  current: number;
  total: number;
  ok: number;
  skipped: number;
  failed: number;
  path: string | null;
}

export interface LibraryRemovalProgress {
  jobId: JobId;
  libraryId: LibraryId;
  libraryName: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  current: number;
  total: number;
  stage: string;
  error: string | null;
}

export interface Job {
  id: JobId;
  libraryId: LibraryId | null;
  kind: JobKind;
  moduleId: ModuleId;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  planId: PlanId | null;
  ruleSetId: RuleSetId | null;
  message: string | null;
  error: string | null;
  progress: JobProgress;
}

export interface JobProgress {
  current: number;
  total: number;
  bytes: number;
  path: string | null;
  errors: number;
  etaMs: number | null;
}

export interface JobOp {
  jobId: JobId;
  seq: number;
  op: PlanOpType;
  from: string;
  to: string | null;
  entryId: EntryId | null;
  ruleId: RuleId | null;
  reason: string;
  risk: PlanRisk;
  status: JobOpStatus;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface JobRecord {
  id: string;
  libraryId: string | null;
  kind: JobKind;
  status: JobStatus;
  dryRun: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  stats: unknown;
  opStats: {
    total: number;
    ok: number;
    skipped: number;
    failed: number;
  };
}

export interface JobOpsPage {
  ops: JobOpRecord[];
  total: number;
  offset: number;
  limit: number;
}

export interface JobOpRecord {
  jobId: string;
  seq: number;
  op: PlanOpType;
  from: string;
  to: string | null;
  ruleId: string | null;
  status: JobOpStatus;
  risk: PlanRisk;
  reason: string;
  error: string | null;
}
