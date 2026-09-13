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
  const candidateIdSet = new Set(candidateEntryIds);
  const groups = normalizeRenameGroups(input.groups, input.template);
  if (groups.length <= 1) {
    const group = groups[0];
    const groupEntries = group?.filter
      ? filterEntriesBySearch(entries, db, input.libraryId, group.filter)
      : entries;
    const groupCandidateEntryIds = groupEntries
      .map((entry) => entry.id)
      .filter((id) => candidateIdSet.has(id));
    return planRename({
      libraryId: input.libraryId,
      entries: allEntries,
      candidateEntryIds: groupCandidateEntryIds,
      template: group?.template ?? input.template,
      match: input.match,
      target: inferRenameTarget(input.filter, group?.filter),
      collision: input.collision,
      libraryRoot: library.roots[0],
    });
  }

  // Rule groups are an OR inside the outer scope. Build the complete match
  // set first, then assign overlapping entries by group order so every group
  // gets a chance to contribute a preview operation.
  const groupMatches = groups.map((group) => {
    const matched = group.filter
      ? filterEntriesBySearch(entries, db, input.libraryId, group.filter)
      : entries;
    return new Set(
      matched
        .map((entry) => entry.id)
        .filter((id) => candidateIdSet.has(id)),
    );
  });
  const matchedByAnyGroup = new Set(groupMatches.flatMap((ids) => [...ids]));
  const remaining = new Set(matchedByAnyGroup);
  const mergedOps: ChangePlan['ops'] = [];
  let firstPlan: ChangePlan | null = null;
  for (const [groupIndex, group] of groups.entries()) {
    if (remaining.size === 0) break;
    const groupIds = [...(groupMatches[groupIndex] ?? [])].filter((id) => remaining.has(id));
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
    const expressionKinds = possibleExpressionKinds(parsed.expression);
    if (expressionKinds === null) {
      kinds.add("dir");
      kinds.add("file");
    } else {
      if (expressionKinds.has("dir")) kinds.add("dir");
      if (expressionKinds.has("file")) kinds.add("file");
    }
    const parsedKind = parsed.kind;
    if (!parsed.expression) {
      if (parsed.folderName) kinds.add("dir");
      if (parsed.fileName) kinds.add("file");
    }
    if (parsedKind && !parsed.expression) {
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

function possibleExpressionKinds(node: SearchBooleanNode | undefined): Set<"file" | "dir"> | null {
  if (!node) return null;
  const allKinds = (): Set<"file" | "dir"> => new Set<"file" | "dir">(["file", "dir"]);
  if (node.type === "text") return null;
  if (node.type === "filter") {
    if (node.field === "folder_name") return new Set(["dir"] as const);
    if (node.field === "file_name") return new Set(["file"] as const);
    if (node.field !== "kind" && node.field !== "type") return null;
    const kinds = new Set<"file" | "dir">();
    for (const value of node.values) {
      if (value.trim().toLowerCase() === "dir" || value.trim().toLowerCase() === "folder") kinds.add("dir");
      else kinds.add("file");
    }
    return kinds;
  }
  if (node.type === "not") {
    // A negated name predicate can match the opposite entry type as well as
    // entries of the predicate's own type, so it must not narrow the target.
    // Exact media kinds (for example, video) have the same property: their
    // complement still includes other files. Only broad file/dir predicates
    // have a reliable complement for planner target inference.
    if (!isReliableKindComplement(node.child)) return null;
    const child = possibleExpressionKinds(node.child);
    if (!child) return null;
    return new Set((["file", "dir"] as const).filter((kind) => !child.has(kind)));
  }
  const childKinds = node.children.map((child) => possibleExpressionKinds(child));
  if (node.type === "or") {
    if (childKinds.some((kinds) => !kinds)) return null;
    return new Set(childKinds.flatMap((kinds) => [...(kinds ?? allKinds())]));
  }
  const constrained = childKinds.filter((kinds): kinds is Set<"file" | "dir"> => Boolean(kinds));
  if (constrained.length === 0) return null;
  return new Set((["file", "dir"] as const).filter((kind) => constrained.every((kinds) => kinds.has(kind))));
}

function isReliableKindComplement(node: SearchBooleanNode): boolean {
  if (node.type === "filter") {
    return (node.field === "kind" || node.field === "type") && node.values.every((value) => {
      const normalized = value.trim().toLowerCase();
      return normalized === "file" || normalized === "dir" || normalized === "folder";
    });
  }
  if (node.type === "not" || node.type === "text") return false;
  return node.children.every(isReliableKindComplement);
}
