import { applyChain } from "./chain.ts";
import { CHAIN_FUNCS } from "./placeholders.ts";
import { ancestorName, getContextValue, type RuleContext } from "./context.ts";

export { applyChain, sanitizeName } from "./chain.ts";

const DATE_FIELDS = new Set(["date_created", "date_modified", "mtime", "ctime"]);
const CHAIN_SET = new Set<string>(CHAIN_FUNCS);

export function renderTemplate(template: string, ctx: RuleContext): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i]!;
    if (ch === "{") {
      const close = findClosingBrace(template, i);
      if (close < 0) {
        out += ch;
        i += 1;
        continue;
      }
      const expr = template.slice(i + 1, close).trim();
      out += renderExpr(expr, ctx);
      i = close + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function findClosingBrace(input: string, open: number): number {
  let quote: string | null = null;
  let escape = false;
  for (let i = open + 1; i < input.length; i += 1) {
    const ch = input[i]!;
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
    if (ch === "}") return i;
  }
  return -1;
}

function renderExpr(expr: string, ctx: RuleContext): string {
  const parsed = parseExpr(expr);
  let value: unknown = resolveField(parsed.field, parsed.format, ctx);
  for (const call of parsed.calls) {
    value = applyChain(stringify(value), call.name, call.args, {
      parent: ctx.parent,
      grandparent: ctx.grandparent,
      ext: ctx.ext,
      path: ctx.path,
    });
  }
  return stringify(value);
}

interface ParsedCall {
  name: string;
  args: string[];
}

interface ParsedExpr {
  field: string;
  format?: string;
  calls: ParsedCall[];
}

function parseExpr(expr: string): ParsedExpr {
  let i = 0;
  const skipWs = () => {
    while (i < expr.length && /\s/.test(expr[i]!)) i += 1;
  };
  const readIdent = () => {
    let ident = "";
    while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i]!)) {
      ident += expr[i]!;
      i += 1;
    }
    return ident;
  };

  skipWs();
  let field = "";
  let format: string | undefined;

  const ancestor = expr.slice(i).match(/^ancestor\(\s*(-?\d+)\s*\)/i);
  if (ancestor) {
    field = `ancestor(${ancestor[1]})`;
    i += ancestor[0].length;
  } else {
    field = readIdent();
    while (true) {
      skipWs();
      if (expr[i] !== ".") break;
      const save = i;
      i += 1;
      skipWs();
      const next = readIdent();
      if (next && !CHAIN_SET.has(next)) {
        field += `.${next}`;
        continue;
      }
      i = save;
      break;
    }
    skipWs();
    if (expr[i] === ":") {
      i += 1;
      format = "";
      while (i < expr.length && expr[i] !== ".") {
        format += expr[i]!;
        i += 1;
      }
      format = format.trim();
    }
  }

  const calls: ParsedCall[] = [];
  while (i < expr.length) {
    skipWs();
    if (expr[i] !== ".") break;
    i += 1;
    skipWs();
    const name = readIdent();
    skipWs();
    let args: string[] = [];
    if (expr[i] === "(") {
      const close = findMatchingParen(expr, i);
      args = parseArgs(expr.slice(i + 1, close));
      i = close + 1;
    }
    if (name) calls.push({ name, args });
  }

  return { field, format, calls };
}

function findMatchingParen(input: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escape = false;
  for (let i = open; i < input.length; i += 1) {
    const ch = input[i]!;
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
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unclosed function call in template: ${input}`);
}

function parseArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escape = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (quote) {
      if (escape) {
        current += unescapeQuoted(ch);
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ",") {
      args.push(current);
      current = "";
      continue;
    }
    if (/\s/.test(ch) && current === "") continue;
    current += ch;
  }
  if (escape) current += "\\";
  if (quote) throw new Error("Unclosed string in template function");
  if (raw.trim() === "") return [];
  args.push(current);
  return args.map((item) => item.trim());
}

function unescapeQuoted(ch: string): string {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "'":
    case '"':
    case "\\":
      return ch;
    default:
      return `\\${ch}`;
  }
}

function resolveField(field: string, format: string | undefined, ctx: RuleContext): unknown {
  const ancestor = field.match(/^ancestor\((-?\d+)\)$/i);
  if (ancestor) return ancestorName(ctx.path, Number(ancestor[1]));
  if (DATE_FIELDS.has(field)) {
    const ms = Number(getContextValue(ctx, field) ?? 0);
    return formatDate(ms, format || "yyyyMMdd");
  }
  if (field === "now") {
    return formatDate(Date.now(), format || "yyyyMMdd");
  }
  const value = getContextValue(ctx, field);
  return value ?? "";
}

export function formatDate(ms: number, fmt: string): string {
  const date = new Date(ms);
  const map: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    dd: pad2(date.getDate()),
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds()),
  };
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => map[token] ?? token);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
