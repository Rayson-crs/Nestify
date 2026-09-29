import { asEntryId, type ChangePlan, type Entry, type OrganizeRuleInput } from "@nestify/shared";
import { planRuleset } from "../plan/planner.ts";
import { getRuntimeRuleSet } from "../app/runtime-rules.ts";
import type { RuleDefinition, RuleSet } from "@nestify/rules";
import type { DatabaseSync } from "node:sqlite";
import type { OrganizePreview, OrganizePreviewInput, OrganizePreviewRow, OrganizeSnapshot } from "./types.ts";
import { createOrganizeSnapshot } from "./snapshot.ts";
import { filterEntriesBySearch, searchEntryIds } from "../app/runtime-plans.ts";
import { normalizePathKey } from "../rules/context.ts";
import {
  listChildrenByParentIds,
  listEntriesByIds,
  listEntriesByPaths,
  listEntryIdsInDirectory,
} from "../db/repos/index.ts";
import { createSearchCandidateEvaluation, searchEntries } from "../search/query.ts";

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
  const range = input.offset == null && input.limit == null
    ? undefined
    : {
      offset: Math.max(0, Math.trunc(input.offset ?? 0)),
      limit: Math.max(0, Math.trunc(input.limit ?? Number.MAX_SAFE_INTEGER)),
    };
  const candidates = range
    ? []
    : input.filter?.trim()
      ? filterEntriesBySearch(snapshot.entries, db, input.libraryId, input.filter.trim())
      : snapshot.entries.filter((entry) => snapshot.entryIds.length === 0 || snapshot.entryIds.includes(entry.id));
  const fullCandidateEntryIds = range ? undefined : candidates.map((entry) => entry.id);
  const paged = range
    ? pageOrganizeCandidates(
      db,
      input.libraryId,
      snapshot.scope === "selection" ? snapshot.entryIds : undefined,
      ruleSet.rules,
      input.directory,
      range,
      input.filter,
    )
    : undefined;
  const candidateEntryIds = paged?.candidateEntryIds ?? fullCandidateEntryIds ?? [];
  const candidateEntryIdsByRule = paged?.candidateEntryIdsByRule
    ?? (snapshot.entries.length > 0
      ? candidateRulesForEntries(snapshot.entries, ruleSet.rules, input.directory, db, input.libraryId)
      : new Map<string, Set<string>>());
  const basePlanningEntries = range
    ? planningEntriesForPage(db, input.libraryId, snapshot.entries, candidateEntryIds)
    : snapshot.entries.length > 0
      ? snapshot.entries
      : planningEntriesForPage(db, input.libraryId, [], candidateEntryIds);
  const planInput = {
    libraryId: input.libraryId,
    candidateEntryIds,
    ruleSet,
    collision: input.collision,
    libraryRoot,
    quarantineDir,
    candidateEntryIdsByRule,
    seqCursor: input.seqCursor,
    now: input.now,
  };
  const initialPlan = planRuleset({
    ...planInput,
    entries: basePlanningEntries,
  });
  const planningEntries = range
    ? withOrganizeBystanders(db, input.libraryId, basePlanningEntries, initialPlan)
    : basePlanningEntries;
  const plan = planningEntries === basePlanningEntries
    ? initialPlan
    : planRuleset({
      ...planInput,
      entries: planningEntries,
    });
  const pageEntryIds = new Set(candidateEntryIds.map(String));
  const pageSnapshot = paged
    ? {
      ...snapshot,
      entries: planningEntries.filter((entry) => pageEntryIds.has(String(entry.id))),
    }
    : snapshot;
  return {
    snapshot: pageSnapshot,
    candidateEntryIds,
    sourceOffset: paged?.sourceOffset ?? 0,
    sourceCount: paged?.sourceCount ?? candidateEntryIds.length,
    matchedCount: paged?.matchedCount ?? candidateEntryIds.length,
    sourceHasMore: paged?.sourceHasMore ?? false,
    plan,
    rows: toPreviewRows(plan, planningEntries),
    summary: plan.summary,
  };
}

function withOrganizeBystanders(
  db: DatabaseSync,
  libraryId: string,
  entries: readonly Entry[],
  initialPlan: ChangePlan,
): Entry[] {
  const targetPaths = initialPlan.ops
    .map((op) => op.to)
    .filter((path): path is string => Boolean(path));
  const bystanders = listEntriesByPaths(db, libraryId, targetPaths);
  if (bystanders.length === 0) return [...entries];
  const known = new Set(entries.map((entry) => entry.id));
  return [...entries, ...bystanders.filter((entry) => !known.has(entry.id))];
}

