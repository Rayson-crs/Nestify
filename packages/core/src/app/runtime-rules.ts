import {
  getBuiltinProfile,
  listBuiltinProfiles,
  type CollisionStrategy,
  type MatchTree,
} from "@nestify/rules";
import { asEntryId, type ChangePlan, type PagedChangePlan } from "@nestify/shared";
import type { DatabaseSync } from "node:sqlite";
import {
  createRuleSetRecord,
  deleteRuleSetRecord,
  getLibrary,
  getRuleSetRecord,
  listEntries,
  listEntriesByIds,
  listEntriesByPaths,
  listChildrenByParentIds,
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
import { isWithinPreviewDirectory, isWithinRoot, normalizePreviewPath, previewCandidateEntries, toBuiltinRecord, toRuleSetProfile } from "./runtime-helpers.ts";
import { searchEntryIds } from "./runtime-plans.ts";
import { parseSearchQuery, type SearchBooleanNode } from "../search/parse.ts";
import { createSearchCandidateEvaluation, listDirectoryChildren, searchEntries } from "../search/query.ts";

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
    offset?: number;
    limit?: number;
    seqCursor?: import("@nestify/shared").PlanSeqCursor;
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
    offset?: number;
    limit?: number;
    seqCursor?: import("@nestify/shared").PlanSeqCursor;
    collision?: CollisionStrategy;
  },
): PagedChangePlan {
  if (input.scope === "selection" && (input.entryIds?.length ?? 0) === 0) {
    throw new Error("selection scope requires at least one entryId");
  }
  if (input.scope === "directory" && !input.directory?.trim()) {
    throw new Error("directory scope requires a directory");
  }
  const library = getLibrary(db, input.libraryId);
  if (!library) throw new Error(`library not found: ${input.libraryId}`);
  const groups = normalizeRenameGroups(input.groups, input.template);
  const range = renameRange(input.offset, input.limit) ?? { offset: 0, limit: Number.MAX_SAFE_INTEGER };
  const scopePage = usesRenameScopePage(groups)
    && input.scope === "directory"
    && Boolean(input.directory?.trim())
    && (input.entryIds?.length ?? 0) === 0;
  const target = scopePage
    ? "all"
    : inferRenameTarget(input.filter, ...groups.map((group) => group.filter));
  const page = pageRenameCandidates(
    db,
    input.libraryId,
    groups,
    range,
    input.scope === "directory" ? input.directory : undefined,
    input.filter,
    input.entryIds,
    target,
    library.roots,
    scopePage,
  );
  const basePageEntries = planningEntriesFor(db, input.libraryId, page.orderedIds);
  const buildPlan = (pageEntries: readonly import("@nestify/shared").Entry[]): ChangePlan => {
    if (groups.length <= 1) {
      const group = groups[0];
      return planRename({
      libraryId: input.libraryId,
      entries: pageEntries,
      candidateEntryIds: page.orderedIds,
      candidateRange: { offset: 0, limit: page.orderedIds.length },
      seqCursor: input.seqCursor,
      template: group?.template ?? input.template,
      match: input.match,
      target,
      collision: input.collision,
      libraryRoot: library.roots[0],
      });
    }

    const mergedOps: ChangePlan['ops'] = []
    let firstPlan: ChangePlan | null = null
    let seqCursor = input.seqCursor
    for (const [groupIndex, group] of groups.entries()) {
      const groupIds = page.groupIds[groupIndex] ?? [];
      if (groupIds.length === 0) continue
      const plan = planRename({
        libraryId: input.libraryId,
        entries: pageEntries,
        candidateEntryIds: groupIds,
        seqCursor,
        template: group.template,
        match: input.match,
        target,
        collision: input.collision,
        libraryRoot: library.roots[0],
      })
      firstPlan ??= plan
      seqCursor = plan.seqCursor
      mergedOps.push(...plan.ops)
    }

    if (firstPlan) {
      return {
        ...firstPlan,
        ops: mergedOps,
        summary: summarizeRenameOps(mergedOps),
        seqCursor,
      };
    }
    return planRename({
      libraryId: input.libraryId,
      entries: pageEntries,
      candidateEntryIds: [],
      seqCursor: input.seqCursor,
      template: groups[0]?.template ?? input.template,
      match: input.match,
      target,
      collision: input.collision,
      libraryRoot: library.roots[0],
    });
  };
  const initialPlan = buildPlan(basePageEntries);
  const pageEntries = withRenameBystanders(db, input.libraryId, basePageEntries, initialPlan);
  const plan = pageEntries === basePageEntries
    ? initialPlan
    : buildPlan(pageEntries);
  return withRenamePage(plan, page);
}

