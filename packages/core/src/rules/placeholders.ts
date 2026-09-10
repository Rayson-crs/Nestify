export const PLACEHOLDERS = [
  'name',
  'ext',
  'parent',
  'grandparent',
  'ancestor',
  'depth',
  'date_created',
  'date_modified',
  'now',
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
  'dedupe',
  'length',
  'reverse',
  'capitalize',
  'normalize',
  'keep_digits',
  'remove_digits',
  'keep_letters',
  'remove_punctuation',
  'repeat',
  'truncate',
  'pad_end',
] as const

export type ChainFuncName = (typeof CHAIN_FUNCS)[number]
