export type AssistantContext =
  | "search"
  | "search-field"
  | "scope-filter"
  | "rename-template"
  | "rename-group-filter";

export type AssistantItemKind =
  | "field"
  | "value"
  | "comparison"
  | "relative-date"
  | "date-pattern"
  | "stats"
  | "sidecar"
  | "recipe"
  | "operator"
  | "chain"
  | "parameterized-chain"
  | "snippet";

export type AssistantEngineKind =
  | "search-filter"
  | "search-text"
  | "search-recipe"
  | "rename-field"
  | "rename-chain"
  | "rename-snippet";

export type AssistantParam = {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
};

export type AssistantItem = {
  id: string;
  label: string;
  value: string;
  group: string;
  kind: AssistantItemKind;
  engine: AssistantEngineKind;
  contexts?: AssistantContext[];
  searchFields?: string[];
  params?: AssistantParam[];
  hidden?: boolean;
  help?: string;
  example?: string;
};

export type SearchFieldDefinition = {
  value: string;
  label: string;
  hint: string;
  comparison?: boolean;
};

export type SearchBuilderPart = {
  field: string;
  operator: string;
  value: string;
  joiner: "AND" | "OR";
};
