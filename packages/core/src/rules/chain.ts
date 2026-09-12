import { compileRegex } from "./match.ts";

export type ChainContext = {
  parent?: string;
  grandparent?: string;
  ext?: string;
  path?: string;
};

export function applyChain(value: string, name: string, args: string[], ctx: ChainContext = {}): string {
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
    case "pad":
    case "pad_start": {
      const width = Number(args[0] ?? 0);
      const fill = args[1] || "0";
      return value.padStart(width, fill);
    }
    case "pad_end": {
      const width = Number(args[0] ?? 0);
      const fill = args[1] || "0";
      return value.padEnd(width, fill);
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
    case "remove_letters":
      return value.replace(/[A-Za-z\u00C0-\uFFFF]/g, "");
    case "keep_alnum":
      return value.replace(/[^0-9A-Za-z\u00C0-\uFFFF]/g, "");
    case "keep_ascii":
      return value.replace(/[^\x20-\x7E]/g, "");
    case "remove_punctuation":
      return value.replace(/[!-/:-@[-`{-~，。！？：；、“”‘’（）【】《》、…]/g, "");
    case "remove_space":
      return value.replace(/\s+/g, "");
    case "remove_brackets":
      return value.replace(/[\(\)\[\]\{\}（）【】《》<>]/g, "");
    case "remove_bracket_content":
      return value.replace(/[\(\[（【][^\)\]）】]*[\)\]）】]/g, "").replace(/\s+/g, " ").trim();
    case "remove_copy_suffix":
      return value.replace(/(?:\s*-\s*(?:副本|Copy)(?:\s*\(\d+\))?|\s*\(\d+\))+$/gi, "").trim();
    case "collapse_dots":
      return collapse(value.replace(/\./g, " "));
    case "strip_ext_in_name":
      return value.replace(/\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|jpg|jpeg|png|webp|gif|bmp|mp3|flac|aac|wav|zip|rar|7z)(?=$|\.)/gi, "");
    case "extract_number":
      return value.match(/\d+/)?.[0] ?? "";
    case "extract_last_number": {
      const matches = value.match(/\d+/g);
      return matches?.[matches.length - 1] ?? "";
    }
    case "pad_number": {
      const width = Number(args[0] ?? 3);
      const fill = args[1] || "0";
      return value.replace(/\d+/, (match) => match.padStart(Number.isFinite(width) ? width : 3, fill));
    }
    case "extract_resolution":
      return normalizeResolution(value) || (value.match(/\b(?:\d{3,4}p|4k|8k|uhd)\b/i)?.[0] ?? "");
    case "normalize_resolution":
      return normalizeResolution(value);
    case "extract_season_episode":
      return extractSeasonEpisode(value);
    case "extract_episode":
      return extractEpisode(value);
    case "remove_year":
      return collapse(value.replace(/(?:^|[\s._\-\[\(])(?:19|20)\d{2}(?:$|[\s._\-\]\)])/g, " "));
    case "extract_date":
      return extractDate(value, args[0] || "yyyy-MM-dd");
    case "match": {
      const re = compileRegex(args[0] ?? "");
      const found = value.match(re);
      return found?.[1] ?? found?.[0] ?? "";
    }
    case "nth_word": {
      const words = splitWords(value);
      const index = Number(args[0] ?? 1);
      if (!Number.isFinite(index) || index === 0) return "";
      return index > 0 ? (words[index - 1] ?? "") : (words[words.length + index] ?? "");
    }
    case "split_at": {
      const separator = args[0] ?? "";
      const index = Number(args[1] ?? 1);
      if (!separator) return value;
      const parts = value.split(separator);
      if (!Number.isFinite(index) || index === 0) return "";
      return index > 0 ? (parts[index - 1] ?? "") : (parts[parts.length + index] ?? "");
    }
    case "wrap": {
      const left = args[0] ?? "";
      const right = args[1] ?? left;
      return `${left}${value}${right}`;
    }
    case "to_halfwidth":
      return toHalfwidth(value);
    case "remove_emoji":
      return collapse(value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ""));
    case "zh_space_fix":
      return collapse(
        value
          .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, "$1 $2")
          .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, "$1 $2"),
      );
    case "filename_safe_colon":
      return value.replace(/:/g, "：");
    case "remove_edition_tags":
      return collapse(value.replace(/\b(?:bluray|blu-ray|web-?dl|webrip|hdtv|dvdrip|repack|hdr10\+?|hdr|remux|proper)\b/gi, ""));
    case "extract_source":
      return value.match(/\b(?:BluRay|Blu-ray|WEB-?DL|WEBRip|HDTV|DVDRip)\b/i)?.[0] ?? "";
    case "repeat": {
      const count = Math.max(0, Math.min(20, Number(args[0] ?? 1)));
      return value.repeat(Number.isFinite(count) ? count : 1);
    }
    case "truncate": {
      const limit = Math.max(0, Number(args[0] ?? 0));
      if (!Number.isFinite(limit) || Array.from(value).length <= limit) return value;
      return `${Array.from(value).slice(0, limit).join("")}…`;
    }
    case "snake_case":
      return toDelimited(value, "_");
    case "kebab_case":
      return toDelimited(value, "-");
    case "camel_case": {
      const words = splitWords(value);
      return words
        .map((word, index) => (index === 0 ? word.toLowerCase() : capitalizeWord(word)))
        .join("");
    }
    case "pascal_case":
      return splitWords(value).map(capitalizeWord).join("");
    case "constant_case":
      return toDelimited(value, "_").toUpperCase();
    case "spaces_to_underscore":
      return value.replace(/\s+/g, "_");
    case "underscore_to_space":
      return value.replace(/[_\-]+/g, " ");
    case "prefix":
      return `${args[0] ?? ""}${value}`;
    case "suffix":
      return `${value}${args[0] ?? ""}`;
    case "ensure_prefix": {
      const prefix = args[0] ?? "";
      return prefix && value.startsWith(prefix) ? value : `${prefix}${value}`;
    }
    case "ensure_suffix": {
      const suffix = args[0] ?? "";
      return suffix && value.endsWith(suffix) ? value : `${value}${suffix}`;
    }
    case "remove_prefix": {
      const prefix = args[0] ?? "";
      return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
    }
    case "remove_suffix": {
      const suffix = args[0] ?? "";
      return suffix && value.endsWith(suffix) ? value.slice(0, value.length - suffix.length) : value;
    }
    case "before": {
      const needle = args[0] ?? "";
      if (!needle) return value;
      const index = value.indexOf(needle);
      return index < 0 ? value : value.slice(0, index);
    }
    case "after": {
      const needle = args[0] ?? "";
      if (!needle) return value;
      const index = value.indexOf(needle);
      return index < 0 ? "" : value.slice(index + needle.length);
    }
    case "between": {
      const start = args[0] ?? "";
      const end = args[1] ?? "";
      if (!start && !end) return value;
      const from = start ? value.indexOf(start) : 0;
      if (from < 0) return "";
      const begin = start ? from + start.length : 0;
      const to = end ? value.indexOf(end, begin) : value.length;
      return to < 0 ? value.slice(begin) : value.slice(begin, to);
    }
    case "first_word":
      return splitWords(value)[0] ?? "";
    case "last_word": {
      const words = splitWords(value);
      return words[words.length - 1] ?? "";
    }
    case "initials":
      return splitWords(value).map((word) => word.charAt(0)).join("").toUpperCase();
    case "insert": {
      const index = Number(args[0] ?? 0);
      const inserted = args[1] ?? "";
      const chars = Array.from(value);
      const at = Number.isFinite(index) ? Math.max(0, Math.min(chars.length, index < 0 ? chars.length + index : index)) : 0;
      return `${chars.slice(0, at).join("")}${inserted}${chars.slice(at).join("")}`;
    }
    case "if_empty":
      return value.trim() ? value : (args[0] ?? "");
    case "extract_year": {
      const match = value.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
      return match?.[1] ?? "";
    }
    case "format_size":
      return formatBytes(Number(value) || 0);
    case "if_contains": {
      const needle = args[0] ?? "";
      if (!needle) return value;
      return value.toLowerCase().includes(needle.toLowerCase()) ? (args[1] ?? value) : value;
    }
    case "max_len": {
      const explicit = args[0] == null || args[0] === "" ? Number.NaN : Number(args[0]);
      const limit = Number.isFinite(explicit) ? Math.max(0, explicit) : remainingNameBudget(ctx);
      const chars = Array.from(value);
      return chars.length <= limit ? value : chars.slice(0, limit).join("");
    }
    case "take_parent_if_numeric":
      return /^\d+$/.test(value.trim()) ? (ctx.parent || value) : value;
    case "take_grandparent_if_cd":
      return isCdFolderName(ctx.parent) || isCdFolderName(value) ? (ctx.grandparent || value) : value;
    case "ensure_ext": {
      const ext = normalizeExt(args[0] || ctx.ext || "");
      if (!ext) return value;
      return value.toLowerCase().endsWith(ext.toLowerCase()) ? value : `${value}${ext}`;
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

function splitWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./\\]+/g, " ")
    .split(/[^0-9A-Za-z\u00C0-\uFFFF]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function capitalizeWord(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

function toDelimited(value: string, delimiter: string): string {
  return splitWords(value).map((word) => word.toLowerCase()).join(delimiter);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 10 || unit === 0 ? 0 : 1;
  return `${size.toFixed(digits)}${units[unit]}`;
}

function collapse(value: string): string {
  return value.replace(/[\s._\-]+/g, " ").trim();
}

function normalizeResolution(value: string): string {
  const match = value.match(/\b(?:4320p|2160p|1080p|720p|480p|4k|8k|uhd)\b/i);
  if (!match) return "";
  const token = match[0].toLowerCase();
  if (token === "4k" || token === "uhd") return "2160p";
  if (token === "8k") return "4320p";
  return token;
}

function extractSeasonEpisode(value: string): string {
  const seasonEpisode = value.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
  if (seasonEpisode) return `S${pad2(seasonEpisode[1]!)}E${pad2(seasonEpisode[2]!)}`;
  const xNotation = value.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (xNotation) return `S${pad2(xNotation[1]!)}E${pad2(xNotation[2]!)}`;
  const chinese = value.match(/第\s*(\d{1,3})\s*集/);
  if (chinese) return `E${pad2(chinese[1]!)}`;
  return "";
}

function extractEpisode(value: string): string {
  const seasonEpisode = extractSeasonEpisode(value);
  const episode = seasonEpisode.match(/E(\d+)/i)?.[1];
  if (episode) return episode;
  const plain = value.match(/\bE(\d{1,3})\b/i);
  return plain ? pad2(plain[1]!) : "";
}

function extractDate(value: string, format: string): string {
  const dashed = value.match(/\b((?:19|20)\d{2})[-_.](\d{1,2})[-_.](\d{1,2})\b/);
  const compact = value.match(/\b((?:19|20)\d{2})(\d{2})(\d{2})\b/);
  const match = dashed ?? compact;
  if (!match) return "";
  const year = match[1]!;
  const month = pad2(match[2]!);
  const day = pad2(match[3]!);
  return format
    .replace(/yyyy/g, year)
    .replace(/MM/g, month)
    .replace(/dd/g, day);
}

function toHalfwidth(value: string): string {
  return Array.from(value.normalize("NFKC"), (char) => {
    const code = char.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
    if (code === 0x3000) return " ";
    return char;
  }).join("");
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function normalizeExt(ext: string): string {
  const trimmed = ext.trim();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function isCdFolderName(value: string | undefined): boolean {
  return Boolean(value && /^(?:cd|disc|disk|dvd)\s*-?\s*\d+$/i.test(value.trim()));
}

function remainingNameBudget(ctx: ChainContext): number {
  const ext = normalizeExt(ctx.ext || "");
  const parentPath = ctx.path ? ctx.path.replace(/[\\/][^\\/]+$/, "") : "";
  if (!parentPath) return 255;
  return Math.max(1, 260 - parentPath.length - 1 - ext.length);
}
