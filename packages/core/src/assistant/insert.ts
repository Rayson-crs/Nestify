import type { AssistantContext, AssistantItem, SearchBuilderPart } from "./types.ts";
import { tokenizeSearchQuery } from "../search/parse.ts";

const COMPARISON_PREFIX = /^(>=|<=|>|<|=)/;

export function insertSearchToken(
  value: string,
  start: number,
  end: number,
  token: string,
  operator: boolean,
): { value: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  if (operator) {
    const left = before.replace(/\s+$/, "");
    const right = after.replace(/^\s+/, "");
    const leftPart = left ? `${left} ${token}` : token;
    const next = right ? `${leftPart} ${right}` : leftPart;
    return { value: next, caret: leftPart.length };
  }

  const leftSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const rightSpace = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const next = `${before}${leftSpace}${token}${rightSpace}${after}`;
  return { value: next, caret: before.length + leftSpace.length + token.length };
}

export function insertChainAtCursor(
  value: string,
  chain: string,
  cursor: number,
): { value: string; caret: number } {
  const span = findExprAtCursor(value, cursor);
  if (!span) {
    const inserted = `{name${chain}}`;
    const next = `${value.slice(0, cursor)}${inserted}${value.slice(cursor)}`;
    return { value: next, caret: cursor + inserted.length };
  }
  const inner = value.slice(span.open + 1, span.close);
  const next = `${value.slice(0, span.open)}{${inner}${chain}}${value.slice(span.close + 1)}`;
  return { value: next, caret: span.open + inner.length + chain.length + 2 };
}

/** Attach a rule chain to the string expression immediately before the caret. */
export function insertRuleChainAtCursor(
  value: string,
  chain: string,
  cursor: number,
): { value: string; caret: number } {
  const before = value.slice(0, cursor);
  const colon = before.endsWith(":") ? before.length - 1 : before.length;
  const expression = before.slice(0, colon);
  const match = /([A-Za-z_][A-Za-z0-9_.]*(?:\([^()]*\))?(?:\.[A-Za-z_][A-Za-z0-9_]*\([^()]*\))*)$/.exec(expression);
  const matchedExpression = match?.[1];
  if (matchedExpression !== undefined) {
    const start = match?.index ?? cursor;
    const next = `${value.slice(0, start)}${matchedExpression}${chain}${value.slice(colon)}`;
    return { value: next, caret: start + matchedExpression.length + chain.length + (colon < cursor ? 1 : 0) };
  }
  const inserted = `name${chain}:`;
  const next = `${value.slice(0, cursor)}${inserted}${value.slice(cursor)}`;
  return { value: next, caret: cursor + inserted.length };
}

export function resolveInsertValue(
  item: AssistantItem,
  context: AssistantContext,
  searchField?: string,
): string {
  if (context === "rename-template") return item.value;
  if (item.engine === "rule-field") return item.value;
  if (item.engine === "rule-chain") return `name${item.value}:`;
  if (context === "search-field" || (searchField && searchField !== "text")) return item.value;
  if (item.kind === "operator" || item.kind === "recipe" || item.engine === "search-recipe") {
    return item.value;
  }
  const field = item.searchFields?.find((name) => name !== "text");
  if (field) return `${field}:${item.value}`;
  return item.value;
}

export function applyItemParams(item: AssistantItem, values: Record<string, string>): string {
  if (!item.params?.length) return item.value;
  const parsed = parseChainCall(item.value);
  if (parsed && parsed.args.length === item.params.length) {
    const args = item.params.map((param, index) => {
      const raw = values[param.name] ?? param.defaultValue ?? parsed.args[index] ?? "";
      return quoteChainArg(raw);
    });
    return `.${parsed.name}(${args.join(", ")})`;
  }
  let next = item.value;
  for (const param of item.params) {
    const replacement = values[param.name] ?? param.defaultValue ?? "";
    const original = param.defaultValue ?? "";
    if (original) next = next.split(original).join(replacement);
  }
  return next;
}

export function quoteSearchValue(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

export function searchPartSyntax(part: SearchBuilderPart, comparisonFields: ReadonlySet<string>): string {
  const value = part.value.trim();
  if (part.field === "text") {
    return /^[a-z_]+:/.test(value) ? value : quoteSearchValue(value);
  }
  if (part.field === "phrase") {
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  const operator = comparisonFields.has(part.field) ? part.operator : "";
  return `${part.field}:${operator}${quoteSearchValue(value)}`;
}

export function parseSearchQueryToParts(input: string): SearchBuilderPart[] {
  const tokens = tokenizeSearchQuery(input);
  const parts: SearchBuilderPart[] = [];
  let pending: "AND" | "OR" | null = null;
  for (const token of tokens) {
    if (token.or) {
      pending = "OR";
      continue;
    }
    if (token.and) {
      pending = "AND";
      continue;
    }
    if (token.not && !token.filter && token.value.toUpperCase() === "NOT") {
      continue;
    }
    if (!token.value && !token.filter) continue;
    const field = token.filter ?? (token.quoted ? "phrase" : "text");
    const split = splitComparisonValue(token.value);
    const previous = parts.at(-1);
    const joiner = pending
      ?? (previous && isTextLike(previous.field) && isTextLike(field) ? "OR" : "AND");
    parts.push({
      field,
      operator: token.filter ? split.operator : "",
      value: token.filter ? split.value : token.not ? `-${token.value}` : token.value,
      joiner,
    });
    pending = null;
  }
  return parts;
}

export function parseChainCall(value: string): { name: string; args: string[] } | null {
  const match = /^\.([a-z_]+)\((.*)\)\s*$/s.exec(value.trim());
  if (!match) return null;
  return { name: match[1]!, args: splitCallArgs(match[2] ?? "") };
}

export function parseRenameField(value: string): string | null {
  const match = /^\{([^{}]+)\}$/.exec(value.trim());
  if (!match) return null;
  const expr = match[1]!.trim();
  const field = expr.split(/[.:]/)[0]?.trim() ?? "";
  return field || null;
}

function isTextLike(field: string): boolean {
  return field === "text" || field === "phrase";
}

function quoteChainArg(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  return `'${value.replaceAll("'", "\\'")}'`;
}

function splitComparisonValue(value: string): { operator: string; value: string } {
  const match = COMPARISON_PREFIX.exec(value);
  if (!match) return { operator: "", value };
  return { operator: match[1]!, value: value.slice(match[1]!.length) };
}

function splitCallArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ",") {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function findExprAtCursor(value: string, cursor: number): { open: number; close: number } | null {
  let quote: string | null = null;
  let escape = false;
  let open = -1;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      open = i;
      continue;
    }
    if (ch === "}" && open >= 0) {
      if (cursor >= open && cursor <= i + 1) {
        return { open, close: i };
      }
      open = -1;
    }
  }
  return null;
}
