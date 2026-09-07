export const PLACEHOLDERS = [
  'name',
  'ext',
  'parent',
  'grandparent',
  'ancestor',
  'depth',
  'date_created',
  'date_modified',
  'seq',
  'parent_seq',
  'kind',
] as const

export type PlaceholderName = (typeof PLACEHOLDERS)[number]

export const CHAIN_FUNCS = [
  'trim',
  'upper',
  'lower',
  'title',
  'replace',
  'regex_replace',
  'slice',
  'pad',
  'sanitize',
  'collapse_space',
  'remove_ads',
] as const

export type ChainFuncName = (typeof CHAIN_FUNCS)[number]
