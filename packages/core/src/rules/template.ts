import { CHAIN_FUNCS } from "./placeholders.ts";
import { compileRegex } from "./match.ts";
import { ancestorName, getContextValue, type RuleContext } from "./context.ts";

const DATE_FIELDS = new Set(["date_created", "date_modified"]);
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
    value = applyChain(stringify(value), call.name, call.args);
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

export function applyChain(value: string, name: string, args: string[]): string {
  switch (name) {
    case "trim":
      return value.trim();
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "title":
      return value.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    case "replace":
      return value.split(args[0] ?? "").join(args[1] ?? "");
    case "regex_replace": {
      const re = compileRegex(args[0] ?? "");
      const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
      return value.replace(global, args[1] ?? "");
    }
    case "slice": {
      const start = Number(args[0] ?? 0);
      const end = args[1] == null || args[1] === "" ? undefined : Number(args[1]);
      return value.slice(start, end);
    }
    case "pad": {
      const width = Number(args[0] ?? 0);
      const fill = args[1] || "0";
      return value.padStart(width, fill);
    }
    case "sanitize":
      return sanitizeName(value);
    case "collapse_space":
      return value.replace(/\s+/g, " ").trim();
    case "remove_ads":
      return removeAds(value);
    case "dedupe":
      return Array.from(new Set(Array.from(value))).join("");
    case "length":
      return String(Array.from(value).length);
    case "reverse":
      return Array.from(value).reverse().join("");
    case "capitalize":
      return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
    case "normalize":
      return value.normalize("NFKC");
    case "keep_digits":
      return value.replace(/[^0-9]/g, "");
    case "remove_digits":
      return value.replace(/[0-9]/g, "");
    case "keep_letters":
      return value.replace(/[^A-Za-z\u00C0-\uFFFF]/g, "");
    case "remove_punctuation":
      return value.replace(/[!-/:-@[-`{-~，。！？：；、“”‘’（）【】《》、…]/g, "");
    case "repeat": {
      const count = Math.max(0, Math.min(20, Number(args[0] ?? 1)));
      return value.repeat(Number.isFinite(count) ? count : 1);
    }
    case "truncate": {
      const limit = Math.max(0, Number(args[0] ?? 0));
      if (!Number.isFinite(limit) || Array.from(value).length <= limit) return value;
      return `${Array.from(value).slice(0, limit).join("")}…`;
    }
    case "pad_end": {
      const width = Number(args[0] ?? 0);
      const fill = args[1] || "0";
      return value.padEnd(width, fill);
    }
    default:
      throw new Error(`Unknown template function: ${name}`);
  }
}

export function sanitizeName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .replace(/_+/g, "_")
    .trim();
}

function removeAds(value: string): string {
  return value
    .replace(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(com|net|org|cc|tv|xyz)(?:\/\S*)?[-_ ]*/gi, "")
    .replace(/【[^】]*广告[^】]*】/g, "")
    .replace(/^[-_\s]+/, "")
    .trim();
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
