// 规则模块数据类型定义。
//
// 设计要点（v2 步骤链升级）：
// - 老的 RuleDefinition（match + action + template + extract + reason）保留不变，
//   存量规则与 BUILTIN_RULESETS 不需要迁移；planRuleset 优先走 steps，回退到老路径。
// - 步骤链由一组 RuleStep 节点按优先级串联组成，覆盖三种控制流：
//     filter    谓词保留（精简 IF，单分支）
//     ifElse    真正分支（命中走 then，否则走 else）
//     forEach   遍历（对每个元素执行子步骤）
//     transform 计算变量并写入当前作用域
//     action    最终动作（rename_file 等）
// - "上下传值"由编译器维护的 ScopeFrame[] 解决：
//     每帧是 { vars, active }；读变量时按 "自身 → 父 → 祖父 → 全局 ctx" 顺序查。
// - 模板里通过 "scope.<stepId>.<var>" 或 "scope.last.<var>" 访问上一步输出。
//   全局 ctx 的字段（name / stem / ext / children.* / ancestor(-1) 等）保持原状。

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

// —— 步骤链节点（v2 升级新增） ——————————————————————————————

/** 步骤作用的"目标对象"。决定该步骤作用在 entry 本身上、某个子列表、还是上一步变量上。 */
export type StepTarget =
  /** 作用在当前选中 entry 上（默认）。 */
  | { kind: 'self' }
  /** 作用在 entry.children 列表上，每一项分别跑子步骤。forEach 内部使用。 */
  | { kind: 'children' }
  /** 作用在上一步写入的具名变量上（例如 forEach 里的当前元素）。 */
  | { kind: 'scope'; step: string; var: string }

/** filter 节点：谓词为 true 才保留当前条目。 */
export interface FilterStep {
  id: string
  kind: 'filter'
  when: MatchTree
  target?: StepTarget
  why?: string
}

/** ifElse 节点：谓词命中走 then，否则走 else（else 可省略代表空分支）。 */
export interface IfElseStep {
  id: string
  kind: 'ifElse'
  when: MatchTree
  then: RuleStep | RuleStep[]
  else?: RuleStep | RuleStep[]
  why?: string
}

/** forEach 节点：对目标列表每个元素执行一次子步骤序列，并把当前元素写入 as 指定的变量。 */
export interface ForEachStep {
  id: string
  kind: 'forEach'
  of: StepTarget
  as: string
  /** v2.1：子步骤数组（支持嵌套 ifElse / forEach）。老数据只有单步 step 时由 normalizeStep 兼容。 */
  steps: RuleStep[]
  why?: string
}

/** transform 节点：把表达式计算结果写入指定变量，供后续步骤引用。 */
export interface TransformStep {
  id: string
  kind: 'transform'
  from: StepTarget
  as: string
  /** 模板字符串，例如 "{name.regex_replace('\\\\[[^\\\\]]*\\\\]','')}" */
  expr: string
  why?: string
}

/** action 节点：触发命名动作，可挂模板。必为步骤链的最后一个动作。 */
export interface ActionStep {
  id: string
  kind: 'action'
  action: RuleAction
  target?: StepTarget
  template?: string
  reason?: string
}

export type RuleStep = FilterStep | IfElseStep | ForEachStep | TransformStep | ActionStep

/**
 * 兼容旧数据（forEach 单步 / ifElse 单步）的规范化：
 * - forEach 只有 step 字段 → 包装成 steps: [step]
 * - 递归处理嵌套节点
 * UI 与求值器统一消费规范化后的树。
 */
export function normalizeStep(step: RuleStep): RuleStep {
  const s = step as unknown as Record<string, unknown>
  if (s.kind === 'forEach') {
    const fe = s as unknown as { id: string; kind: 'forEach'; of: StepTarget; as: string; step?: RuleStep; steps?: RuleStep[]; why?: string }
    const steps = (fe.steps ?? (fe.step ? [fe.step] : [])).map(normalizeStep)
    return { id: fe.id, kind: 'forEach', of: fe.of, as: fe.as, steps, why: fe.why }
  }
  if (s.kind === 'ifElse') {
    const ie = s as unknown as { id: string; kind: 'ifElse'; when: MatchTree; then?: RuleStep | RuleStep[]; else?: RuleStep | RuleStep[]; why?: string }
    const wrap = (v: RuleStep | RuleStep[] | undefined): RuleStep[] =>
      (v === undefined ? [] : Array.isArray(v) ? v : [v]).map(normalizeStep)
    return { id: ie.id, kind: 'ifElse', when: ie.when, then: wrap(ie.then), else: ie.else ? wrap(ie.else) : undefined, why: ie.why }
  }
  return step
}

/** 用于运行时追踪每步骤是否被触发、命中条件、产生的变量。UI 在调试面板里展示。 */
export interface RuleStepTrace {
  id: string
  kind: RuleStep['kind']
  matched: boolean
  skipped?: boolean
  produced?: Record<string, unknown>
  children?: RuleStepTrace[]
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
  /** v2：步骤链。若存在，planRuleset 优先走步骤链；否则回退到 match+action+template 路径。 */
  steps?: RuleStep[]
  /** 步骤链的展示用：每个子步骤未配 steps 时的扁平描述，便于 UI 折叠显示。 */
  summary?: string
}

export interface Extractor {
  from: string
}

export interface RuleSet {
  id: string
  name: string
  description?: string
  dryRunDefault: boolean
  collision: CollisionStrategy
  rules: RuleDefinition[]
}

// —— 类型守卫（步骤节点用） ——————————————————————————————

export function isFilterStep(step: RuleStep): step is FilterStep {
  return step.kind === 'filter'
}
export function isIfElseStep(step: RuleStep): step is IfElseStep {
  return step.kind === 'ifElse'
}
export function isForEachStep(step: RuleStep): step is ForEachStep {
  return step.kind === 'forEach'
}
export function isTransformStep(step: RuleStep): step is TransformStep {
  return step.kind === 'transform'
}
export function isActionStep(step: RuleStep): step is ActionStep {
  return step.kind === 'action'
}
