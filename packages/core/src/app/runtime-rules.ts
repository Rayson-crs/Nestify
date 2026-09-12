import {
  getBuiltinProfile,
  listBuiltinProfiles,
  type CollisionStrategy,
  type MatchTree,
} from "@nestify/rules";
import type { ChangePlan } from "@nestify/shared";
import type { DatabaseSync } from "node:sqlite";
import {
  createRuleSetRecord,
  deleteRuleSetRecord,
  getLibrary,
  getRuleSetRecord,
  listEntries,
  listRuleSetRecords,
  parseRuleSetYaml,
  serializeRuleSet,
  setRuleSetEnabled,
  setRuleSetPriority,
  updateRuleSetRecord,
  type RuleSetCreateInput,
  type RuleSetPatch,
  type RuleSetRecord,
} from "../db/repos/index.ts";
import type { OrganizeScope } from "../modules/types.ts";
import { planRename, planRuleset } from "../plan/planner.ts";
import { previewCandidateEntries, toBuiltinRecord, toRuleSetProfile } from "./runtime-helpers.ts";
import { filterEntriesBySearch } from "./runtime-plans.ts";
import { parseSearchQuery, type SearchBooleanNode } from "../search/parse.ts";

export function listRuntimeRuleSets(db: DatabaseSync): RuleSetRecord[] {
  return [...listBuiltinProfiles().map((profile, index) => toBuiltinRecord(profile, index)), ...listRuleSetRecords(db)].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
  );
}

