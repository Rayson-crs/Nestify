import type { MatchAtom, MatchTree, RuleValueExpression } from "@nestify/rules";
import { getContextValue, type RuleContext } from "./context.ts";
import { applyChain } from "./chain.ts";
import { compileRegex } from "./regex.ts";

export function matches(tree: MatchTree | undefined | null, ctx: RuleContext): boolean {
  if (tree == null) return true;
  return evalNode(tree, ctx);
}

function evalNode(node: MatchTree, ctx: RuleContext): boolean {
  if (isAll(node)) return node.all.every((child) => evalNode(child, ctx));
  if (isAny(node)) return node.any.some((child) => evalNode(child, ctx));
  if (isNot(node)) return !evalNode(node.not, ctx);
  return evalAtom(node, ctx);
}

function isAll(node: MatchTree): node is { all: MatchTree[] } {
  return typeof node === "object" && node != null && "all" in node && Array.isArray(node.all);
}

function isAny(node: MatchTree): node is { any: MatchTree[] } {
  return typeof node === "object" && node != null && "any" in node && Array.isArray(node.any);
}

function isNot(node: MatchTree): node is { not: MatchTree } {
  return typeof node === "object" && node != null && "not" in node;
}

function evalAtom(atom: MatchAtom, ctx: RuleContext): boolean {
  let left = getContextValue(ctx, atom.field);
  for (const call of atom.transform ?? []) {
    left = applyChain(stringify(left), call.name, call.args, {
      parent: ctx.parent,
      grandparent: ctx.grandparent,
      ext: ctx.ext,
      path: ctx.path,
    });
  }

  if (atom.exists != null) {
    const present = left != null && left !== "";
    if (present !== atom.exists) return false;
  }
  if (atom.eq !== undefined && !sameValue(left, atom.eq)) return false;
  if (atom.ne !== undefined && sameValue(left, atom.ne)) return false;
  if ("neq" in atom && (atom as { neq?: unknown }).neq !== undefined) {
    if (sameValue(left, (atom as { neq?: unknown }).neq)) return false;
  }
  if (atom.ne_field) {
    const right = getContextValue(ctx, atom.ne_field);
    if (sameValue(left, right)) return false;
  }
  if (atom.gt != null && !isGreater(left, atom.gt, false)) return false;
  if (atom.gte != null && !isGreater(left, atom.gte, true)) return false;
  if (atom.lt != null && !isLess(left, atom.lt, false)) return false;
  if (atom.lte != null && !isLess(left, atom.lte, true)) return false;
  if (atom.in) {
    if (!atom.in.some((item) => sameValue(left, item))) return false;
  }
  if (atom.contains != null && !includesString(left, atom.contains)) return false;
  if (atom.prefix != null && !startsString(left, atom.prefix)) return false;
  if (atom.suffix != null && !endsString(left, atom.suffix)) return false;
  if (atom.regex != null) {
    try {
      if (!compileRegex(atom.regex).test(stringify(left))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Evaluate a value expression for consumers outside the matcher. */
export function evaluateRuleValue(expression: RuleValueExpression, ctx: RuleContext): unknown {
  let value = getContextValue(ctx, expression.field);
  for (const call of expression.calls ?? []) {
    value = applyChain(stringify(value), call.name, call.args, {
      parent: ctx.parent,
      grandparent: ctx.grandparent,
      ext: ctx.ext,
      path: ctx.path,
    });
  }
  return value;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringify).join("\n");
  return JSON.stringify(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left)) return left.some((item) => sameValue(item, right));
  if (typeof left === "boolean" || typeof right === "boolean") {
    return coerceBoolean(left) === coerceBoolean(right);
  }
  if (isNumeric(left) && isNumeric(right)) return Number(left) === Number(right);
  return stringify(left).toLowerCase() === stringify(right).toLowerCase();
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.toLowerCase() === "true" || value === "1";
  return Boolean(value);
}

function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return Number.isFinite(Number(value));
  return false;
}

function isGreater(left: unknown, right: number, orEqual: boolean): boolean {
  const n = Number(left);
  if (!Number.isFinite(n)) return false;
  return orEqual ? n >= right : n > right;
}

function isLess(left: unknown, right: number, orEqual: boolean): boolean {
  const n = Number(left);
  if (!Number.isFinite(n)) return false;
  return orEqual ? n <= right : n < right;
}

function includesString(left: unknown, needle: string): boolean {
  return stringify(left).toLowerCase().includes(needle.toLowerCase());
}

function startsString(left: unknown, needle: string): boolean {
  return stringify(left).toLowerCase().startsWith(needle.toLowerCase());
}

function endsString(left: unknown, needle: string): boolean {
  return stringify(left).toLowerCase().endsWith(needle.toLowerCase());
}
