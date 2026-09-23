import type { MediaMergeItem } from "@nestify/shared";
import type { MatchAtom, MatchTree } from "@nestify/rules";
import {
  parseMtimeFilter,
  parseSearchQuery,
  parseSizeFilter,
  type SearchBooleanNode,
  type SearchComparisonFilter,
} from "../search/parse.ts";

export function mediaItemMatchesPattern(item: MediaMergeItem, pattern: string): boolean {
  const source = pattern.trim();
  if (!source) return true;
  const parsed = parseSearchQuery(source);
  if (parsed.expression) return evaluateNode(parsed.expression, item);
  return matchesFlatQuery(item, parsed);
}

function matchesFlatQuery(
  item: MediaMergeItem,
  parsed: ReturnType<typeof parseSearchQuery>,
): boolean {
  const facts = mediaFacts(item);
  const text = parsed.phrase ? [parsed.phrase, ...parsed.textTerms] : parsed.textTerms;
  if (text.length > 0 && !text.some((term) => includes(facts.haystack, term))) return false;
  if (parsed.ext?.length && !parsed.ext.some((value) => facts.extension === value.toLowerCase())) return false;
  if (parsed.name && !includes(facts.name, parsed.name)) return false;
  if (parsed.fileName && !includes(facts.name, parsed.fileName)) return false;
  if (parsed.folderName && !includes(facts.parent, parsed.folderName)) return false;
  if (parsed.parent && !includes(facts.parent, parsed.parent)) return false;
  if (parsed.path && !includes(facts.path, parsed.path)) return false;
  if (parsed.kind && !kindMatches(facts.kind, parsed.kind)) return false;
  if (parsed.size && !compareNumber(facts.size, parsed.size)) return false;
  if (parsed.mtime && (facts.mtime == null || !compareNumber(facts.mtime, parsed.mtime))) return false;
  return true;
}

function evaluateNode(node: SearchBooleanNode, item: MediaMergeItem): boolean {
  if (node.type === "and") return node.children.every((child) => evaluateNode(child, item));
  if (node.type === "or") return node.children.some((child) => evaluateNode(child, item));
  if (node.type === "not") return !evaluateNode(node.child, item);
  if (node.type === "text") return includes(mediaFacts(item).haystack, node.value);
  if (node.type === "rule") return evaluateRule(node.rule, item);
  return evaluateFilter(node.field, node.values, item);
}

function evaluateFilter(field: string, values: string[], item: MediaMergeItem): boolean {
  const facts = mediaFacts(item);
  const value = values[0] ?? "";
  if (field === "ext") return values.some((entry) => facts.extension === entry.toLowerCase());
  if (field === "name" || field === "file_name") return includes(facts.name, value);
  if (field === "folder_name" || field === "parent" || field === "dir") return includes(facts.parent, value);
  if (field === "path") return includes(facts.path, value);
  if (field === "kind" || field === "type") return values.some((entry) => kindMatches(facts.kind, entry));
  if (field === "size") return compareNumber(facts.size, parseSizeFilter(value));
  if (field === "mtime") return facts.mtime != null && compareNumber(facts.mtime, parseMtimeFilter(value));
  return false;
}

function evaluateRule(tree: MatchTree, item: MediaMergeItem): boolean {
  if ("all" in tree) return tree.all.every((child) => evaluateRule(child, item));
  if ("any" in tree) return tree.any.some((child) => evaluateRule(child, item));
  if ("not" in tree) return !evaluateRule(tree.not, item);
  return evaluateRuleAtom(tree, mediaFacts(item));
}

function evaluateRuleAtom(atom: MatchAtom, facts: ReturnType<typeof mediaFacts>): boolean {
  const field = ruleField(atom.field, facts);
  if (field == null) return false;
  if (atom.contains != null) return includes(field, String(atom.contains));
  if (atom.prefix != null) return field.toLowerCase().startsWith(String(atom.prefix).toLowerCase());
  if (atom.suffix != null) return field.toLowerCase().endsWith(String(atom.suffix).toLowerCase());
  if (atom.eq !== undefined) return field.toLowerCase() === String(atom.eq).toLowerCase();
  if (atom.regex != null) {
    try {
      return new RegExp(atom.regex, "i").test(field);
    } catch {
      return false;
    }
  }
  return false;
}

function ruleField(field: string, facts: ReturnType<typeof mediaFacts>): string | null {
  if (field === "name" || field === "stem" || field === "filename" || field === "file_name") return facts.name;
  if (field === "folder_name" || field === "parent") return facts.parent;
  if (field === "path" || field === "relPath") return facts.path;
  if (field === "ext" || field === "ext_no_dot") return facts.extension;
  if (field === "kind") return facts.kind;
  return null;
}

function mediaFacts(item: MediaMergeItem): {
  path: string
  name: string
  parent: string
  extension: string
  kind: string
  size: number
  mtime: number | null
  haystack: string
} {
  const separator = Math.max(item.path.lastIndexOf("/"), item.path.lastIndexOf("\\"));
  const name = separator >= 0 ? item.path.slice(separator + 1) : item.path;
  const parent = separator >= 0 ? item.path.slice(0, separator) : "";
  const dot = name.lastIndexOf(".");
  return {
    path: item.path,
    name,
    parent,
    extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
    kind: item.kind,
    size: item.size,
    mtime: item.mtime,
    haystack: `${name}\n${item.path}`,
  };
}

function kindMatches(actual: string, expected: string): boolean {
  const value = expected.toLowerCase();
  if (value === "file" || value === actual) return true;
  return value === "image" && actual === "image";
}

function compareNumber(actual: number, filter: SearchComparisonFilter | undefined): boolean {
  if (!filter) return false;
  if (filter.operator === "between") {
    return filter.min !== undefined && filter.max !== undefined && actual >= filter.min && actual <= filter.max;
  }
  if (filter.value === undefined) return false;
  if (filter.operator === "eq") return actual === filter.value;
  if (filter.operator === "gt") return actual > filter.value;
  if (filter.operator === "gte") return actual >= filter.value;
  if (filter.operator === "lt") return actual < filter.value;
  return actual <= filter.value;
}

function includes(value: string, term: string): boolean {
  return value.toLowerCase().includes(term.toLowerCase());
}
