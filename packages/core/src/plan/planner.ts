import { createHash } from "node:crypto";
import type { Entry, ChangePlan, PlanOp, PlanRisk, PlanSummary } from "@nestify/shared";
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
}

export interface PlanRenameInput {
  libraryId: string;
  entries: readonly Entry[];
  candidateEntryIds?: readonly string[];
  template: string;
  match?: MatchTree;
  collision?: CollisionStrategy;
  libraryRoot?: string;
  now?: number;
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
  const seqState = { seq: 0, parentSeq: new Map<string, number>() };
  const rules = [...input.ruleSet.rules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const rule of rules) {
    const matched = candidates
      .filter((entry) => matches(rule.match, contextFor(entry, index, seqState)))
      .sort(deepFirst);
    for (const entry of matched) {
      applyRule(rule, entry, {
        collision,
        index,
        vfs,
        ops,
        seqState,
        libraryRoot,
        quarantineDir,
      });
    }
  }

  return toPlan({
    libraryId: input.libraryId,
    collision,
    ops,
    now: input.now,
  });
}

export function planRename(input: PlanRenameInput): ChangePlan {
  const ruleSet: RuleSet = {
    id: "adhoc-rename",
    name: "adhoc-rename",
    dryRunDefault: true,
    collision: input.collision ?? "suffix",
    rules: [
      {
        id: "adhoc-rename",
        enabled: true,
        priority: 1,
        action: "rename_file",
        template: input.template,
        match: input.match ?? { all: [{ field: "is_dir", eq: false }] },
      },
    ],
  };
  return planRuleset({
    libraryId: input.libraryId,
    entries: input.entries,
    candidateEntryIds: input.candidateEntryIds,
    ruleSet,
    collision: input.collision,
    libraryRoot: input.libraryRoot,
    now: input.now,
  });
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
  if (normalizeKey(from) === normalizeKey(desired)) return;
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