function withRenamePage(plan: ChangePlan, page: RenameCandidatePage): PagedChangePlan {
  return {
    ...plan,
    sourceOffset: page.sourceOffset,
    sourceCount: page.sourceCount,
    matchedCount: page.orderedIds.length,
    sourceHasMore: page.sourceHasMore,
  };
}

type RenameCandidatePage = {
  orderedIds: string[];
  groupIds: string[][];
  sourceOffset: number;
  sourceCount: number;
  sourceHasMore: boolean;
};

function withRenameBystanders(
  db: DatabaseSync,
  libraryId: string,
  entries: readonly import("@nestify/shared").Entry[],
  initialPlan: ChangePlan,
): readonly import("@nestify/shared").Entry[] {
  const targetPaths = initialPlan.ops
    .map((op) => op.to)
    .filter((path): path is string => Boolean(path));
  const bystanders = listEntriesByPaths(db, libraryId, targetPaths);
  if (bystanders.length === 0) return entries;
  const known = new Set(entries.map((entry) => entry.id));
  return [...entries, ...bystanders.filter((entry) => !known.has(entry.id))];
}

function planningEntriesFor(
  db: DatabaseSync,
  libraryId: string,
  ids: readonly string[],
): import("@nestify/shared").Entry[] {
  const selected = listEntriesByIds(db, ids);
  const parentIds = selected.flatMap((entry) => entry.parentId ? [entry.parentId] : []);
  const known = new Set(selected.map((entry) => entry.id));
  const parents = listEntriesByIds(db, parentIds).filter((entry) => !known.has(entry.id));
  for (const entry of parents) known.add(entry.id);
  const directoryIds = selected.filter((entry) => entry.isDir).map((entry) => entry.id);
  const children = listChildrenByParentIds(db, libraryId, directoryIds)
    .filter((entry) => !known.has(entry.id));
  return [...selected, ...parents, ...children];
}

function usesRenameScopePage(
  groups: ReadonlyArray<{ filter: string }>,
): boolean {
  return groups.every((group) => !group.filter.trim());
}

