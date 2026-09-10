// 步骤链求值器（v2）。
//
// 思路：
//   入口 evaluateRuleSteps(rule, entry, env)：
//     1. 若 rule.steps 为空数组或缺失，回退到老路径（planner.applyRule）。
//     2. 否则建立初始 ScopeFrame，把 entry 自身作为 frame.vars.self 写入；
//        然后顺序执行 steps。
//   每种节点：
//     filter    → 谓词不命中就跳过其后整个序列（active=false）。
//     ifElse    → 命中 then / 否则 else。子序列同样入新作用域。
//     forEach   → 取目标列表，每个元素入新帧，子步骤对每个元素各跑一次。
//     transform → 渲染 expr 模板，把结果写入当前帧 as 变量。
//     action    → 走 rename / move / quarantine / flatten 之一。
//
// 作用域变量查找：resolveField("scope.<stepId>.<var>" | "scope.last.<var>" | "self"...)
//   解析顺序：当前帧 → 父帧 → 祖父帧 → RuleContext 兜底。
//
// 模板渲染复用 packages/core/src/rules/template.ts 的 renderTemplate；
// 对 transform 输出的值类型保持与 renderTemplate 一致（string）。

import type { Entry, PlanOp, PlanRisk } from "@nestify/shared";
import { asEntryId, asRuleId } from "@nestify/shared";
import type {
  ActionStep,
  FilterStep,
  ForEachStep,
  IfElseStep,
  MatchTree,
  RuleDefinition,
  RuleStep,
  RuleStepTrace,
  StepTarget,
  TransformStep,
} from "@nestify/rules";
import { normalizeStep } from "@nestify/rules";
import {
  buildRuleContext,
  listDirectChildren,
  type ContextIndex,
  type RuleContext,
} from "../rules/context.ts";
import { matches } from "../rules/match.ts";
import { renderTemplate } from "../rules/template.ts";
import { resolveCollision } from "./collision.ts";
import {
  fileNameOf,
  isIllegalName,
  isLongPath,
  joinPath,
  normalizeKey,
  parentPathOf,
} from "./paths.ts";
import { VirtualFs } from "./vfs.ts";

export interface EvaluateEnv {
  collision: "suffix" | "skip" | "overwrite";
  index: ContextIndex;
  vfs: VirtualFs;
  ops: PlanOp[];
  seqState: SeqState;
  libraryRoot: string;
  quarantineDir: string;
  rule: RuleDefinition;
}

export interface SeqState {
  seq: number;
  parentSeq: Map<string, number>;
}

export interface EvaluationTrace {
  ruleId: string;
  entryId: string;
  hit: boolean;
  steps: RuleStepTrace[];
  vars: Record<string, unknown>;
  producedOps: number;
}

export function evaluateRuleSteps(env: EvaluateEnv, entry: Entry): EvaluationTrace {
  const { rule } = env;
  const frame: ScopeFrame = {
    active: true,
    vars: { self: entry },
  };
  const scopes: ScopeFrame[] = [frame];
  const initialCtx = buildRuleContext(entry, env.index, {
    seq: env.seqState.seq,
    parent_seq: env.seqState.parentSeq.get(entry.parentPath ?? entry.parentId ?? "") ?? 0,
  });

  const stepTraces: RuleStepTrace[] = [];
  const producedBefore = env.ops.length;
  runSteps((rule.steps ?? []).map(normalizeStep), env, entry, initialCtx, scopes, stepTraces);

  return {
    ruleId: rule.id,
    entryId: entry.id,
    hit: stepTraces.some((trace) => trace.matched),
    steps: stepTraces,
    vars: topVars(scopes),
    producedOps: env.ops.length - producedBefore,
  };
}

interface ScopeFrame {
  active: boolean;
  vars: Record<string, unknown>;
}

function runSteps(
  steps: RuleStep[],
  env: EvaluateEnv,
  bound: Entry,
  ctx: RuleContext,
  scopes: ScopeFrame[],
  out: RuleStepTrace[],
): void {
  for (const step of steps) {
    if (!currentActive(scopes)) break;
    runStep(normalizeStep(step), env, bound, ctx, scopes, out);
  }
}

