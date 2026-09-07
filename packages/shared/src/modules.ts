export const MODULE_IDS = [
  'scan',
  'search',
  'duplicates',
  'rename',
  'preview',
  'organize',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];