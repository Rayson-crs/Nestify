import type { ChangePlan, Entry, OrganizeRuleInput } from "@nestify/shared";
import type { CollisionStrategy, OrganizeScope } from "../modules/types.ts";

export interface OrganizeSnapshotStats {
  total: number;
  files: number;
  directories: number;
  selected: number;
  selectedFiles: number;
  selectedDirectories: number;
  maxDepth: number;
}

export interface OrganizeSnapshot {
  id: string;
  version: 1;
  createdAt: number;
  libraryId: string;
  scope: OrganizeScope;
  directory?: string;
  entryIds: string[];
  entries: Entry[];
  fingerprint: string;
  stats: OrganizeSnapshotStats;
}

export type OrganizePreviewStage = "directory" | "location" | "name" | "safety";

export interface OrganizePreviewRow {
  index: number;
  entryId?: string;
  objectType: "file" | "directory" | "plan";
  stage: OrganizePreviewStage;
  from: string;
  to?: string;
  action: ChangePlan["ops"][number]["op"];
  ruleId?: string;
  reason: string;
  explanation: string;
  risk: "low" | "conflict" | "overwrite" | "destructive";
  selected: boolean;
}

export interface OrganizePreview {
  snapshot: OrganizeSnapshot;
  /** 第 2 步范围筛选后的完整对象 ID 集合，不受预览操作数量影响。 */
  candidateEntryIds: string[];
  plan: ChangePlan;
  rows: OrganizePreviewRow[];
  summary: ChangePlan["summary"];
}

export interface OrganizePreviewInput {
  libraryId: string;
  rules?: OrganizeRuleInput[];
  /** @deprecated 仅为旧调用方保留；新整理页面不使用规则页 profile。 */
  profileId?: string;
  scope?: OrganizeScope;
  entryIds?: string[];
  directory?: string;
  collision?: CollisionStrategy;
  filter?: string;
  snapshot?: OrganizeSnapshot;
  now?: number;
}