function runStep(
  step: RuleStep,
  env: EvaluateEnv,
  bound: Entry,
  ctx: RuleContext,
  scopes: ScopeFrame[],
  out: RuleStepTrace[],
): void {
  switch (step.kind) {
    case "filter":
      runFilter(step, env, bound, ctx, scopes, out);
      return;
    case "ifElse":
      runIfElse(step, env, bound, ctx, scopes, out);
      return;
    case "forEach":
      runForEach(step, env, bound, ctx, scopes, out);
      return;
    case "transform":
      runTransform(step, env, bound, ctx, scopes, out);
      return;
    case "action":
      runAction(step, env, bound, ctx, scopes, out);
      return;
  }
}

function runFilter(
  step: FilterStep,
  env: EvaluateEnv,
  _bound: Entry,
  ctx: RuleContext,
  scopes: ScopeFrame[],
  out: RuleStepTrace[],
): void {
  const targetEntry = resolveTargetEntry(step.target ?? { kind: "self" }, scopes);
  const effectiveCtx = targetEntry ? buildRuleContext(targetEntry, env.index, {
    seq: env.seqState.seq,
    parent_seq: env.seqState.parentSeq.get(targetEntry.parentPath ?? targetEntry.parentId ?? "") ?? 0,
  }) : ctx;
  const matched = matches(step.when as MatchTree, effectiveCtx);
  pushFrame(scopes, { active: matched });
  out.push({
    id: step.id,
    kind: step.kind,
    matched,
    skipped: !matched,
  });
}

function runIfElse(
  step: IfElseStep,
  env: EvaluateEnv,
  bound: Entry,
  ctx: RuleContext,
  scopes: ScopeFrame[],
  out: RuleStepTrace[],
): void {
  const matched = matches(step.when as MatchTree, ctx);
  pushFrame(scopes, { active: true });
  const branchTrace: RuleStepTrace[] = [];
  const branchSteps = matched
    ? Array.isArray(step.then) ? step.then : [step.then]
    : step.else
      ? (Array.isArray(step.else) ? step.else : [step.else])
      : [];
  runSteps(branchSteps, env, bound, ctx, scopes, branchTrace);
  popFrame(scopes);
  out.push({
    id: step.id,
    kind: step.kind,
    matched,
    children: branchTrace,
  });
}

function runForEach(
  step: ForEachStep,
  env: EvaluateEnv,
  bound: Entry,
  ctx: RuleContext,
  scopes: ScopeFrame[],
  out: RuleStepTrace[],
): void {
  const list = resolveTargetList(step.of, env, bound, scopes);
  const innerTrace: RuleStepTrace[] = [];
  const bodySteps = step.steps;
  for (const item of list) {
    // 迭代帧写入 __stepId，模板里 scope.<forEachId>.<as> 可精确取到当前元素。
    pushFrame(scopes, { active: true, vars: { [step.as]: item, __stepId: step.id } });
    runSteps(bodySteps, env, item, ctxForItem(item, env), scopes, innerTrace);
    popFrame(scopes);
  }
  out.push({
    id: step.id,
    kind: step.kind,
    matched: list.length > 0,
    produced: { length: list.length },
    children: innerTrace,
  });
}

function runTransform(
  step: TransformStep,
  env: EvaluateEnv,
  _bound: Entry,
  ctx: RuleContext,
  scopes: ScopeFrame[],
  out: RuleStepTrace[],
): void {
  // transform 既支持 "对 self 操作"，也支持 "对 scope.x.y 操作"。
  // 简化实现：基于 resolveStepContext 构造新 ctx 顶上 transform.from 命名的字段。
  const named = resolveTargetEntry(step.from ?? { kind: 'self' }, scopes);
  const effectiveCtx: RuleContext = named
    ? buildRuleContext(named, env.index, {
        seq: env.seqState.seq,
        parent_seq: env.seqState.parentSeq.get(named.parentPath ?? named.parentId ?? "") ?? 0,
      })
    : ctx;
  const value = renderWithScope(step.expr, scopes, effectiveCtx);
  setVar(scopes, step.as, value);
  out.push({
    id: step.id,
    kind: step.kind,
    matched: true,
    produced: { [step.as]: value },
  });
}