export function getRuntimeRuleSet(db: DatabaseSync, id: string): RuleSetRecord | undefined {
  const stored = getRuleSetRecord(db, id);
  if (stored) return stored;
  const builtin = getBuiltinProfile(id);
  if (!builtin) return undefined;
  const priority = listBuiltinProfiles().findIndex((profile) => profile.id === builtin.id);
  return {
    ...builtin,
    builtin: true,
    enabled: true,
    priority: priority >= 0 ? priority : Number.MAX_SAFE_INTEGER,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function createRuntimeRuleSet(db: DatabaseSync, input: RuleSetCreateInput): RuleSetRecord {
  if (input.id && getBuiltinProfile(input.id)) {
    throw new Error(`builtin ruleset id is reserved: ${input.id}`);
  }
  return createRuleSetRecord(db, input);
}

export function assertCustomRuleSet(db: DatabaseSync, id: string): void {
  if (getBuiltinProfile(id)) throw new Error(`builtin ruleset is readonly: ${id}`);
  if (!getRuleSetRecord(db, id)) throw new Error(`ruleset not found: ${id}`);
}

export function updateRuntimeRuleSet(db: DatabaseSync, id: string, patch: RuleSetPatch): RuleSetRecord {
  assertCustomRuleSet(db, id);
  return updateRuleSetRecord(db, id, patch);
}

export function deleteRuntimeRuleSet(db: DatabaseSync, id: string): void {
  assertCustomRuleSet(db, id);
  deleteRuleSetRecord(db, id);
}

export function enableRuntimeRuleSet(db: DatabaseSync, id: string, enabled: boolean): RuleSetRecord {
  assertCustomRuleSet(db, id);
  return setRuleSetEnabled(db, id, enabled);
}

export function prioritizeRuntimeRuleSet(db: DatabaseSync, id: string, priority: number): RuleSetRecord {
  assertCustomRuleSet(db, id);
  return setRuleSetPriority(db, id, priority);
}

export function cloneRuntimeRuleSet(
  db: DatabaseSync,
  sourceId: string,
  options: { name?: string; priority?: number; enabled?: boolean } = {},
): RuleSetRecord {
  const source = getRuntimeRuleSet(db, sourceId);
  if (!source) throw new Error(`ruleset not found: ${sourceId}`);
  return createRuleSetRecord(db, {
    ...toRuleSetProfile(source),
    id: undefined,
    name: options.name ?? `${source.name} Copy`,
    priority: options.priority ?? source.priority,
    enabled: options.enabled ?? true,
  });
}

export function exportRuntimeRuleSet(db: DatabaseSync, id: string): string {
  const source = getRuntimeRuleSet(db, id);
  if (!source) throw new Error(`ruleset not found: ${id}`);
  return serializeRuleSet(toRuleSetProfile(source));
}

export function importRuntimeRuleSet(db: DatabaseSync, yaml: string): RuleSetRecord {
  const profile = parseRuleSetYaml(yaml);
  const requestedId = getRuleSetRecord(db, profile.id) || getBuiltinProfile(profile.id) ? undefined : profile.id;
  return createRuleSetRecord(db, {
    ...profile,
    id: requestedId,
  });
}

export function previewRuntimeRules(
  db: DatabaseSync,
  quarantineDir: string,
  input: {
    libraryId: string;
    ruleSetId: string;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
  },
): ChangePlan {
  const library = getLibrary(db, input.libraryId);
  if (!library) throw new Error(`library not found: ${input.libraryId}`);
  const profile = getRuntimeRuleSet(db, input.ruleSetId);
  if (!profile) throw new Error(`ruleset not found: ${input.ruleSetId}`);
  if (!profile.enabled) throw new Error(`ruleset is disabled: ${input.ruleSetId}`);
  const entries = listEntries(db, input.libraryId);
  const candidateEntryIds = previewCandidateEntries(entries, input).map((entry) => entry.id);
  return planRuleset({
    libraryId: input.libraryId,
    entries,
    candidateEntryIds,
    ruleSet: profile,
    collision: input.collision,
    libraryRoot: library.roots[0],
    quarantineDir,
  });
}

export function previewRuntimeRename(
  db: DatabaseSync,
  input: {
    libraryId: string;
    template: string;
    groups?: Array<{ filter?: string; template: string }>;
    match?: MatchTree;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    filter?: string;
    collision?: CollisionStrategy;
  },
): ChangePlan {
  const library = getLibrary(db, input.libraryId);
  if (!library) throw new Error(`library not found: ${input.libraryId}`);
  const allEntries = listEntries(db, input.libraryId);
  const entries = input.filter?.trim()
    ? filterEntriesBySearch(allEntries, db, input.libraryId, input.filter.trim())
    : allEntries;
  const candidateEntryIds = previewCandidateEntries(entries, input).map((entry) => entry.id);
  const groups = normalizeRenameGroups(input.groups, input.template);
  if (groups.length <= 1) {
    return planRename({
      libraryId: input.libraryId,
      entries: allEntries,
      candidateEntryIds,
      template: groups[0]?.template ?? input.template,
      match: input.match,
      target: inferRenameTarget(input.filter, groups[0]?.filter),
      collision: input.collision,
      libraryRoot: library.roots[0],
    });
  }

  const remaining = new Set(candidateEntryIds);
  const mergedOps: ChangePlan['ops'] = [];
  let firstPlan: ChangePlan | null = null;
  for (const group of groups) {
    if (remaining.size === 0) break;
    const remainingEntries = allEntries.filter((entry) => remaining.has(entry.id));
    const matched = group.filter
      ? filterEntriesBySearch(remainingEntries, db, input.libraryId, group.filter)
      : remainingEntries;
    const groupIds = matched.map((entry) => entry.id).filter((id) => remaining.has(id));
    if (groupIds.length === 0) continue;
    const plan = planRename({
      libraryId: input.libraryId,
      entries: allEntries,
      candidateEntryIds: groupIds,
      template: group.template,
      match: input.match,
      target: inferRenameTarget(input.filter, group.filter),
      collision: input.collision,
      libraryRoot: library.roots[0],
    });
    firstPlan ??= plan;
    mergedOps.push(...plan.ops);
    for (const id of groupIds) remaining.delete(id);
  }

  if (!firstPlan) {
    return planRename({
      libraryId: input.libraryId,
      entries: allEntries,
      candidateEntryIds: [],
      template: groups[0]?.template ?? input.template,
      match: input.match,
      target: inferRenameTarget(input.filter, groups[0]?.filter),
      collision: input.collision,
      libraryRoot: library.roots[0],
    });
  }

  return {
    ...firstPlan,
    ops: mergedOps,
    summary: summarizeRenameOps(mergedOps),
  };
}

function normalizeRenameGroups(
  groups: Array<{ filter?: string; template: string }> | undefined,
  template: string,
): Array<{ filter: string; template: string }> {
  const normalized = (groups ?? [])
    .map((group) => ({
      filter: group.filter?.trim() ?? '',
      template: group.template.trim(),
    }))
    .filter((group) => group.template.length > 0);
  if (normalized.length > 0) return normalized;
  const fallback = template.trim();
  return fallback ? [{ filter: '', template: fallback }] : [];
}

function summarizeRenameOps(ops: ChangePlan['ops']): ChangePlan['summary'] {
  const count = (type: ChangePlan['ops'][number]['op']) => ops.filter((op) => op.op === type).length;
  return {
    selected: ops.filter((op) => op.selected).length,
    rename: count('rename'),
    move: count('move'),
    mkdir: count('mkdir'),
    quarantine: count('quarantine'),
    delete: count('delete'),
    flatten: count('flatten'),
    conflicts: ops.filter((op) => op.risk !== 'none').length,
  };
}

export function inferRenameTarget(
  ...filters: Array<string | undefined>
): "file" | "dir" | "all" {
  const kinds = new Set<string>();
  for (const filter of filters) {
    const text = filter?.trim();
    if (!text) continue;
    const parsed = parseSearchQuery(text);
    collectKindHints(kinds, parsed.expression);
    const parsedKind = parsed.kind;
    if (parsedKind) {
      for (const kind of parsedKind.split("|")) {
        const normalized = kind.trim().toLowerCase();
        if (normalized) kinds.add(normalized);
      }
    }
  }
  const wantsDir = [...kinds].some((kind) => kind === "dir" || kind === "folder");
  const wantsFile = [...kinds].some((kind) => kind !== "dir" && kind !== "folder");
  if (wantsDir && !wantsFile) return "dir";
  if (wantsDir && wantsFile) return "all";
  return "file";
}

function collectKindHints(kinds: Set<string>, node: SearchBooleanNode | undefined): void {
  if (!node) return;
  if (node.type === "and" || node.type === "or") {
    for (const child of node.children) collectKindHints(kinds, child);
    return;
  }
  if (node.type === "filter" && (node.field === "kind" || node.field === "type")) {
    for (const value of node.values) {
      const normalized = value.trim().toLowerCase();
      if (normalized) kinds.add(normalized);
    }
  }
}
