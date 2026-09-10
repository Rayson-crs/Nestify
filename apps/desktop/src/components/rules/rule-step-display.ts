// 步骤链节点展示用的样式常量与文本助手。
// RuleStepChainSection（编辑）和 RuleStepChainReadOnly（只读）共用。

import type { RuleStepSummary } from '@/lib/ipc'

export const STEP_SHAPE: Record<RuleStepSummary['kind'], string> = {
  filter: 'IF',
  ifElse: '◆',
  forEach: '▣',
  transform: 'X=',
  action: 'GO',
}

export const STEP_COLOR: Record<RuleStepSummary['kind'], string> = {
  filter: 'bg-sky-100 text-sky-700',
  ifElse: 'bg-amber-100 text-amber-700',
  forEach: 'bg-violet-100 text-violet-700',
  transform: 'bg-slate-100 text-slate-700',
  action: 'bg-emerald-100 text-emerald-700',
}

export const STEP_LABEL: Record<RuleStepSummary['kind'], string> = {
  filter: 'IF 过滤',
  ifElse: 'IF/ELSE',
  forEach: 'FOR 遍历',
  transform: '写入变量',
  action: '执行动作',
}

export function summarizeStep(step: RuleStepSummary): string {
  switch (step.kind) {
    case 'filter':
      return step.why ?? '保留命中条件的条目'
    case 'ifElse':
      return step.why ?? '条件分支'
    case 'forEach':
      return `对每个 "${step.as}" 执行 ${step.steps?.length ?? 0} 个子步骤`
    case 'transform':
      return `${step.as} := ${shorten(step.expr)}`
    case 'action':
      return `${step.action}${step.template ? ` → ${shorten(step.template)}` : ''}`
  }
}

export function shorten(text: string, max = 32): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}
