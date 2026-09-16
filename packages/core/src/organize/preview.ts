import type { ChangePlan, Entry, OrganizeRuleInput } from "@nestify/shared";
import { planRuleset } from "../plan/planner.ts";
import { getRuntimeRuleSet } from "../app/runtime-rules.ts";
import type { RuleDefinition, RuleSet } from "@nestify/rules";
import type { DatabaseSync } from "node:sqlite";
import type { OrganizePreview, OrganizePreviewInput, OrganizePreviewRow, OrganizeSnapshot } from "./types.ts";
import { createOrganizeSnapshot } from "./snapshot.ts";
import { filterEntriesBySearch } from "../app/runtime-plans.ts";
import { normalizePathKey } from "../rules/context.ts";

export function previewOrganize(
  db: DatabaseSync,
  quarantineDir: string,
  input: OrganizePreviewInput,
  entries: readonly Entry[],
  libraryRoot: string,
): OrganizePreview {
  const snapshot = input.snapshot ?? createOrganizeSnapshot({
    libraryId: input.libraryId,
    entries,
    scope: input.scope,
    entryIds: input.entryIds,
    directory: input.directory,
    now: input.now,
  });
  if (snapshot.libraryId !== input.libraryId) throw new Error("organize snapshot belongs to another library");
  const ruleSet = input.rules
    ? toAdhocRuleSet(input.rules, input.collision)
    : input.profileId
      ? getLegacyRuleSet(db, input.profileId)
      : toAdhocRuleSet([], input.collision);
  const candidates = input.filter?.trim()
    ? filterEntriesBySearch(snapshot.entries, db, input.libraryId, input.filter.trim())
    : snapshot.entries.filter((entry) => snapshot.entryIds.some((id) => id === entry.id));
  const candidateIds = new Set(candidates.map((entry) => entry.id));
  const candidateEntryIdsByRule = new Map<string, Set<string>>();
  for (const rule of ruleSet.rules) {
    const ruleEntries = rule.filter?.trim()
      ? filterEntriesBySearch(snapshot.entries, db, input.libraryId, rule.filter.trim())
      : snapshot.entries;
    const scoped = ruleEntries.filter((entry) => matchesOrganizeScope(entry, input.directory, rule.target, rule.scope));
    candidateEntryIdsByRule.set(rule.id, new Set(scoped.map((entry) => entry.id)));
  }
  const plan = planRuleset({
    libraryId: input.libraryId,
    entries: snapshot.entries,
    candidateEntryIds: candidates.map((entry) => entry.id),
    ruleSet,
    collision: input.collision,
    libraryRoot,
    quarantineDir,
    candidateEntryIdsByRule,
    now: input.now,
  });
  return {
    snapshot,
    candidateEntryIds: candidates.map((entry) => entry.id),
    plan,
    rows: toPreviewRows(plan, snapshot.entries),
    summary: plan.summary,
  };
}

function matchesOrganizeScope(
  entry: import("@nestify/shared").Entry,
  directory: string | undefined,
  target: OrganizeRuleInput["target"],
  scope: OrganizeRuleInput["scope"],
): boolean {
  const wantsFile = target === undefined || target === "files" || target === "both";
  const wantsDirectory = target === "directories" || target === "both";
  if ((entry.isDir && !wantsDirectory) || (!entry.isDir && !wantsFile)) return false;
  if (!directory || !scope || scope === "all") return true;
  const current = normalizePathKey(directory);
  const parent = normalizePathKey(entry.parentPath ?? "");
  const path = normalizePathKey(entry.path);
  if (scope === "current") return parent === current;
  if (scope === "descendants") return path !== current && path.startsWith(`${current}/`);
  return path === current || path.startsWith(`${current}/`);
}

function toAdhocRuleSet(rules: NonNullable<OrganizePreviewInput["rules"]>, collision?: OrganizePreviewInput["collision"]): RuleSet {
  return {
    id: "organize-session",
    name: "整理会话规则",
    description: "当前整理页面的独立规则草稿",
    dryRunDefault: true,
    collision: collision ?? "suffix",
    rules: rules.map((rule, index): RuleDefinition => ({
      id: rule.id,
      enabled: rule.enabled,
      priority: rule.priority ?? index + 1,
      filter: rule.filter,
      target: rule.target,
      scope: rule.scope,
      action: rule.action,
      match: rule.match as RuleDefinition["match"],
      template: rule.template,
      steps: rule.steps?.map((step) => ({
        id: step.id,
        kind: "action" as const,
        action: step.action,
        template: step.template,
      })),
      reason: rule.reason,
      continueMatching: rule.continueMatching,
    } as RuleDefinition)),
  };
}

function getLegacyRuleSet(db: DatabaseSync, profileId: string): RuleSet {
  const profile = getRuntimeRuleSet(db, profileId);
  if (!profile) throw new Error(`ruleset not found: ${profileId}`);
  if (!profile.enabled) throw new Error(`ruleset is disabled: ${profileId}`);
  return profile;
}

function toPreviewRows(plan: ChangePlan, entries: readonly Entry[]): OrganizePreviewRow[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return plan.ops.map((op, index) => {
    const entry = op.entryId ? byId.get(op.entryId) : undefined;
    const action = op.op;
    return {
      index,
      entryId: op.entryId,
      objectType: entry ? (entry.isDir ? "directory" : "file") : "plan",
      stage: stageFor(action),
      from: op.from,
      to: op.to ?? undefined,
      action,
      ruleId: op.ruleId ?? undefined,
      reason: op.reason,
      explanation: explain(op, entry),
      risk: organizeRisk(op.risk, action),
      selected: op.selected,
    };
  });
}

function stageFor(action: ChangePlan["ops"][number]["op"]): OrganizePreviewRow["stage"] {
  if (action === "rename") return "name";
  if (action === "move" || action === "flatten") return "location";
  if (action === "mkdir") return "directory";
  return "safety";
}

function explain(op: ChangePlan["ops"][number], entry: Entry | undefined): string {
  if (op.op === "mkdir") return `创建目标目录：${op.to ?? op.from}`;
  if (op.op === "quarantine" || op.op === "delete") return "整理不执行直接删除；此动作需要隔离或人工处理";
  const kind = entry?.isDir ? "目录" : "文件";
  return `${kind}由规则「${op.ruleId ?? "未命名规则"}」处理：${op.reason}`;
}

function organizeRisk(
  risk: ChangePlan["ops"][number]["risk"],
  action: ChangePlan["ops"][number]["op"],
): OrganizePreviewRow["risk"] {
  if (action === "quarantine" || action === "delete") return "destructive";
  if (risk === "none") return "low";
  if (risk === "overwrite") return "overwrite";
  return "conflict";
}
