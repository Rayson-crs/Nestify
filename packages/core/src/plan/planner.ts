import { createHash } from "node:crypto";
import type { Entry, ChangePlan, PlanOp, PlanRisk, PlanSeqCursor, PlanSummary } from "@nestify/shared";
import { asEntryId, asLibraryId, asPlanId, asRuleId } from "@nestify/shared";
import type { CollisionStrategy, MatchTree, RuleDefinition, RuleSet } from "@nestify/rules";
import {
  buildContextIndex,
  buildRuleContext,
  listDirectChildren,
  type ContextIndex,
  type RuleContext,
} from "../rules/context.ts";
import { matches } from "../rules/match.ts";
import { renderTemplate, sanitizeName } from "../rules/template.ts";
import { resolveCollision } from "./collision.ts";
import { evaluateRuleSteps } from "./evaluator.ts";
import {
  fileNameOf,
  isAbsolutePath,
  isIllegalName,
  isLongPath,
  joinPath,
  normalizeKey,
  parentPathOf,
} from "./paths.ts";
import { VirtualFs } from "./vfs.ts";

export interface PlanRulesInput {
  libraryId: string;
  entries: readonly Entry[];
  candidateEntryIds?: readonly string[];
  ruleSet: RuleSet;
  collision?: CollisionStrategy;
  libraryRoot?: string;
  quarantineDir?: string;
  now?: number;
  /** 整理规则的局部候选集，由上层把输入助手条件、对象类型和目录范围求值后传入。 */
  candidateEntryIdsByRule?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Only plan this slice of the ordered candidates. Omit it to plan every candidate. */
  candidateRange?: { offset: number; limit: number };
  /** Sequence counters left by the previous page, so {seq} stays continuous. */
  seqCursor?: PlanSeqCursor;
}

export interface PlanRenameInput {
  libraryId: string;
  entries: readonly Entry[];
  candidateEntryIds?: readonly string[];
  template: string;
  match?: MatchTree;
  /** Default `file` keeps current behavior. `dir` only folders, `all` both. */
  target?: "file" | "dir" | "all";
  collision?: CollisionStrategy;
  libraryRoot?: string;
  now?: number;
  candidateRange?: { offset: number; limit: number };
  seqCursor?: PlanSeqCursor;
}

