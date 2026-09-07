export type ParsedSearchQuery = {
  textTerms: string[];
  phrase?: string;
  ext?: string[];
  parent?: string;
  kind?: string;
  path?: string;
};

type Token = {
  value: string;
  quoted: boolean;
  filter?: "ext" | "parent" | "type" | "kind" | "path";
};

const FILTER_KEYS = new Set(["ext", "parent", "type", "kind", "path"]);

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const textTerms: string[] = [];
  const exts: string[] = [];
  let phrase: string | undefined;
  let parent: string | undefined;
  let kind: string | undefined;
  let path: string | undefined;

  for (const token of tokenize(input)) {
    if (token.filter === "ext") {
      const ext = normalizeExt(token.value);
      if (ext) {
        exts.push(ext);
      }
      continue;
    }
    if (token.filter === "parent") {
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
    tokens.push({ value: value.text, quoted: value.quoted });
  }
  return tokens;
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

function isSpace(char: string): boolean {
  return /\s/.test(char);
}