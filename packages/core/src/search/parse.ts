export type ParsedSearchQuery = {
  textTerms: string[];
  phrase?: string;
  ext?: string[];
  parent?: string;
  kind?: string;
  path?: string;
  size?: SearchComparisonFilter;
  mtime?: SearchComparisonFilter;
  ctime?: SearchComparisonFilter;
  depth?: SearchComparisonFilter;
  nameDate?: string;
  pathDate?: string;
  datePattern?: string;
  nameLength?: SearchComparisonFilter;
  nameDigits?: "true" | "any";
  has?: string;
  missing?: string;
  dup?: boolean;
  uniqueVideo?: boolean;
  isSidecar?: boolean;
  windowsIllegal?: boolean;
  usefulFileCount?: SearchComparisonFilter;
  sameStem?: boolean;
  orphanSidecar?: boolean;
  childCount?: SearchComparisonFilter;
  fileCount?: SearchComparisonFilter;
  dirCount?: SearchComparisonFilter;
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
  | { type: "not"; child: SearchBooleanNode }
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
  | "name_date"
  | "path_date"
  | "date_pattern"
  | "name_length"
  | "name_digits"
  | "child_count"
  | "file_count"
  | "dir_count"
  | "has"
  | "missing"
  | "dup"
  | "ctime"
  | "unique_video"
  | "is_sidecar"
  | "windows_illegal"
  | "useful_file_count"
  | "same_stem"
  | "orphan_sidecar";

type Token = {
  value: string;
  quoted: boolean;
  filter?: SearchFilterField;
  or?: boolean;
  and?: boolean;
  not?: boolean;
};

export type SearchToken = Token;

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
  "name_date",
  "path_date",
  "date_pattern",
  "name_length",
  "name_digits",
  "child_count",
  "file_count",
  "dir_count",
  "has",
  "missing",
  "dup",
  "ctime",
  "unique_video",
  "is_sidecar",
  "windows_illegal",
  "useful_file_count",
  "same_stem",
  "orphan_sidecar",
]);