function runAction(
  step: ActionStep,
  env: EvaluateEnv,
  _bound: Entry,
  ctx: RuleContext,
  scopes: ScopeFrame[],
  out: RuleStepTrace[],
): void {
  const targetEntry = resolveTargetEntry(step.target ?? { kind: "self" }, scopes) ?? _bound;
  const effectiveCtx: RuleContext = ctx.entry === targetEntry
    ? ctx
    : buildRuleContext(targetEntry, env.index, {
        seq: env.seqState.seq,
        parent_seq: env.seqState.parentSeq.get(targetEntry.parentPath ?? targetEntry.parentId ?? "") ?? 0,
      });
  const opsBefore = env.ops.length;
  applyAction(env, step, targetEntry, effectiveCtx, scopes);
  const produced = env.ops.length - opsBefore;
  out.push({
    id: step.id,
    kind: step.kind,
    matched: produced > 0,
    skipped: produced === 0,
    produced: { ops: produced },
  });
  // 当前帧变量同步写入 to-path，便于后续 transform 读取 moved/newName。
  setVar(scopes, "lastAction", {
    stepId: step.id,
    action: step.action,
    ops: env.ops.slice(-produced),
  });
}

// —— 辅助：作用域与上下文 ——————————————————————————————

function pushFrame(scopes: ScopeFrame[], patch: Partial<ScopeFrame>): ScopeFrame {
  const parent = scopes[scopes.length - 1];
  // 子帧完整继承父帧变量（嵌套 forEach 才能读到外层迭代变量），再合并 patch.vars。
  const frame: ScopeFrame = {
    active: patch.active ?? parent?.active ?? true,
    vars: { ...(parent?.vars ?? {}), ...(patch.vars ?? {}) },
  };
  scopes.push(frame);
  return frame;
}

function popFrame(scopes: ScopeFrame[]): void {
  if (scopes.length > 1) scopes.pop();
}

function currentActive(scopes: ScopeFrame[]): boolean {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const frame = scopes[i];
    if (!frame) continue;
    if (!frame.active) return false;
  }
  return true;
}

function setVar(scopes: ScopeFrame[], name: string, value: unknown): void {
  const top = scopes[scopes.length - 1];
  if (top) top.vars[name] = value;
}

function topVars(scopes: ScopeFrame[]): Record<string, unknown> {
  const top = scopes[scopes.length - 1];
  return top ? { ...top.vars } : {};
}

/**
 * 把 target 解析为单个 entry。返回 undefined 表示无法解析（继续使用原 bound）。
 *   self → 自身
 *   children → 取不到时返回 undefined（调用方需自行判断）
 *   scope.stepId.var → 读作用域变量；若是 Entry 直接返回；若不是返回 undefined
 */
function resolveTargetEntry(target: StepTarget, scopes: ScopeFrame[]): Entry | undefined {
  switch (target.kind) {
    case "self":
      return undefined; // 调用方需自行拿 bound
    case "children":
      return undefined; // 调用方需自行处理
    case "scope": {
      const value = lookupScope(scopes, target.step, target.var);
      if (isEntry(value)) return value;
      return undefined;
    }
  }
}

function isEntry(value: unknown): value is Entry {
  return Boolean(value) && typeof value === "object" && "id" in (value as Record<string, unknown>)
    && "path" in (value as Record<string, unknown>);
}

function lookupScope(scopes: ScopeFrame[], stepId: string, varName: string): unknown {
  if (stepId === "last" || stepId === "*") {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      const frame = scopes[i];
      if (!frame) continue;
      if (varName in frame.vars) return frame.vars[varName];
    }
    return undefined;
  }
  for (const frame of scopes) {
    if (frame.vars["__stepId"] === stepId && varName in frame.vars) return frame.vars[varName];
  }
  return undefined;
}

/** 把 target 解析为 entry 列表（children / scope 变量 / self 均有效）。 */
function resolveTargetList(
  target: StepTarget,
  env: EvaluateEnv,
  bound: Entry,
  scopes: ScopeFrame[],
): Entry[] {
  switch (target.kind) {
    case "self":
      return [bound];
    case "children":
      return listDirectChildren(bound, env.index).filter((child) => !child.tombstone);
    case "scope": {
      const value = lookupScope(scopes, target.step, target.var);
      if (Array.isArray(value)) return value.filter(isEntry);
      if (isEntry(value)) return [value];
      return [];
    }
  }
}

function ctxForItem(item: Entry, env: EvaluateEnv): RuleContext {
  return buildRuleContext(item, env.index, {
    seq: env.seqState.seq,
    parent_seq: env.seqState.parentSeq.get(item.parentPath ?? item.parentId ?? "") ?? 0,
  });
}

