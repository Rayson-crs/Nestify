export type ParsedSearchQuery = {
  textTerms: string[];
  phrase?: string;
  ext?: string[];
  parent?: string;
  kind?: string;
  path?: string;
  size?: SearchComparisonFilter;
  mtime?: SearchComparisonFilter;
  depth?: SearchComparisonFilter;
  has?: string;
  dup?: boolean;
  expression?: SearchBooleanNode;
};

export type SearchComparisonFilter = {
  operator: "eq" | "gt" | "gte" | "lt" | "lte" | "between";
  value?: number;
  min?: number;
  max?: number;
};

export type SearchBooleanNode =
  | { type: "and"; children: SearchBooleanNode[] }
  | { type: "or"; children: SearchBooleanNode[] }
  | { type: "text"; value: string; phrase: boolean }
  | { type: "filter"; field: SearchFilterField; values: string[] };

type SearchFilterField =
  | "ext"
  | "parent"
  | "dir"
  | "type"
  | "kind"
  | "path"
  | "size"
  | "mtime"
  | "depth"
  | "has"
  | "dup";

type Token = {
  value: string;
  quoted: boolean;
  filter?: SearchFilterField;
  or?: boolean;
};

const FILTER_KEYS = new Set([
  "ext",
  "parent",
  "dir",
  "type",
  "kind",
  "path",
  "size",
  "mtime",
  "depth",
  "has",
  "dup",
]);

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const textTerms: string[] = [];
  const exts: string[] = [];
  let phrase: string | undefined;
  let parent: string | undefined;
  let kind: string | undefined;
  let path: string | undefined;
  let size: SearchComparisonFilter | undefined;
  let mtime: SearchComparisonFilter | undefined;
  let depth: SearchComparisonFilter | undefined;
  let has: string | undefined;
  let dup: boolean | undefined;

  const tokens = tokenize(input);
  const expression = buildExpression(tokens);
  for (const token of tokens) {
    if (token.or) {
      continue;
    }
    if (token.filter === "ext") {
      const ext = normalizeExt(token.value);
      if (ext) {
        exts.push(ext);
      }
      continue;
    }
    if (token.filter === "parent" || token.filter === "dir") {
      if (token.value) {
        parent = token.value;
      }
      continue;
    }
    if (token.filter === "type" || token.filter === "kind") {
      if (token.value) {
        kind = token.value;
      }
      continue;
    }
    if (token.filter === "path") {
      if (token.value) {
        path = token.value;
      }
      continue;
    }
    if (token.filter === "size") {
      size = parseSizeFilter(token.value) ?? size;
      continue;
    }
    if (token.filter === "mtime") {
      mtime = parseMtimeFilter(token.value) ?? mtime;
      continue;
    }
    if (token.filter === "depth") {
      depth = parseIntegerFilter(token.value) ?? depth;
      continue;
    }
    if (token.filter === "has") {
      const value = token.value.toLowerCase();
      if (value) {
        has = value;
      }
      continue;
    }
    if (token.filter === "dup") {
      dup = token.value.toLowerCase() === "true";
      continue;
    }
    if (!token.value) {
      continue;
    }
    if (token.quoted) {
      phrase = phrase ? `${phrase} ${token.value}` : token.value;
    } else {
      textTerms.push(token.value);
    }
  }

  const parsed: ParsedSearchQuery = { textTerms };
  if (phrase) {
    parsed.phrase = phrase;
  }
  if (exts.length > 0) {
    parsed.ext = exts;
  }
  if (parent) {
    parsed.parent = parent;
  }
  if (kind) {
    parsed.kind = kind;
  }
  if (path) {
    parsed.path = path;
  }
  if (size) {
    parsed.size = size;
  }
  if (mtime) {
    parsed.mtime = mtime;
  }
  if (depth) {
    parsed.depth = depth;
  }
  if (has) {
    parsed.has = has;
  }
  if (dup !== undefined) {
    parsed.dup = dup;
  }
  if (expression?.type === "or") {
    parsed.expression = expression;
  }
  return parsed;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && isSpace(input[i]!)) {
      i += 1;
    }
    if (i >= input.length) {
      break;
    }

    const filter = matchFilterKey(input, i);
    if (filter) {
      i = filter.nextIndex;
      const value = readValue(input, i);
      i = value.nextIndex;
      tokens.push({
        filter: filter.key,
        value: value.text,
        quoted: value.quoted,
      });
      continue;
    }

    const value = readValue(input, i);
    i = value.nextIndex;
    if (!filter && !value.quoted && value.text === "OR") {
      tokens.push({ value: value.text, quoted: false, or: true });
      continue;
    }
    tokens.push({ value: value.text, quoted: value.quoted });
  }
  return tokens;
}

function buildExpression(tokens: readonly Token[]): SearchBooleanNode | null {
  const groups: Token[][] = [[]];
  for (const token of tokens) {
    if (token.or) {
      groups.push([]);
    } else {
      groups.at(-1)!.push(token);
    }
  }

  const children: SearchBooleanNode[] = [];
  for (const group of groups) {
    const nodes = group
      .map(tokenToNode)
      .filter((node): node is SearchBooleanNode => node !== null);
    if (nodes.length === 1) {
      children.push(nodes[0]!);
    } else if (nodes.length > 1) {
      children.push({ type: "and", children: nodes });
    }
  }

  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0]!;
  }
  return { type: "or", children };
}

