import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RuleStepSummary } from '@/lib/ipc'
import {
  STEP_COLOR,
  STEP_LABEL,
  STEP_SHAPE,
  summarizeStep,
} from './rule-step-display'

export type RuleStepChainReadOnlyProps = {
  steps: RuleStepSummary[] | undefined
  className?: string
  /** 默认展开。要做"折叠的摘要"，传 false。 */
  defaultOpen?: boolean
  /** 当 steps 为空时回退显示这条提示；传 false 隐藏。 */
  emptyHint?: string
}

/**
 * 只读步骤链摘要：用于内置规则只读视图与详情面板。
 *
 * 设计原则（与编辑版一致，v3 主线）：
 *   - 主视图永远只画真实生效的节点，不画假流程图。
 *   - 形状区分节点类型；颜色语义统一来自 rule-step-display.ts。
 *   - 嵌套只在用户主动展开后显示缩进的子节点。
 */
export function RuleStepChainReadOnly({
  steps,
  className,
  defaultOpen = true,
  emptyHint,
}: RuleStepChainReadOnlyProps) {
  const list = steps ?? []
  if (list.length === 0) {
    if (emptyHint === undefined) return null
    return (
      <p className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}>
        {emptyHint}
      </p>
    )
  }
  return (
    <ol className={cn('space-y-1.5', className)}>
      {list.map((step) => (
        <ReadOnlyStepRow key={step.id} step={step} depth={0} defaultOpen={defaultOpen} />
      ))}
    </ol>
  )
}

function ReadOnlyStepRow({
  step,
  depth,
  defaultOpen,
}: {
  step: RuleStepSummary
  depth: number
  defaultOpen: boolean
}) {
  const children = childSteps(step)
  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md border border-transparent bg-muted/40 px-2 py-1.5 text-sm"
        style={depth > 0 ? { marginLeft: depth * 16 } : undefined}
      >
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-sm text-[11px] font-medium',
            STEP_COLOR[step.kind],
          )}
          aria-hidden
        >
          {STEP_SHAPE[step.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{summarizeStep(step)}</span>
        {children.length > 0 ? (
          <Badge variant="outline" className="text-[10px]">
            {STEP_LABEL[step.kind]}
          </Badge>
        ) : null}
      </div>
      {children.length > 0 && defaultOpen ? (
        <ol className="mt-1.5 space-y-1.5">
          {children.map((child) => (
            <ReadOnlyStepRow
              key={child.id}
              step={child}
              depth={depth + 1}
              defaultOpen={defaultOpen}
            />
          ))}
        </ol>
      ) : null}
    </li>
  )
}

function childSteps(step: RuleStepSummary): RuleStepSummary[] {
  if (step.kind === 'ifElse') {
    const thenSteps = step.then ?? []
    const elseSteps = step.else ?? []
    return [...thenSteps, ...elseSteps]
  }
  if (step.kind === 'forEach') {
    return step.steps ?? []
  }
  return []
}