export const SEARCH_FILTER_KEYS = FILTER_KEYS;

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const textTerms: string[] = [];
  const exts: string[] = [];
  let phrase: string | undefined;
  let parent: string | undefined;
  let kind: string | undefined;
  let path: string | undefined;
  let size: SearchComparisonFilter | undefined;
  let mtime: SearchComparisonFilter | undefined;
  let ctime: SearchComparisonFilter | undefined;
  let depth: SearchComparisonFilter | undefined;
  let nameDate: string | undefined;
  let pathDate: string | undefined;
  let datePattern: string | undefined;
  let nameLength: SearchComparisonFilter | undefined;
  let nameDigits: "true" | "any" | undefined;
  let childCount: SearchComparisonFilter | undefined;
  let fileCount: SearchComparisonFilter | undefined;
  let dirCount: SearchComparisonFilter | undefined;
  let has: string | undefined;
  let missing: string | undefined;
  let dup: boolean | undefined;
  let uniqueVideo: boolean | undefined;
  let isSidecar: boolean | undefined;
  let windowsIllegal: boolean | undefined;
  let usefulFileCount: SearchComparisonFilter | undefined;
  let sameStem: boolean | undefined;
  let orphanSidecar: boolean | undefined;

  const tokens = tokenize(input);
  const expression = buildExpression(tokens);
  for (const token of tokens) {
    if (token.or || token.and || isStandaloneNot(token) || token.not) {
      continue;
    }
    if (token.filter === "ext") {
      for (const value of token.value.split("|")) {
        const ext = normalizeExt(value);
        if (ext) {
          exts.push(ext);
        }
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
    if (token.filter === "ctime") {
      ctime = parseMtimeFilter(token.value) ?? ctime;
      continue;
    }
    if (token.filter === "depth") {
      depth = parseIntegerFilter(token.value) ?? depth;
      continue;
    }
    if (token.filter === "name_date") {
      if (isDatePattern(token.value)) nameDate = token.value;
      continue;
    }
    if (token.filter === "path_date") {
      if (isDatePattern(token.value)) pathDate = token.value;
      continue;
    }
    if (token.filter === "date_pattern") {
      if (isDatePattern(token.value)) datePattern = token.value;
      continue;
    }
    if (token.filter === "name_length") {
      nameLength = parseIntegerFilter(token.value) ?? nameLength;
      continue;
    }
    if (token.filter === "child_count" || token.filter === "file_count" || token.filter === "dir_count" || token.filter === "useful_file_count") {
      const parsed = parseIntegerFilter(token.value);
      if (parsed) {
        if (token.filter === "child_count") childCount = parsed;
        if (token.filter === "file_count") fileCount = parsed;
        if (token.filter === "dir_count") dirCount = parsed;
        if (token.filter === "useful_file_count") usefulFileCount = parsed;
      }
      continue;
    }
    if (token.filter === "name_digits") {
      const value = token.value.toLowerCase();
      if (value === "true" || value === "any") nameDigits = value;
      continue;
    }
    if (token.filter === "has") {
      const value = token.value.toLowerCase();
      if (value) {
        has = value;
      }
      continue;
    }
    if (token.filter === "missing") {
      const value = token.value.toLowerCase();
      if (value) {
        missing = value;
      }
      continue;
    }
    if (token.filter === "dup") {
      dup = token.value.toLowerCase() === "true";
      continue;
    }
    if (token.filter === "unique_video") {
      uniqueVideo = token.value.toLowerCase() === "true";
      continue;
    }
    if (token.filter === "is_sidecar") {
      isSidecar = token.value.toLowerCase() === "true";
      continue;
    }
    if (token.filter === "windows_illegal") {
      windowsIllegal = token.value.toLowerCase() === "true";
      continue;
    }
    if (token.filter === "same_stem") {
      sameStem = token.value.toLowerCase() === "true";
      continue;
    }
    if (token.filter === "orphan_sidecar") {
      orphanSidecar = token.value.toLowerCase() === "true";
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
  if (ctime) {
    parsed.ctime = ctime;
  }
  if (depth) {
    parsed.depth = depth;
  }
  if (nameDate) {
    parsed.nameDate = nameDate;
  }
  if (pathDate) {
    parsed.pathDate = pathDate;
  }
  if (datePattern) {
    parsed.datePattern = datePattern;
  }
  if (nameLength) {
    parsed.nameLength = nameLength;
  }
  if (nameDigits) {
    parsed.nameDigits = nameDigits;
  }
  if (childCount) {
    parsed.childCount = childCount;
  }
  if (fileCount) {
    parsed.fileCount = fileCount;
  }
  if (dirCount) {
    parsed.dirCount = dirCount;
  }
  if (has) {
    parsed.has = has;
  }
  if (missing) {
    parsed.missing = missing;
  }
  if (dup !== undefined) {
    parsed.dup = dup;
  }
  if (uniqueVideo !== undefined) {
    parsed.uniqueVideo = uniqueVideo;
  }
  if (isSidecar !== undefined) {
    parsed.isSidecar = isSidecar;
  }
  if (windowsIllegal !== undefined) {
    parsed.windowsIllegal = windowsIllegal;
  }
  if (usefulFileCount) {
    parsed.usefulFileCount = usefulFileCount;
  }
  if (sameStem !== undefined) {
    parsed.sameStem = sameStem;
  }
  if (orphanSidecar !== undefined) {
    parsed.orphanSidecar = orphanSidecar;
  }
  if (expression && containsBoolean(expression)) {
    parsed.expression = expression;
  }
  return parsed;
}

export function tokenizeSearchQuery(input: string): SearchToken[] {
  return tokenize(input);
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

    const negatedFilter = input[i] === "-" ? matchFilterKey(input, i + 1) : null;
    const filter = negatedFilter ?? matchFilterKey(input, i);
    if (filter) {
      i = filter.nextIndex;
      const value = readValue(input, i);
      i = value.nextIndex;
      tokens.push({
        filter: filter.key,
        value: value.text,
        quoted: value.quoted,
        not: Boolean(negatedFilter),
      });
      continue;
    }

    const value = readValue(input, i);
    i = value.nextIndex;
    if (!filter && !value.quoted && value.text.toUpperCase() === "OR") {
      tokens.push({ value: value.text, quoted: false, or: true });
      continue;
    }
    if (!filter && !value.quoted && value.text.toUpperCase() === "AND") {
      tokens.push({ value: value.text, quoted: false, and: true });
      continue;
    }
    if (!filter && !value.quoted && value.text.toUpperCase() === "NOT") {
      tokens.push({ value: value.text, quoted: false, not: true });
      continue;
    }
    if (!filter && !value.quoted && value.text.startsWith("-") && value.text.length > 1) {
      tokens.push({ value: value.text.slice(1), quoted: false, not: true });
      continue;
    }
    tokens.push({ value: value.text, quoted: value.quoted });
  }
  return tokens;
}

function buildExpression(tokens: readonly Token[]): SearchBooleanNode | null {
  const groups: Token[][] = [[]];
  for (const token of applyUnaryNot(tokens)) {
    if (token.or) {
      groups.push([]);
    } else {
      groups.at(-1)!.push(token);
    }
  }

  const children: SearchBooleanNode[] = [];
  for (const group of groups) {
    const node = buildAndGroup(group);
    if (node) {
      children.push(node);
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

function buildAndGroup(tokens: readonly Token[]): SearchBooleanNode | null {
  const groups: Token[][] = [[]];
  for (const token of tokens) {
    if (token.and) {
      groups.push([]);
    } else {
      groups.at(-1)!.push(token);
    }
  }

  const children: SearchBooleanNode[] = [];
  for (const group of groups) {
    const node = buildImplicitGroup(group);
    if (node) {
      children.push(node);
    }
  }
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0]!;
  }
  return { type: "and", children };
}

function buildImplicitGroup(tokens: readonly Token[]): SearchBooleanNode | null {
  const texts: SearchBooleanNode[] = [];
  const filters: SearchBooleanNode[] = [];
  for (const token of tokens) {
    const node = tokenToNode(token);
    if (!node) {
      continue;
    }
    if (node.type === "text") {
      texts.push(node);
    } else {
      filters.push(node);
    }
  }

  const textNode = texts.length === 0
    ? null
    : texts.length === 1
      ? texts[0]!
      : { type: "or" as const, children: texts };
  const nodes = [...(textNode ? [textNode] : []), ...filters];
  if (nodes.length === 0) {
    return null;
  }
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return { type: "and", children: nodes };
}

function containsBoolean(node: SearchBooleanNode): boolean {
  if (node.type === "or" || node.type === "not") {
    return true;
  }
  if (node.type === "and") {
    return node.children.some(containsBoolean);
  }
  return false;
}

function applyUnaryNot(tokens: readonly Token[]): Token[] {
  const next: Token[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isStandaloneNot(token)) {
      const target = tokens[index + 1];
      if (target && !isConnector(target) && !isStandaloneNot(target)) {
        next.push({ ...target, not: true });
        index += 1;
      }
      continue;
    }
    next.push(token);
  }
  return next;
}

function isStandaloneNot(token: Token): boolean {
  return Boolean(token.not) && !token.filter && token.value.toUpperCase() === "NOT";
}

function isConnector(token: Token): boolean {
  return Boolean(token.or || token.and || isStandaloneNot(token));
}

function tokenToNode(token: Token): SearchBooleanNode | null {
  if (token.or || token.and || isStandaloneNot(token) || !token.value) {
    return null;
  }
  const node = tokenToPositiveNode(token);
  if (!node) {
    return null;
  }
  return token.not ? { type: "not", child: node } : node;
}

function tokenToPositiveNode(token: Token): SearchBooleanNode | null {
  if (!token.filter) {
    return { type: "text", value: token.value, phrase: token.quoted };
  }
  if (token.filter === "ext") {
    const values = token.value.split("|").map(normalizeExt).filter(Boolean);
    return values.length > 0 ? { type: "filter", field: "ext", values } : null;
  }
  if (token.filter === "type" || token.filter === "kind") {
    const values = token.value.split("|").map((value) => value.toLowerCase()).filter(Boolean);
    return values.length > 0 ? { type: "filter", field: "kind", values } : null;
  }
  if (token.filter === "parent" || token.filter === "path" || token.filter === "dir") {
    return token.value ? { type: "filter", field: token.filter, values: [token.value] } : null;
  }
  return { type: "filter", field: token.filter, values: [token.value] };
}

function isDatePattern(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && /^(?:[yY]{2,4}|[mM]{1,2}|[dD]{1,2}|[hH]{1,2}|[sS]{1,2}|[^A-Za-z])+$/.test(normalized) && /y/i.test(normalized);
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
  const dynamic = dynamicTimestamp(trimmed, edge);
  if (dynamic !== undefined) {
    return dynamic;
  }
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

/** Resolve relative date words at query time, using the user's local calendar. */
function dynamicTimestamp(value: string, edge: "start" | "end"): number | undefined {
  const now = new Date();
  const dayStart = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayEnd = (date: Date): number => dayStart(date) + 24 * 60 * 60 * 1000 - 1;
  const shiftDays = (date: Date, days: number): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

  switch (value.toLowerCase()) {
    case "today":
      return edge === "start" ? dayStart(now) : dayEnd(now);
    case "yesterday": {
      const date = shiftDays(now, -1);
      return edge === "start" ? dayStart(date) : dayEnd(date);
    }
    case "this_week": {
      const mondayOffset = (now.getDay() + 6) % 7;
      const monday = shiftDays(now, -mondayOffset);
      const nextMonday = shiftDays(monday, 7);
      return edge === "start" ? dayStart(monday) : dayStart(nextMonday) - 1;
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return edge === "start" ? start.getTime() : next.getTime() - 1;
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const next = new Date(now.getFullYear() + 1, 0, 1);
      return edge === "start" ? start.getTime() : next.getTime() - 1;
    }
    case "last_7_days":
      return edge === "start" ? dayStart(shiftDays(now, -6)) : now.getTime();
    case "last_30_days":
      return edge === "start" ? dayStart(shiftDays(now, -29)) : now.getTime();
    case "last_24_hours":
      return edge === "start" ? now.getTime() - 24 * 60 * 60 * 1000 : now.getTime();
    case "last_90_days":
      return edge === "start" ? dayStart(shiftDays(now, -89)) : now.getTime();
    case "last_week": {
      const mondayOffset = (now.getDay() + 6) % 7;
      const thisMonday = shiftDays(now, -mondayOffset);
      const previousMonday = shiftDays(thisMonday, -7);
      return edge === "start" ? dayStart(previousMonday) : dayStart(thisMonday) - 1;
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const next = new Date(now.getFullYear(), now.getMonth(), 1);
      return edge === "start" ? start.getTime() : next.getTime() - 1;
    }
    case "last_year": {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const next = new Date(now.getFullYear(), 0, 1);
      return edge === "start" ? start.getTime() : next.getTime() - 1;
    }
    default:
      return undefined;
  }
}

export function parseIntegerFilter(value: string): SearchComparisonFilter | undefined {
  const range = /^(\d+)\.\.(\d+)$/.exec(value.trim());
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min <= max) {
      return { operator: "between", min, max };
    }
    return undefined;
  }

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