function tokenToNode(token: Token): SearchBooleanNode | null {
  if (token.or || !token.value) {
    return null;
  }
  if (!token.filter) {
    return { type: "text", value: token.value, phrase: token.quoted };
  }
  if (token.filter === "type" || token.filter === "kind") {
    const values = token.value.split("|").map((value) => value.toLowerCase()).filter(Boolean);
    return values.length > 0 ? { type: "filter", field: "kind", values } : null;
  }
  return { type: "filter", field: token.filter, values: [token.value] };
}

function matchFilterKey(
  input: string,
  index: number,
): { key: NonNullable<Token["filter"]>; nextIndex: number } | null {
  const colon = input.indexOf(":", index);
  if (colon <= index) {
    return null;
  }
  const key = input.slice(index, colon).toLowerCase();
  if (!FILTER_KEYS.has(key)) {
    return null;
  }
  if (/\s/.test(key)) {
    return null;
  }
  return { key: key as NonNullable<Token["filter"]>, nextIndex: colon + 1 };
}

function readValue(
  input: string,
  index: number,
): { text: string; quoted: boolean; nextIndex: number } {
  if (input[index] === `"`) {
    let i = index + 1;
    let text = "";
    while (i < input.length && input[i] !== `"`) {
      text += input[i]!;
      i += 1;
    }
    if (i < input.length && input[i] === `"`) {
      i += 1;
    }
    return { text, quoted: true, nextIndex: i };
  }

  let i = index;
  let text = "";
  while (i < input.length && !isSpace(input[i]!)) {
    text += input[i]!;
    i += 1;
  }
  return { text, quoted: false, nextIndex: i };
}

function normalizeExt(value: string): string {
  return value.replace(/^\.+/, "").toLowerCase();
}

export function parseSizeFilter(value: string): SearchComparisonFilter | undefined {
  const range = /^(.+?)\.\.(.+)$/.exec(value);
  if (range) {
    const min = parseSize(range[1]!);
    const max = parseSize(range[2]!);
    if (min !== undefined && max !== undefined) {
      return { operator: "between", min, max };
    }
    return undefined;
  }

  const match = /^(>=|<=|>|<|=)?(.+)$/.exec(value);
  const size = match ? parseSize(match[2]!) : undefined;
  if (size === undefined) {
    return undefined;
  }
  const operator = normalizeComparisonOperator(match?.[1]);
  return { operator, value: size } as SearchComparisonFilter;
}

export function parseSize(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)?$/i.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return undefined;
  }
  const multipliers = {
    b: 1,
    kb: 1000 ** 1,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    kib: 1024 ** 1,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
  } as const;
  const unit = (match[2] ?? "b").toLowerCase() as keyof typeof multipliers;
  const multiplier = multipliers[unit];
  return Math.round(amount * multiplier);
}

export function parseMtimeFilter(value: string): SearchComparisonFilter | undefined {
  const range = /^(.+?)\.\.(.+)$/.exec(value);
  if (range) {
    const min = parseTimestamp(range[1]!, "start");
    const max = parseTimestamp(range[2]!, "end");
    if (min !== undefined && max !== undefined) {
      return { operator: "between", min, max };
    }
    return undefined;
  }

  const match = /^(>=|<=|>|<|=)?(.+)$/.exec(value);
  const timestamp = match ? parseTimestamp(match[2]!, "start") : undefined;
  if (timestamp === undefined) {
    return undefined;
  }
  const operator = normalizeComparisonOperator(match?.[1]);
  if (operator === "eq") {
    const end = parseTimestamp(match![2]!, "end");
    return end === undefined ? undefined : { operator: "between", min: timestamp, max: end };
  }
  return { operator, value: timestamp } as SearchComparisonFilter;
}

function parseTimestamp(value: string, edge: "start" | "end"): number | undefined {
  const trimmed = value.trim();
  const year = /^(\d{4})$/.exec(trimmed);
  if (year) {
    const yearValue = Number(year[1]!);
    return edge === "start"
      ? Date.UTC(yearValue, 0, 1)
      : Date.UTC(yearValue + 1, 0, 1) - 1;
  }

  const month = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
  if (month) {
    const yearValue = Number(month[1]!);
    const monthValue = Number(month[2]!) - 1;
    return edge === "start"
      ? Date.UTC(yearValue, monthValue, 1)
      : Date.UTC(yearValue, monthValue + 1, 1) - 1;
  }

  const day = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (day) {
    const yearValue = Number(day[1]!);
    const monthValue = Number(day[2]!) - 1;
    const dayValue = Number(day[3]!);
    return edge === "start"
      ? Date.UTC(yearValue, monthValue, dayValue)
      : Date.UTC(yearValue, monthValue, dayValue + 1) - 1;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function parseIntegerFilter(value: string): SearchComparisonFilter | undefined {
  const match = /^(>=|<=|>|<|=)?(\d+)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return {
    operator: normalizeComparisonOperator(match[1]),
    value: Number(match[2]),
  };
}

function normalizeComparisonOperator(operator: string | undefined): SearchComparisonFilter["operator"] {
  switch (operator) {
    case ">":
      return "gt";
    case ">=":
      return "gte";
    case "<":
      return "lt";
    case "<=":
      return "lte";
    default:
      return "eq";
  }
}

function isSpace(char: string): boolean {
  return /\s/.test(char);
}