function pageRenameCandidates(
  db: DatabaseSync,
  libraryId: string,
  groups: ReadonlyArray<{ filter: string; template: string }>,
  range: { offset: number; limit: number },
  directory?: string,
  filter?: string,
  entryIds?: readonly string[],
  target: "file" | "dir" | "all" = "file",
  libraryRoots: readonly string[] = [],
  scopePage = false,
): RenameCandidatePage {
  const orderedIds: string[] = [];
  const groupIds = groups.map(() => [] as string[]);
  const selectedIds = entryIds?.filter(Boolean);
  const outerFilter = filter?.trim() || "";
  const sourceOffset = range.offset;
  const directoryKey = directory ? normalizePreviewPath(directory) : "";
  const fullSource = range.limit === Number.MAX_SAFE_INTEGER;
  const entriesById = new Map<string, import("@nestify/shared").Entry>();
  const evaluatePage = (ids: readonly string[], limit: number) => {
    entriesById.clear();
    for (const entry of listEntriesByIds(db, ids.map((id) => asEntryId(id)))) {
      entriesById.set(String(entry.id), entry);
    }
    const entries = ids.map((id) => entriesById.get(id)).filter((entry): entry is import("@nestify/shared").Entry => Boolean(entry));
    let evaluation: ReturnType<typeof createSearchCandidateEvaluation> | undefined;
    const groupMatchesByQuery = new Map<string, Set<string>>();
    const groupMatches = groups.map((group) => {
      const query = group.filter.trim();
      if (!query) return null;
      let matched = groupMatchesByQuery.get(query);
      if (!matched) {
        evaluation ??= createSearchCandidateEvaluation(db, {
          libraryId,
          directory,
          candidateIds: ids,
          entries,
        });
        matched = searchEntryIds(db, libraryId, query, ids, directory, evaluation);
        groupMatchesByQuery.set(query, matched);
      }
      return matched;
    });

    for (const entry of entries) {
      const id = String(entry.id);
      for (const [groupIndex, group] of groups.entries()) {
        const query = group.filter.trim();
        if (groupMatches[groupIndex] && !groupMatches[groupIndex]!.has(id)) continue;
        const groupTarget = query || outerFilter || scopePage ? target : (target === "all" ? "file" : target);
        if (directoryKey && !isWithinPreviewDirectory(entry.path, directoryKey)) continue;
        if (!isInsideLibraryRoots(entry.path, libraryRoots)) continue;
        if (directory && normalizePreviewPath(entry.path) === directoryKey && groupTarget === "file") continue;
        if (groupTarget === "dir" && !entry.isDir) continue;
        if (groupTarget === "file" && entry.isDir) continue;
        if (orderedIds.length < limit) {
          orderedIds.push(id);
          groupIds[groupIndex]!.push(id);
        }
        break;
      }
    }
  };
  let sourceHasMore = false;

  if (fullSource && directory && scopePage) {
    const source = outerFilter
      ? searchEntries(db, {
        libraryId,
        text: outerFilter,
        limit: range.limit,
        offset: range.offset,
        scope: "directory",
        directory,
        directChildren: true,
        resultMode: "hits-only",
      })
      : listDirectoryChildren(db, libraryId, directory, {
      limit: range.limit,
      offset: range.offset,
    });
    evaluatePage(source.hits.map((hit) => hit.entryId), Number.MAX_SAFE_INTEGER);
  } else if (fullSource) {
    const scoped = previewCandidateEntries(listEntries(db, libraryId), {
      scope: selectedIds?.length ? "selection" : directory ? "directory" : "library",
      entryIds: selectedIds,
      directory,
    }).filter((entry) => isInsideLibraryRoots(entry.path, libraryRoots));
    let ids = scoped.map((entry) => String(entry.id));
    if (directoryKey && !outerFilter && (scopePage || target === "file")) {
      ids = ids.filter((id) => {
        const entry = scoped.find((item) => String(item.id) === id);
        return entry ? parentPreviewPath(entry.path) === directoryKey : false;
      });
    }
    if (outerFilter) ids = [...searchEntryIds(db, libraryId, outerFilter, ids, directory)];
    if (directoryKey && (outerFilter || target === "dir")) {
      const byId = new Map(scoped.map((entry) => [String(entry.id), entry]));
      ids = ids.filter((id) => {
        const entry = byId.get(id);
        if (!entry) return false;
        const path = normalizePreviewPath(entry.path);
        return parentPreviewPath(entry.path) === directoryKey && path !== directoryKey;
      });
    }
    evaluatePage(ids, Number.MAX_SAFE_INTEGER);
  } else {
    const source = directory && scopePage && !outerFilter
      ? listDirectoryChildren(db, libraryId, directory, {
        limit: range.limit,
        offset: range.offset,
      })
      : searchEntries(db, {
      libraryId,
      text: outerFilter,
      limit: range.limit,
      offset: range.offset,
      scope: selectedIds?.length ? "selection" : directory ? "directory" : "library",
      entryIds: selectedIds,
      directory,
      directChildren: Boolean(directory) && (scopePage || target === "file"),
      resultMode: "hits-only",
    });
    const ids = source.hits.map((hit) => hit.entryId);
    sourceHasMore = source.hasMore;
    evaluatePage(ids, range.limit);
    return {
      orderedIds,
      groupIds,
      sourceOffset,
      sourceCount: ids.length,
      sourceHasMore,
    };
  }
  return {
    orderedIds,
    groupIds,
    sourceOffset,
    sourceCount: orderedIds.length,
    sourceHasMore: !fullSource && orderedIds.length >= range.limit && sourceHasMore,
  };
}

function renameRange(offset: number | undefined, limit: number | undefined): { offset: number; limit: number } | undefined {
  if (offset == null && limit == null) return undefined;
  return {
    offset: Math.max(0, Math.trunc(offset ?? 0)),
    limit: Math.max(0, Math.trunc(limit ?? Number.MAX_SAFE_INTEGER)),
  };
}

function isInsideLibraryRoots(path: string, roots: readonly string[]): boolean {
  return roots.length === 0 || roots.some((root) => isWithinRoot(path, root) || normalizePreviewPath(path) === normalizePreviewPath(root));
}

function parentPreviewPath(path: string): string {
  const normalized = normalizePreviewPath(path);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  const parent = normalized.slice(0, index);
  return /^[a-z]:$/.test(parent) ? `${parent}/` : parent;
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
    if (!expressionKinds && parsed.expression) {
      kinds.add("dir");
      kinds.add("file");
    } else if (expressionKinds) {
      if (expressionKinds.has("dir")) kinds.add("dir");
      if (expressionKinds.has("file")) kinds.add("file");
    }
    const parsedKind = parsed.kind;
    if (parsedKind && !parsed.expression) {
      for (const kind of parsedKind.split("|")) {
        const normalized = kind.trim().toLowerCase();
        if (normalized) kinds.add(normalized);
      }
    } else if (!parsed.expression) {
      if (parsed.folderName) kinds.add("dir");
      if (parsed.fileName) kinds.add("file");
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
  if (node.type === "rule") return null;
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
  if (node.type === "not" || node.type === "text" || node.type === "rule") return false;
  return node.children.every(isReliableKindComplement);
}
