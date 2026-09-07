import type { LibraryId, RuleId, RuleSetId } from './ids.ts';
import type { EntryKind } from './entry.ts';

export const RULE_ACTIONS = [
  'filter',
  'tag',
  'rename_file',
  'rename_dir',
  'move',
  'copy',
  'delete_to_quarantine',
  'flatten_dir',
  'group_into_dir',
  'attach_sidecar_follow',
  'set_parent_name_from_children',
] as const;
export type RuleActionType = (typeof RULE_ACTIONS)[number];

export const CONFLICT_STRATEGIES = ['suffix', 'skip', 'overwrite', 'abort'] as const;
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];

export const MATCH_OPS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'prefix',
  'suffix',
  'regex',
  'in',
  'not_in',
  'empty',
  'not_empty',
  'numeric',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
] as const;
export type MatchOp = (typeof MATCH_OPS)[number];

export const MATCH_FIELDS = [
  'name',
  'stem',
  'ext',
  'parent',
  'grandparent',
  'ancestor',
  'path',
  'relPath',
  'size',
  'mtime',
  'ctime',
  'depth',
  'kind',
  'isDir',
  'children.count',
  'children.fileCount',
  'children.dirCount',
  'children.usefulFileCount',
  'children.videoCount',
  'children.imageCount',
  'children.mainKind',
  'children.mainName',
  'children.mainStem',
  'children.names',
  'children.hasUniqueVideo',
] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];

export type RuleScopeKind = 'library' | 'path-glob' | 'selection';

export interface RuleScope {
  kind: RuleScopeKind;
  libraryId?: LibraryId;
  pathGlobs?: string[];
  entryIds?: string[];
}

export interface MatchAnd {
  all: MatchNode[];
}

export interface MatchOr {
  any: MatchNode[];
}

export interface MatchNot {
  not: MatchNode;
}

export interface MatchPredicate {
  field: MatchField;
  op: MatchOp;
  value?: string | number | boolean | ReadonlyArray<string | number>;
  /** Used when field is ancestor(n). n=1 is parent. */
  n?: number;
}

export type MatchNode = MatchAnd | MatchOr | MatchNot | MatchPredicate;

export type ExtractSource =
  | { from: 'name' | 'stem' | 'ext' | 'parent' | 'grandparent' | 'path' | 'relPath' }
  | { from: 'ancestor'; n: number }
  | { from: 'children.mainStem' | 'children.mainName' | 'children.longestCommonPrefix' }
  | { from: 'regex'; field: MatchField; pattern: string; group?: string | number };

export interface ExtractSpec {
  [captureName: string]: ExtractSource;
}

export interface RuleSafety {
  dryRun?: boolean;
  skipIfTargetExists?: boolean;
  protectGlobs?: string[];
  minConfidence?: number;
  maxAffected?: number;
  allowOverwrite?: boolean;
  requireConfirm?: boolean;
}

export interface Rule {
  id: RuleId;
  name: string;
  enabled: boolean;
  priority: number;
  scope: RuleScope;
  match: MatchNode;
  extract: ExtractSpec;
  action: RuleActionType;
  template: string;
  onConflict: ConflictStrategy;
  safety: RuleSafety;
  stopIfMatched?: boolean;
  tags?: string[];
}

export interface RuleSet {
  id: RuleSetId;
  name: string;
  description: string;
  rules: Rule[];
  defaultCollision: ConflictStrategy;
  dryRunDefault: boolean;
}

export type Profile = RuleSet;
