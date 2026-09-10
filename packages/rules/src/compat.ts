// 把老 RuleDefinition（match + action + template + extract）编译成等价的步骤链，
// 让 planRuleset 不写分支判断就能直接走步骤链路径。
//
// 翻译策略：
//   1. 若已存在 steps，则规范化（forEach 单步 → steps 数组）后返回。
//   2. 否则把整条 rule 编译为 [FilterStep(match), ActionStep(action, template)]，
//      其中 extract 字段被并入到 ActionStep 模板前的隐式 transform（占位：`extract` 暂保留
//      在 rule 上，ActionStep 执行时仍按老路径读取 extract）。

import type { RuleDefinition, RuleStep } from './types.ts'
import { isForEachStep, isIfElseStep, normalizeStep } from './types.ts'

export function legacyRuleToSteps(rule: RuleDefinition): RuleStep[] {
  if (rule.steps && rule.steps.length > 0) {
    return rule.steps.map(normalizeStep)
  }
  const steps: RuleStep[] = []
  if (rule.match != null) {
    steps.push({
      id: `${rule.id}:filter`,
      kind: 'filter',
      when: rule.match,
      target: { kind: 'self' },
      why: '保留匹配条件的条目',
    })
  }
  steps.push({
    id: `${rule.id}:action`,
    kind: 'action',
    action: rule.action,
    target: { kind: 'self' },
    template: rule.template,
    reason: rule.reason,
  })
  return steps
}

export interface FlatStepNode {
  step: RuleStep
  depth: number
  /** 所在容器路径：'root' | '<stepId>:then' | '<stepId>:else' | '<stepId>:body' */
  container: string
}

/** 拍平嵌套（含 forEach steps 数组），UI 渲染与变量可见性共用。 */
export function flattenStepTree(steps: RuleStep[]): FlatStepNode[] {
  const out: FlatStepNode[] = []
  const visit = (list: RuleStep[], depth: number, container: string) => {
    for (const raw of list) {
      const step = normalizeStep(raw)
      out.push({ step, depth, container })
      if (isIfElseStep(step)) {
        const thenArr = Array.isArray(step.then) ? step.then : [step.then]
        const elseArr = step.else ? (Array.isArray(step.else) ? step.else : [step.else]) : []
        visit(thenArr.map(normalizeStep), depth + 1, `${step.id}:then`)
        visit(elseArr.map(normalizeStep), depth + 1, `${step.id}:else`)
      } else if (isForEachStep(step)) {
        visit(step.steps, depth + 1, `${step.id}:body`)
      }
    }
  }
  visit(steps, 0, 'root')
  return out
}

/** 向后兼容：老调用方只要节点序列。 */
export function flattenSteps(steps: RuleStep[]): RuleStep[] {
  return flattenStepTree(steps).map((node) => node.step)
}

/** 找到最外层第一个 action 节点；没找到返回 undefined。 */
export function findTopAction(steps: RuleStep[]): import('./types.ts').ActionStep | undefined {
  for (const step of steps) {
    if (step.kind === 'action') return step
  }
  return undefined
}
