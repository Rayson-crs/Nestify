export type CollisionStrategy = 'suffix' | 'skip' | 'overwrite'

export type RuleAction =
  | 'rename_dir'
  | 'flatten_dir'
  | 'rename_file'
  | 'move'
  | 'delete_to_quarantine'

export interface MatchAtom {
  field: string
  eq?: unknown
  ne?: unknown
  ne_field?: string
  gt?: number
  gte?: number
  lt?: number
  lte?: number
  regex?: string
  'in'?: unknown[]
  contains?: string
  prefix?: string
  suffix?: string
  exists?: boolean
}

export type MatchTree =
  | MatchAtom
  | { all: MatchTree[] }
  | { any: MatchTree[] }
  | { not: MatchTree }

export interface Extractor {
  from: string
}

export interface RuleDefinition {
  id: string
  enabled: boolean
  priority: number
  action: RuleAction
  match?: MatchTree
  template?: string
  extract?: Record<string, Extractor>
  reason?: string
}

export interface RuleSet {
  id: string
  name: string
  description?: string
  dryRunDefault: boolean
  collision: CollisionStrategy
  rules: RuleDefinition[]
}
