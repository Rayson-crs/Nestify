import { SEARCH_FILTER_KEYS } from "../search/parse.ts";
import { RENAME_CHAINS, RENAME_ITEMS } from "./rename-items.ts";
import { SEARCH_FIELD_DEFINITIONS, SEARCH_ITEMS } from "./search-items.ts";
import type { AssistantContext, AssistantItem, SearchFieldDefinition } from "./types.ts";

export const ASSISTANT_CATALOG: AssistantItem[] = [
  ...SEARCH_ITEMS,
  ...RENAME_ITEMS,
  ...RENAME_CHAINS,
];

const SEARCH_CONTEXTS = new Set<AssistantContext>([
  "search",
  "search-field",
  "scope-filter",
  "rename-group-filter",
]);

export function itemsForContext(context: AssistantContext, searchField?: string): AssistantItem[] {
  return ASSISTANT_CATALOG.filter((item) => {
    if (item.hidden) return false;
    const contexts = item.contexts ?? defaultContexts(item);
    if (!contexts.includes(context)) return false;
    if (context === "search-field") return matchesSearchField(item, searchField);
    if (searchField && SEARCH_CONTEXTS.has(context)) {
      return matchesSearchField(item, searchField);
    }
    return true;
  });
}

export function searchFieldDefinitions(context: AssistantContext = "search"): SearchFieldDefinition[] {
  if (context === "scope-filter" || context === "rename-group-filter") {
    return SEARCH_FIELD_DEFINITIONS.filter((field) => field.value !== "dup");
  }
  return SEARCH_FIELD_DEFINITIONS;
}

export function comparisonSearchFields(): Set<string> {
  return new Set(
    SEARCH_FIELD_DEFINITIONS.filter((field) => field.comparison).map((field) => field.value),
  );
}

export function knownSearchFilterKeys(): string[] {
  return [...SEARCH_FILTER_KEYS];
}

function matchesSearchField(item: AssistantItem, searchField?: string): boolean {
  const field = searchField || "text";
  if (!item.searchFields?.length) return field === "text";
  return item.searchFields.includes(field);
}

function defaultContexts(item: AssistantItem): AssistantContext[] {
  if (item.engine.startsWith("rename")) return ["rename-template"];
  return ["search", "search-field", "scope-filter", "rename-group-filter"];
}