// —— 模板渲染辅助：把 {scope.X.Y} 先解析为字符串再喂给 renderTemplate ——————

function renderWithScope(template: string, scopes: ScopeFrame[], ctx: RuleContext): string {
  const expanded = template.replace(/\{scope\.([^}]+)\}/g, (_match, key: string) => {
    const value = resolveScopePath(scopes, key);
    return value == null ? "" : String(value);
  });
  return renderTemplate(expanded, ctx);
}

/** 路径语法：`last.x.y` 取栈中最近一帧的 vars.x.y；`<stepId>.x.y` 取该 frame 内的 vars。 */
function resolveScopePath(scopes: ScopeFrame[], key: string): unknown {
  const parts = key.split(".");
  if (parts.length === 0) return undefined;
  const head = parts[0]!;
  let frames: ScopeFrame[];
  if (head === "last" || head === "*") {
    frames = scopes;
  } else if (head === "first") {
    frames = scopes.slice().reverse();
  } else {
    const targetId = head;
    frames = scopes.filter((frame) => frame.vars["__stepId"] === targetId);
  }
  if (!frames) return undefined;
  for (const frame of frames) {
    const candidate = readFramePath(frame.vars, parts.slice(1));
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function readFramePath(vars: Record<string, unknown>, parts: string[]): unknown {
  let current: unknown = vars;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// 因为 resolveTargetList 不接受 scopes，我们让 runForEach 维护一份"当前作用域"副本——
function scopeStack(): ScopeFrame[] {
  // 这里需要调用方传入；为简化暂时返回全局内部状态会引入副作用，改为由 runForEach 把列表值
  // 包装成 { __forEach: list, __stepId: ... } 直接 push 入 scopes，让 runForEach 内部走 lookupScope
  // 同一个 stack。
  return [];
}

// —— 动作应用（与 planner.ts 同语义，重新导出所需子集） ——————————

function applyAction(env: EvaluateEnv, step: ActionStep, entry: Entry, ctx: RuleContext, scopes: ScopeFrame[]): void {
  const from = env.vfs.current(entry.id);
  if (!from) return;
  switch (step.action) {
    case "rename_file":
    case "rename_dir":
      applyRenameAction(env, step, entry, from, ctx, scopes);
      return;
    case "move":
      applyMoveAction(env, step, entry, from, ctx, scopes);
      return;
    case "delete_to_quarantine":
      applyQuarantineAction(env, step, entry, from);
      return;
    case "flatten_dir":
      applyFlattenAction(env, step, entry, from);
      return;
  }
}

function applyRenameAction(env: EvaluateEnv, step: ActionStep, entry: Entry, from: string, ctx: RuleContext, scopes: ScopeFrame[]): void {
  if (step.action === "rename_dir" && !entry.isDir) return;
  if (step.action === "rename_file" && entry.isDir) return;
  const rendered = step.template ? renderWithScope(step.template, scopes, ctx).trim() : "";
  if (!rendered) {
    pushOp(env.ops, {
      op: "rename",
      from,
      to: null,
      entryId: entry.id,
      ruleId: env.rule.id,
      reason: step.reason ?? "empty template result",
      risk: "illegal_name",
      selected: false,
    });
    return;
  }
  const dest = resolveDestination(from, rendered, "rename");
  commitRelocate(env, step, entry, from, dest, "rename", step.reason ?? env.rule.reason);
}

function applyMoveAction(env: EvaluateEnv, step: ActionStep, entry: Entry, from: string, ctx: RuleContext, scopes: ScopeFrame[]): void {
  const rendered = step.template ? renderWithScope(step.template, scopes, ctx).trim() : "";
  if (!rendered) return;
  const dest = resolveDestination(from, rendered, "move", env.libraryRoot);
  ensureParents(env, dest);
  commitRelocate(env, step, entry, from, dest, "move", step.reason ?? env.rule.reason);
}

function applyQuarantineAction(env: EvaluateEnv, step: ActionStep, entry: Entry, from: string): void {
  env.vfs.addDir(env.quarantineDir);
  const dest = joinPath(env.quarantineDir, fileNameOf(from));
  commitRelocate(env, step, entry, from, dest, "quarantine", step.reason ?? "quarantine matched file");
}

function applyFlattenAction(env: EvaluateEnv, step: ActionStep, entry: Entry, from: string): void {
  if (!entry.isDir) return;
  const children = listDirectChildren(entry, env.index).filter((child) => !child.tombstone);
  const childDirs = children.filter((child) => child.isDir);
  if (childDirs.length !== 1) return;
  const nested = childDirs[0]!;
  const nestedPath = env.vfs.current(nested.id);
  if (!nestedPath) return;
  const nestedChildren = listDirectChildren(nested, env.index).filter((child) => !child.tombstone);
  const ruleId = env.rule.id;
  for (const child of nestedChildren.sort(deepFirst)) {
    const childFrom = env.vfs.current(child.id);
    if (!childFrom) continue;
    const dest = joinPath(from, fileNameOf(childFrom));
    commitRelocate(env, step, child, childFrom, dest, "move", "flatten nested child");
  }
  env.vfs.remove(nested.id);
  pushOp(env.ops, {
    op: "flatten",
    from: nestedPath,
    to: from,
    entryId: nested.id,
    ruleId,
    reason: step.reason ?? env.rule.reason ?? "flatten single child directory",
    risk: "none",
    selected: true,
  });
}

function commitRelocate(
  env: EvaluateEnv,
  step: ActionStep,
  entry: Entry,
  from: string,
  desired: string,
  op: "rename" | "move" | "quarantine",
  reason: string | undefined,
): void {
  if (normalizeKey(from) === normalizeKey(desired)) return;
  const name = fileNameOf(desired);
  if (isIllegalName(name)) {
    pushOp(env.ops, {
      op,
      from,
      to: desired,
      entryId: entry.id,
      ruleId: env.rule.id,
      reason: "illegal destination name",
      risk: "illegal_name",
      selected: false,
    });
    return;
  }
  const resolved = resolveCollision(
    desired,
    { has: (path) => env.vfs.occupiedByOther(path, entry.id) },
    env.collision,
    entry.isDir,
  );
  const to = resolved.path;
  const risk = refineRisk(resolved.risk, to ?? desired);
  const selected = resolved.selected && risk !== "overwrite" && to != null;
  pushOp(env.ops, {
    op,
    from,
    to,
    entryId: entry.id,
    ruleId: env.rule.id,
    reason: resolved.reason ?? reason ?? env.rule.id,
    risk,
    selected,
  });
  if (selected && to) env.vfs.relocate(entry.id, to);
}

function ensureParents(env: EvaluateEnv, dest: string): void {
  const missing: string[] = [];
  let current = parentPathOf(dest);
  while (current && normalizeKey(current) !== normalizeKey(env.libraryRoot)) {
    if (env.vfs.has(current)) break;
    missing.push(current);
    const next = parentPathOf(current);
    if (!next || normalizeKey(next) === normalizeKey(current)) break;
    current = next;
  }
  for (const dir of missing.reverse()) {
    env.vfs.addDir(dir);
    pushOp(env.ops, {
      op: "mkdir",
      from: dir,
      to: dir,
      entryId: undefined,
      ruleId: env.rule.id,
      reason: "create missing parent",
      risk: isLongPath(dir) ? "long_path" : "none",
      selected: true,
    });
  }
}

function resolveDestination(from: string, rendered: string, mode: "rename" | "move", libraryRoot?: string): string {
  const trimmed = rendered.replace(/[\\/]+$/, "");
  if (trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) return trimmed;
  if (mode === "move") return joinPath(libraryRoot ?? parentPathOf(from), trimmed);
  if (/[\\/]/.test(trimmed)) return joinPath(parentPathOf(from), trimmed);
  return joinPath(parentPathOf(from), trimmed);
}

function refineRisk(risk: PlanRisk, path: string): PlanRisk {
  if (risk !== "none") return risk;
  if (isLongPath(path)) return "long_path";
  return "none";
}

function pushOp(ops: PlanOp[], op: {
  op: PlanOp["op"];
  from: string;
  to: string | null;
  entryId?: string;
  ruleId: string | null;
  reason: string;
  risk: PlanRisk;
  selected: boolean;
}): void {
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

function deepFirst(a: Entry, b: Entry): number {
  if (b.depth !== a.depth) return b.depth - a.depth;
  return a.path.localeCompare(b.path);
}