function pageOrganizeCandidates(
  db: DatabaseSync,
  libraryId: string,
  candidateEntryIds: readonly string[] | undefined,
  rules: readonly RuleDefinition[],
  directory: string | undefined,
  range: { offset: number; limit: number },
  filter?: string,
): {
  candidateEntryIds: string[];
  candidateEntryIdsByRule: Map<string, Set<string>>;
  sourceOffset: number;
  sourceCount: number;
  matchedCount: number;
  sourceHasMore: boolean;
} {
  const matchesByRule = new Map<RuleDefinition, string[]>();
  const allowed = candidateEntryIds ? new Set(candidateEntryIds) : null;
  const outerFilter = filter?.trim() || "";
  const activeRules = [...rules.filter((rule) => rule.enabled)]
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const rule of activeRules) matchesByRule.set(rule, []);

  const source = outerFilter || candidateEntryIds
    ? searchEntries(db, {
      libraryId,
      text: outerFilter,
      limit: range.limit,
      offset: range.offset,
      scope: candidateEntryIds ? "selection" : directory ? "directory" : "library",
      entryIds: candidateEntryIds ? [...candidateEntryIds] : undefined,
      directory,
      resultMode: "hits-only",
    })
    : null;
  const listing = source
    ? undefined
    : listEntryIdsInDirectory(db, libraryId, directory, range);
  const ids = source
    ? source.hits.map((hit) => hit.entryId)
    : listing!.ids;
  const sourceHasMore = source ? source.hasMore : listing!.hasMore;
  const entriesById = new Map(
    listEntriesByIds(db, ids.map((id) => asEntryId(id))).map((entry) => [String(entry.id), entry]),
  );
  const entries = ids.map((id) => entriesById.get(id)).filter((entry): entry is Entry => Boolean(entry));
  const idSet = new Set(ids);
  let evaluation: ReturnType<typeof createSearchCandidateEvaluation> | undefined;
  const matchedIdsByQuery = new Map<string, Set<string>>();
  for (const rule of activeRules) {
    const query = rule.filter?.trim();
    const matchedIds = query
      ? matchedIdsByQuery.get(query)
        ?? searchEntryIds(db, libraryId, query, ids, directory, evaluation ??= createSearchCandidateEvaluation(db, {
          libraryId,
          directory,
          candidateIds: ids,
          entries,
        }))
      : idSet;
    if (query) matchedIdsByQuery.set(query, matchedIds);
    const matched = matchesByRule.get(rule)!;
    for (const entry of entries) {
      if (entry.tombstone || !matchedIds.has(entry.id)) continue;
      if (allowed && !allowed.has(entry.id)) continue;
      if (!matchesOrganizeScope(entry, directory, rule.target, rule.scope)) continue;
      matched.push(entry.id);
    }
  }

  const selected = selectOrganizePage(matchesByRule, 0, range.limit);
  return {
    ...selected.result,
    sourceOffset: range.offset,
    sourceCount: ids.length,
    matchedCount: selected.result.candidateEntryIds.length,
    sourceHasMore,
  };
}

function selectOrganizePage(
  matchesByRule: ReadonlyMap<RuleDefinition, readonly string[]>,
  offset: number,
  limit: number,
): { result: { candidateEntryIds: string[]; candidateEntryIdsByRule: Map<string, Set<string>> }; matchedCount: number } {
  const needed = offset + limit;
  const candidateEntryIds: string[] = [];
  const candidateSeen = new Set<string>();
  const candidateEntryIdsByRule = new Map<string, Set<string>>();
  const handled = new Set<string>();
  let matchedCount = 0;
  for (const [rule, ids] of matchesByRule) {
    const ruleIds = new Set<string>();
    candidateEntryIdsByRule.set(rule.id, ruleIds);
    for (const id of ids) {
      if (handled.has(id)) continue;
      matchedCount += 1;
      if (matchedCount > offset) {
        if (!candidateSeen.has(id)) {
          candidateSeen.add(id);
          candidateEntryIds.push(id);
        }
        ruleIds.add(id);
      }
      if (rule.continueMatching === false) handled.add(id);
      if (matchedCount >= needed) {
        return { result: { candidateEntryIds, candidateEntryIdsByRule }, matchedCount };
      }
    }
  }
  return { result: { candidateEntryIds, candidateEntryIdsByRule }, matchedCount };
}

function candidateRulesForPage(
  rules: readonly import("@nestify/rules").RuleDefinition[],
  pageIds: readonly string[],
): Map<string, Set<string>> {
  const ids = new Set(pageIds);
  return new Map(rules.filter((rule) => rule.enabled).map((rule) => [rule.id, ids]));
}

function candidateRulesForEntries(
  entries: readonly Entry[],
  rules: readonly import("@nestify/rules").RuleDefinition[],
  directory: string | undefined,
  db: DatabaseSync,
  libraryId: string,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const rule of rules) {
    const ruleEntries = rule.filter?.trim()
      ? filterEntriesBySearch(entries, db, libraryId, rule.filter.trim())
      : entries;
    const scoped = ruleEntries.filter((entry) => matchesOrganizeScope(entry, directory, rule.target, rule.scope));
    result.set(rule.id, new Set(scoped.map((entry) => entry.id)));
  }
  return result;
}

function planningEntriesForPage(
  db: DatabaseSync,
  libraryId: string,
  snapshotEntries: readonly Entry[],
  ids: readonly string[],
): Entry[] {
  const bySnapshot = new Map(snapshotEntries.map((entry) => [String(entry.id), entry]));
  const selected = ids.map((id) => bySnapshot.get(String(id))).filter((entry): entry is Entry => Boolean(entry));
  const missing = ids.filter((id) => !bySnapshot.has(String(id)));
  const loaded = listEntriesByIds(db, missing.map((id) => asEntryId(id)));
  const page = [...selected, ...loaded];
  const known = new Set(page.map((entry) => entry.id));
  const parentIds = page.flatMap((entry) => entry.parentId && !known.has(entry.parentId) ? [entry.parentId] : []);
  const parents = parentIds.map((id) => bySnapshot.get(id)).filter((entry): entry is Entry => Boolean(entry));
  const loadedParents = listEntriesByIds(db, parentIds.filter((id) => !bySnapshot.has(id)).map((id) => asEntryId(id)));
  const directoryIds = page.filter((entry) => entry.isDir).map((entry) => entry.id);
  const children = listChildrenByParentIds(db, libraryId, directoryIds).filter((entry) => !known.has(entry.id));
  return [...page, ...parents, ...loadedParents, ...children];
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