export function planRuleset(input: PlanRulesInput): ChangePlan {
  const entries = input.entries.filter((entry) => !entry.tombstone);
  const candidateIds = new Set(input.candidateEntryIds ?? entries.map((entry) => entry.id));
  const candidates = entries.filter((entry) => candidateIds.has(entry.id));
  const collision = input.collision ?? input.ruleSet.collision ?? "suffix";
  const libraryRoot = input.libraryRoot ?? inferLibraryRoot(entries);
  const quarantineDir = input.quarantineDir ?? joinPath(libraryRoot, ".nestify-quarantine");
  const index = buildContextIndex(entries);
  const vfs = new VirtualFs(entries);
  const ops: PlanOp[] = [];
  const seqState = seqStateFrom(input.seqCursor);
  const handledEntries = new Set<string>();
  const rules = [...input.ruleSet.rules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  // Callers that already selected a page pass the page as candidateEntryIds.
  // Applying offset/limit again would drop rows from that page, so an explicit
  // candidate list is planned in full and in the caller's order.
  const ordered = input.candidateEntryIds
    ? orderedExplicitCandidates(candidates, input.candidateEntryIds, rules, input.candidateEntryIdsByRule, index, seqState)
    : orderedMatchedCandidates(candidates, rules, input.candidateEntryIdsByRule, index, seqState, input.candidateRange, handledEntries);
  for (const { rule, entry } of ordered) {
    const env = {
      collision,
      index,
      vfs,
      ops,
      seqState,
      libraryRoot,
      quarantineDir,
      rule,
    };
    if (hasSteps(rule)) {
      evaluateRuleSteps(env, entry);
      continue;
    }
    applyRule(rule, entry, env);
  }

  return toPlan({
    libraryId: input.libraryId,
    collision,
    ops,
    now: input.now,
    seqCursor: seqCursorFrom(seqState),
  });
}

export function planRename(input: PlanRenameInput): ChangePlan {
  const target = input.target ?? "file";
  const ruleSet: RuleSet = {
    id: "adhoc-rename",
    name: "adhoc-rename",
    dryRunDefault: true,
    collision: input.collision ?? "suffix",
    rules: renameRules(input.template, target, input.match),
  };
  return planRuleset({
    libraryId: input.libraryId,
    entries: input.entries,
    candidateEntryIds: input.candidateEntryIds,
    candidateRange: input.candidateRange,
    seqCursor: input.seqCursor,
    ruleSet,
    collision: input.collision,
    libraryRoot: input.libraryRoot,
    now: input.now,
  });
}

function renameRules(
  template: string,
  target: NonNullable<PlanRenameInput["target"]>,
  match?: MatchTree,
): RuleDefinition[] {
  const rules: RuleDefinition[] = [];
  if (target === "file" || target === "all") {
    rules.push({
      id: target === "all" ? "adhoc-rename-file" : "adhoc-rename",
      enabled: true,
      priority: 1,
      action: "rename_file",
      template,
      match: match ?? { all: [{ field: "is_dir", eq: false }] },
    });
  }
  if (target === "dir" || target === "all") {
    rules.push({
      id: target === "all" ? "adhoc-rename-dir" : "adhoc-rename",
      enabled: true,
      priority: 2,
      action: "rename_dir",
      template,
      match: match ?? { all: [{ field: "is_dir", eq: true }] },
    });
  }
  return rules;
}

interface SeqState {
  seq: number;
  parentSeq: Map<string, number>;
}

interface ApplyCtx {
  collision: CollisionStrategy;
  index: ContextIndex;
  vfs: VirtualFs;
  ops: PlanOp[];
  seqState: SeqState;
  libraryRoot: string;
  quarantineDir: string;
  rule: RuleDefinition;
}

function hasSteps(rule: RuleDefinition): boolean {
  return Boolean(rule.steps) && rule.steps!.length > 0;
}

function orderedExplicitCandidates(
  candidates: readonly Entry[],
  candidateEntryIds: readonly string[],
  rules: readonly RuleDefinition[],
  candidateEntryIdsByRule: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  index: ContextIndex,
  seqState: SeqState,
): Array<{ rule: RuleDefinition; entry: Entry }> {
  const byId = new Map(candidates.map((entry) => [entry.id, entry]));
  const ordered = [];
  for (const id of candidateEntryIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    const rule = rules.find((candidate) => {
      const allowed = candidateEntryIdsByRule?.get(candidate.id);
      return (!allowed || allowed.has(entry.id))
        && matches(candidate.match, contextFor(entry, index, seqState));
    });
    if (rule) ordered.push({ rule, entry });
  }
  return ordered;
}

function orderedMatchedCandidates(
  candidates: readonly Entry[],
  rules: readonly RuleDefinition[],
  candidateEntryIdsByRule: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  index: ContextIndex,
  seqState: SeqState,
  candidateRange: { offset: number; limit: number } | undefined,
  handledEntries: Set<string>,
): Array<{ rule: RuleDefinition; entry: Entry }> {
  const ordered = [];
  const range = normalizeCandidateRange(candidateRange);
  const needed = range ? range.offset + range.limit : Number.POSITIVE_INFINITY;
  let matchedCount = 0;
  for (const rule of rules) {
    const ruleCandidateIds = candidateEntryIdsByRule?.get(rule.id);
    const matched = candidates
      .filter((entry) => !handledEntries.has(entry.id))
      .filter((entry) => !ruleCandidateIds || ruleCandidateIds.has(entry.id))
      .filter((entry) => matches(rule.match, contextFor(entry, index, seqState)))
      .sort(deepFirst);
    for (const entry of matched) {
      matchedCount += 1;
      if (!range || matchedCount > range.offset) ordered.push({ rule, entry });
      if (rule.continueMatching === false) handledEntries.add(entry.id);
      if (matchedCount >= needed) break;
    }
    if (matchedCount >= needed) break;
  }
  return ordered;
}

function applyRule(rule: RuleDefinition, entry: Entry, ctx: ApplyCtx): void {
  const from = ctx.vfs.current(entry.id);
  if (!from) return;

  switch (rule.action) {
    case "rename_file":
    case "rename_dir":
      applyRename(rule, entry, from, ctx);
      return;
    case "move":
      applyMove(rule, entry, from, ctx);
      return;
    case "delete_to_quarantine":
      applyQuarantine(rule, entry, from, ctx);
      return;
    case "flatten_dir":
      applyFlatten(rule, entry, from, ctx);
      return;
    default:
      return;
  }
}

function applyRename(rule: RuleDefinition, entry: Entry, from: string, ctx: ApplyCtx): void {
  if (rule.action === "rename_dir" && !entry.isDir) return;
  if (rule.action === "rename_file" && entry.isDir) return;
  const rendered = renderFor(rule, entry, from, ctx);
  if (!rendered) {
    pushOp(ctx.ops, {
      op: "rename",
      from,
      to: null,
      entryId: entry.id,
      ruleId: rule.id,
      reason: rule.reason ?? "empty template result",
      risk: "illegal_name",
      selected: false,
    });
    return;
  }
  const dest = resolveDestination(from, rendered, "rename");
  commitRelocate(entry, from, dest, "rename", rule, ctx);
}

function applyMove(rule: RuleDefinition, entry: Entry, from: string, ctx: ApplyCtx): void {
  const rendered = renderFor(rule, entry, from, ctx);
  if (!rendered) return;
  const dest = resolveDestination(from, rendered, "move", ctx.libraryRoot);
  ensureParents(dest, ctx);
  commitRelocate(entry, from, dest, "move", rule, ctx);
}

function applyQuarantine(rule: RuleDefinition, entry: Entry, from: string, ctx: ApplyCtx): void {
  ctx.vfs.addDir(ctx.quarantineDir);
  const dest = joinPath(ctx.quarantineDir, fileNameOf(from));
  commitRelocate(entry, from, dest, "quarantine", rule, ctx, rule.reason ?? "quarantine matched file");
}

function applyFlatten(rule: RuleDefinition, entry: Entry, from: string, ctx: ApplyCtx): void {
  if (!entry.isDir) return;
  const children = listDirectChildren(entry, ctx.index).filter((child) => !child.tombstone);
  const childDirs = children.filter((child) => child.isDir);
  if (childDirs.length !== 1) return;
  const nested = childDirs[0]!;
  const nestedPath = ctx.vfs.current(nested.id);
  if (!nestedPath) return;
  const nestedChildren = listDirectChildren(nested, ctx.index).filter((child) => !child.tombstone);
  for (const child of nestedChildren.sort(deepFirst)) {
    const childFrom = ctx.vfs.current(child.id);
    if (!childFrom) continue;
    const dest = joinPath(from, fileNameOf(childFrom));
    commitRelocate(child, childFrom, dest, "move", rule, ctx, "flatten nested child");
  }
  ctx.vfs.remove(nested.id);
  pushOp(ctx.ops, {
    op: "flatten",
    from: nestedPath,
    to: from,
    entryId: nested.id,
    ruleId: rule.id,
    reason: rule.reason ?? "flatten single child directory",
    risk: "none",
    selected: true,
  });
}

function renderFor(rule: RuleDefinition, entry: Entry, from: string, ctx: ApplyCtx): string {
  bumpSeq(ctx.seqState, from);
  const indexCtx = contextFor(entry, ctx.index, ctx.seqState);
  if (!rule.template) return "";
  return renderTemplate(rule.template, indexCtx).trim();
}

function commitRelocate(
  entry: Entry,
  from: string,
  desired: string,
  op: PlanOp["op"],
  rule: RuleDefinition,
  ctx: ApplyCtx,
  reason = rule.reason ?? rule.id,
): void {
  if (normalizeKey(from) === normalizeKey(desired)) {
    if (op !== "rename") return;
    pushOp(ctx.ops, {
      op,
      from,
      to: from,
      entryId: entry.id,
      ruleId: rule.id,
      reason: "名称未变化",
      risk: "none",
      selected: false,
    });
    return;
  }
  const name = fileNameOf(desired);
  if (isIllegalName(name) || !sanitizeName(name)) {
    pushOp(ctx.ops, {
      op,
      from,
      to: desired,
      entryId: entry.id,
      ruleId: rule.id,
      reason: "illegal destination name",
      risk: "illegal_name",
      selected: false,
    });
    return;
  }

  const resolved = resolveCollision(
    desired,
    { has: (path) => ctx.vfs.occupiedByOther(path, entry.id) },
    ctx.collision,
    entry.isDir,
  );
  const to = resolved.path;
  const risk = refineRisk(resolved.risk, to ?? desired);
  const selected = resolved.selected && risk !== "overwrite" && to != null;
  pushOp(ctx.ops, {
    op,
    from,
    to,
    entryId: entry.id,
    ruleId: rule.id,
    reason: resolved.reason ?? reason,
    risk,
    selected,
  });
  if (selected && to) ctx.vfs.relocate(entry.id, to);
}

function ensureParents(dest: string, ctx: ApplyCtx): void {
  const missing: string[] = [];
  let current = parentPathOf(dest);
  while (current && normalizeKey(current) !== normalizeKey(ctx.libraryRoot)) {
    if (ctx.vfs.has(current)) break;
    missing.push(current);
    const next = parentPathOf(current);
    if (!next || normalizeKey(next) === normalizeKey(current)) break;
    current = next;
  }
  for (const dir of missing.reverse()) {
    ctx.vfs.addDir(dir);
    pushOp(ctx.ops, {
      op: "mkdir",
      from: dir,
      to: dir,
      entryId: undefined,
      ruleId: null,
      reason: "create missing parent",
      risk: isLongPath(dir) ? "long_path" : "none",
      selected: true,
    });
  }
}

function resolveDestination(from: string, rendered: string, mode: "rename" | "move", libraryRoot?: string): string {
  const trimmed = rendered.replace(/[\\/]+$/, "");
  if (isAbsolutePath(trimmed)) return trimmed;
  if (mode === "move") return joinPath(libraryRoot ?? parentPathOf(from), trimmed);
  if (/[\\/]/.test(trimmed)) return joinPath(parentPathOf(from), trimmed);
  return joinPath(parentPathOf(from), trimmed);
}

function contextFor(entry: Entry, index: ContextIndex, seqState: SeqState): RuleContext {
  const parentKey = entry.parentPath ?? entry.parentId ?? "";
  return buildRuleContext(entry, index, {
    seq: seqState.seq,
    parent_seq: seqState.parentSeq.get(parentKey) ?? 0,
  });
}

function bumpSeq(seqState: SeqState, from: string): void {
  seqState.seq += 1;
  const parent = parentPathOf(from);
  seqState.parentSeq.set(parent, (seqState.parentSeq.get(parent) ?? 0) + 1);
}

function inferLibraryRoot(entries: readonly Entry[]): string {
  const root = entries.find((entry) => entry.depth === 0 && entry.isDir) ?? entries.find((entry) => entry.depth === 0);
  if (root) return root.path;
  if (entries[0]?.parentPath) return entries[0].parentPath;
  return "";
}

function deepFirst(a: Entry, b: Entry): number {
  if (b.depth !== a.depth) return b.depth - a.depth;
  return a.path.localeCompare(b.path);
}

function refineRisk(risk: PlanRisk, path: string): PlanRisk {
  if (risk !== "none") return risk;
  if (isLongPath(path)) return "long_path";
  return "none";
}

function pushOp(
  ops: PlanOp[],
  op: {
    op: PlanOp["op"];
    from: string;
    to: string | null;
    entryId?: string;
    ruleId: string | null;
    reason: string;
    risk: PlanRisk;
    selected: boolean;
  },
): void {
  ops.push({
    op: op.op,
    from: op.from,
    to: op.to,
    entryId: op.entryId ? asEntryId(op.entryId) : undefined,
    ruleId: op.ruleId ? asRuleId(op.ruleId) : null,
    reason: op.reason,
    risk: op.risk,
    confidence: op.selected && op.risk === "none" ? 0.95 : 0.4,
    selected: op.selected,
  });
}

function toPlan(input: {
  libraryId: string;
  collision: CollisionStrategy;
  ops: PlanOp[];
  now?: number;
  seqCursor?: PlanSeqCursor;
}): ChangePlan {
  const createdAt = input.now ?? Date.now();
  return {
    id: asPlanId(createHash("sha1").update(`${input.libraryId}:${createdAt}:${input.ops.length}`).digest("hex").slice(0, 16)),
    libraryId: asLibraryId(input.libraryId),
    createdAt,
    status: "draft",
    collision: input.collision,
    dryRun: true,
    ops: input.ops,
    summary: summarize(input.ops),
    seqCursor: input.seqCursor,
  };
}

function seqStateFrom(cursor: PlanSeqCursor | undefined): SeqState {
  return {
    seq: cursor?.seq ?? 0,
    parentSeq: new Map(cursor?.parentSeq ?? []),
  };
}

function seqCursorFrom(state: SeqState): PlanSeqCursor {
  return {
    seq: state.seq,
    parentSeq: [...state.parentSeq.entries()],
  };
}

function normalizeCandidateRange(
  range: { offset: number; limit: number } | undefined,
): { offset: number; limit: number } | undefined {
  if (!range) return undefined;
  return {
    offset: Math.max(0, Math.trunc(range.offset)),
    limit: Math.max(0, Math.trunc(range.limit)),
  };
}

function summarize(ops: readonly PlanOp[]): PlanSummary {
  const count = (type: PlanOp["op"]) => ops.filter((op) => op.op === type).length;
  return {
    selected: ops.filter((op) => op.selected).length,
    rename: count("rename"),
    move: count("move"),
    mkdir: count("mkdir"),
    quarantine: count("quarantine"),
    delete: count("delete"),
    flatten: count("flatten"),
    conflicts: ops.filter((op) => op.risk !== "none").length,
  };
}
