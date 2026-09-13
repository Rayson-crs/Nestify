import type { DupGroupId, EntryId, LibraryId } from './ids.ts';
import type { Entry } from './entry.ts';

export const HASH_KINDS = ['quick', 'full'] as const;
export type HashKind = (typeof HASH_KINDS)[number];

export type DuplicateAnalysisProgressPhase =
  | 'collecting'
  | 'quick-hash'
  | 'full-hash'
  | 'finalizing';

export interface DuplicateAnalysisProgress {
  status: 'running' | 'completed' | 'failed';
  phase: DuplicateAnalysisProgressPhase;
  phaseCurrent: number;
  phaseTotal: number;
  percent: number;
  path: string | null;
}

export const DUP_KEEP_POLICIES = [
  'newest',
  'oldest',
  'largest',
  'shortest-path',
  'most-informative-name',
  'prefer-library-dir',
  'manual',
] as const;
export type DupKeepPolicy = (typeof DUP_KEEP_POLICIES)[number];

export interface HashRequest {
  libraryId: LibraryId;
  entryIds?: EntryId[];
  kind: HashKind;
}

export interface HashResult {
  entryId: EntryId;
  kind: HashKind;
  hex: string;
}

export interface DuplicateMember {
  entry: Entry;
  keep: boolean;
  reason: string;
}

export interface DuplicateGroup {
  id: DupGroupId;
  libraryId: LibraryId;
  size: number;
  hashQuick: string | null;
  hashFull: string | null;
  wastedBytes: number;
  members: DuplicateMember[];
  keepPolicy: DupKeepPolicy;
}

export interface DuplicateAnalyzeRequest {
  libraryId: LibraryId;
  keepPolicy?: DupKeepPolicy;
  preferDir?: string;
}

export interface DuplicateAnalyzeResult {
  groups: DuplicateGroup[];
  candidateCount: number;
  hashedCount: number;
}
