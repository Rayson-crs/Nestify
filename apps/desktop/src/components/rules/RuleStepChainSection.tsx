import { useCallback, useId, useMemo, useState } from 'react'
import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { RuleSetJsonField, parseUnknownJson } from '@/components/rules/RuleSetJsonField'
import { cn } from '@/lib/utils'
import type { RuleAction, RuleStepSummary, RuleStepTarget } from '@/lib/ipc'
import {
  STEP_COLOR,
  STEP_LABEL,
  STEP_SHAPE,
  shorten,
  summarizeStep,
} from './rule-step-display'

export type RuleStepChainSectionProps = {
  steps: RuleStepSummary[] | undefined
  onChange: (steps: RuleStepSummary[]) => void
  /** 顶层 rule 的 id，用作新增 step 的 id 前缀，便于追溯。 */
  ruleId: string
  disabled?: boolean
  className?: string
}

/**
 * 步骤链编辑区（v4 · 树形拖拽编排）。
 *
 *   1. 树形结构：IF/ELSE 与 FOR 是容器节点，子步骤缩进排列在容器内；
 *      支持任意深度嵌套（FOR 套 IF、IF 套 FOR、FOR 套 FOR……）。
 *   2. 拖拽：拖动行左侧手柄 → 上半区插入该行之前、下半区插入之后；
 *      拖到容器标题行 = 拖入容器第一分支末尾；拖到分支空白区 = 追加到该分支末尾。
 *   3. 添加：每个分支尾部「+ 子步骤」；顶部「添加步骤」加顶层节点。
 *   4. 选中任意节点 → 下方面板编辑该节点自身字段（when / expr / template / as / of）。
 *
 * 路径模型：PathSeg = number | 'then' | 'else' | 'body'。
 *   [0,'body',2] = 顶层第 0 个节点的 forEach 循环体里第 2 个子步骤。
 */
export function RuleStepChainSection({
  steps,
  onChange,
  ruleId,
  disabled = false,
  className,
}: RuleStepChainSectionProps) {
  const list = steps ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [dragPath, setDragPath] = useState<PathSeg[] | null>(null)
  const summaryId = useId()

  const flatten = useMemo(() => flattenSteps(list), [list])
  const selectedEntry = selected ? flatten.find((entry) => entry.step.id === selected) : undefined
  const selectedStep = selectedEntry?.step
  const selectedIndex = selected ? flatten.findIndex((entry) => entry.step.id === selected) : -1
  const availableVars = selectedIndex >= 0 ? scopeAt(flatten, selectedIndex) : {}

  const commit = useCallback(
    (next: RuleStepSummary[]) => onChange(next),
    [onChange],
  )

  /** 把 dragPath 节点移动到 parentPath 列表的 index 处。 */
  const moveNode = useCallback(
    (parentPath: PathSeg[], index: number) => {
      if (!dragPath) return
      const result = moveStep(list, dragPath, parentPath, index)
      if (result) commit(result)
      setDragPath(null)
    },
    [dragPath, list, commit],
  )

  const insertStepAt = useCallback(
    (parentPath: PathSeg[], index: number, step: RuleStepSummary) => {
      const next = insertStep(cloneSteps(list), parentPath, index, step)
      if (next) commit(next)
      setSelected(step.id)
    },
    [list, commit],
  )

  const deleteByPath = useCallback(
    (path: PathSeg[]) => {
      const next = removeStep(cloneSteps(list), path)
      if (next) commit(next)
    },
    [list, commit],
  )

  const patchByPath = useCallback(
    (path: PathSeg[], patch: RuleStepSummary) => {
      const next = replaceStep(cloneSteps(list), path, patch)
      if (next) commit(next)
    },
    [list, commit],
  )

  return (
    <section className={cn('space-y-3 rounded-lg border bg-muted/20 p-3', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">执行步骤</span>
          <Badge variant="outline">{flatten.length}</Badge>
          <span id={summaryId} className="sr-only">
            树形步骤链：支持拖拽排序与跨层拖入 IF / FOR 容器。
          </span>
          <span className="text-[11px] text-muted-foreground" aria-hidden>
            拖拽排序 / 跨层拖入容器；后面的步骤可引用前面的变量
          </span>
        </div>
        <AddStepMenu
          ruleId={ruleId}
          disabled={disabled}
          onAdd={(step) => insertStepAt([], list.length, step)}
        />
      </header>

      <StepTreeList
        steps={list}
        containerPath={[]}
        depth={0}
        disabled={disabled}
        selected={selected}
        dragging={dragPath}
        onSelect={setSelected}
        onDragStart={setDragPath}
        onDragEnd={() => setDragPath(null)}
        onMove={moveNode}
        onInsert={insertStepAt}
        onDelete={deleteByPath}
      />

      {selectedStep && selectedEntry ? (
        <NodeEditor
          step={selectedStep}
          availableVars={availableVars}
          disabled={disabled}
          onCommit={(next) => patchByPath(selectedEntry.path, next)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  )
}

// —— 树形列表与节点渲染 ————————————————————————————

function StepTreeList(props: {
  steps: RuleStepSummary[]
  containerPath: PathSeg[]
  depth: number
  disabled: boolean
  selected: string | null
  dragging: PathSeg[] | null
  onSelect: (id: string | null) => void
  onDragStart: (path: PathSeg[]) => void
  onDragEnd: () => void
  onMove: (parentPath: PathSeg[], index: number) => void
  onInsert: (parentPath: PathSeg[], index: number, step: RuleStepSummary) => void
  onDelete: (path: PathSeg[]) => void
}) {
  const { steps, containerPath } = props
  if (steps.length === 0 && containerPath.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-background/60 px-3 py-4 text-center">
        <p className="text-xs text-muted-foreground">还没有步骤。点击右上「添加步骤」开始编排：</p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          IF 过滤 → 保留命中的文件 · IF/ELSE 分支 → 按条件走两条路 · FOR 遍历 → 对子项逐个处理 ·
          写入变量 → 清洗名称等中间结果 · 执行动作 → 重命名 / 移动 / 隔离
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {steps.map((step, index) => (
        <StepTreeNode
          key={step.id}
          step={step}
          path={[...containerPath, index]}
          depth={props.depth}
          disabled={props.disabled}
          selected={props.selected}
          dragging={props.dragging}
          onSelect={props.onSelect}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
          onMove={props.onMove}
          onInsert={props.onInsert}
          onDelete={props.onDelete}
        />
      ))}
      <AddChildRow
        label="步骤"
        disabled={props.disabled}
        dragging={props.dragging !== null}
        onAdd={(kind) => props.onInsert(containerPath, steps.length, createStep(kind, 'child'))}
        onDropEnd={() => props.onMove(containerPath, steps.length)}
      />
    </div>
  )
}

function StepTreeNode(props: {
  step: RuleStepSummary
  path: PathSeg[]
  depth: number
  disabled: boolean
  selected: string | null
  dragging: PathSeg[] | null
  onSelect: (id: string | null) => void
  onDragStart: (path: PathSeg[]) => void
  onDragEnd: () => void
  onMove: (parentPath: PathSeg[], index: number) => void
  onInsert: (parentPath: PathSeg[], index: number, step: RuleStepSummary) => void
  onDelete: (path: PathSeg[]) => void
}) {
  const { step } = props
  if (step.kind === 'ifElse' || step.kind === 'forEach') {
    return <ContainerNode {...props} step={step} />
  }
  return (
    <StepRow
      step={step}
      path={props.path}
      active={step.id === props.selected}
      disabled={props.disabled}
      dragging={props.dragging}
      onSelect={() => props.onSelect(step.id)}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onMove={props.onMove}
      onDelete={() => props.onDelete(props.path)}
    />
  )
}

function ContainerNode(props: {
  step: Extract<RuleStepSummary, { kind: 'ifElse' }> | Extract<RuleStepSummary, { kind: 'forEach' }>
  path: PathSeg[]
  depth: number
  disabled: boolean
  selected: string | null
  dragging: PathSeg[] | null
  onSelect: (id: string | null) => void
  onDragStart: (path: PathSeg[]) => void
  onDragEnd: () => void
  onMove: (parentPath: PathSeg[], index: number) => void
  onInsert: (parentPath: PathSeg[], index: number, step: RuleStepSummary) => void
  onDelete: (path: PathSeg[]) => void
}) {
  const { step, path } = props
  const isDraggingSelf = props.dragging && pathEquals(props.dragging, path)
  const branches: BranchSpec[] =
    step.kind === 'ifElse'
      ? [
          { key: 'then', label: '满足时 (then)', steps: step.then ?? [], dashed: false },
          { key: 'else', label: '否则 (else)', steps: step.else ?? [], dashed: true },
        ]
      : [{ key: 'body', label: `循环体 · 每一项 → ${step.as}`, steps: step.steps ?? [], dashed: false }]

  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-muted-foreground/40 bg-background/40',
        isDraggingSelf && 'opacity-50',
      )}
    >
      <ContainerHeaderRow
        step={step}
        path={path}
        active={step.id === props.selected}
        disabled={props.disabled}
        dragging={props.dragging}
        onSelect={() => props.onSelect(step.id)}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        onMoveInto={() => props.onMove([...path, branches[0]!.key], branches[0]!.steps.length)}
        onDelete={() => props.onDelete(path)}
      />
      <div className={cn('p-2 pt-0', step.kind === 'ifElse' && 'grid grid-cols-2 gap-2')} data-container={step.kind}>
        {branches.map((branch) => (
          <BranchGroup
            key={branch.key}
            label={branch.label}
            steps={branch.steps}
            branchKey={branch.key}
            parentPath={path}
            depth={props.depth + 1}
            dashed={branch.dashed}
            disabled={props.disabled}
            selected={props.selected}
            dragging={props.dragging}
            onSelect={props.onSelect}
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
            onMove={props.onMove}
            onInsert={props.onInsert}
            onDelete={props.onDelete}
          />
        ))}
      </div>
    </div>
  )
}

interface BranchSpec {
  key: 'then' | 'else' | 'body'
  label: string
  steps: RuleStepSummary[]
  dashed: boolean
}

function BranchGroup(props: {
  label: string
  steps: RuleStepSummary[]
  branchKey: 'then' | 'else' | 'body'
  parentPath: PathSeg[]
  depth: number
  dashed: boolean
  disabled: boolean
  selected: string | null
  dragging: PathSeg[] | null
  onSelect: (id: string | null) => void
  onDragStart: (path: PathSeg[]) => void
  onDragEnd: () => void
  onMove: (parentPath: PathSeg[], index: number) => void
  onInsert: (parentPath: PathSeg[], index: number, step: RuleStepSummary) => void
  onDelete: (path: PathSeg[]) => void
}) {
  const { steps, branchKey, parentPath } = props
  const listPath = [...parentPath, branchKey]
  return (
    <div
      className={cn(
        'rounded-md bg-muted/30 p-2',
        props.dashed && 'border border-dashed border-muted-foreground/30',
      )}
    >
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </div>
      <StepTreeList
        steps={steps}
        containerPath={listPath}
        depth={props.depth}
        disabled={props.disabled}
        selected={props.selected}
        dragging={props.dragging}
        onSelect={props.onSelect}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        onMove={props.onMove}
        onInsert={props.onInsert}
        onDelete={props.onDelete}
      />
    </div>
  )
}

/** 叶子步骤行：可拖拽；拖到上半区=插到它前面，下半区=插到它后面。 */
function StepRow(props: {
  step: RuleStepSummary
  path: PathSeg[]
  active: boolean
  disabled: boolean
  dragging: PathSeg[] | null
  onSelect: () => void
  onDragStart: (path: PathSeg[]) => void
  onDragEnd: () => void
  onMove: (parentPath: PathSeg[], index: number) => void
  onDelete: () => void
}) {
  const { step, path } = props
  const [dropEdge, setDropEdge] = useState<'before' | 'after' | null>(null)
  const parentPath = path.slice(0, -1)
  const index = path[path.length - 1] as number
  const canDrop = props.dragging !== null && !pathEquals(props.dragging, path)

  return (
    <div
      draggable={!props.disabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', step.id)
        props.onDragStart(path)
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        if (!canDrop) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        setDropEdge(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => setDropEdge(null)}
      onDrop={(event) => {
        if (!canDrop) return
        event.preventDefault()
        event.stopPropagation()
        const edge = dropEdge ?? 'after'
        setDropEdge(null)
        props.onMove(parentPath, edge === 'before' ? index : index + 1)
      }}
      className={cn(
        'relative flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
        props.active
          ? 'border-primary bg-primary/5'
          : 'border-transparent hover:border-muted-foreground/30 hover:bg-muted/40',
        props.dragging && pathEquals(props.dragging, path) && 'opacity-50',
        dropEdge === 'before' && 'before:absolute before:-top-1 before:left-1 before:right-1 before:h-0.5 before:rounded-full before:bg-primary',
        dropEdge === 'after' && 'after:absolute after:-bottom-1 after:left-1 after:right-1 after:h-0.5 after:rounded-full after:bg-primary',
      )}
    >
      <GripVertical
        className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50"
        aria-hidden
      />
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onSelect}
        className="flex flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[11px] font-medium',
            COLOR[step.kind],
          )}
          aria-hidden
        >
          {SHAPE[step.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{summarize(step)}</span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        disabled={props.disabled}
        onClick={props.onDelete}
        title="删除"
        className="h-7 w-7 shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

/** 容器标题行（IF/ELSE、FOR）：拖到标题行 = 拖入第一分支末尾。 */
function ContainerHeaderRow(props: {
  step: Extract<RuleStepSummary, { kind: 'ifElse' }> | Extract<RuleStepSummary, { kind: 'forEach' }>
  path: PathSeg[]
  active: boolean
  disabled: boolean
  dragging: PathSeg[] | null
  onSelect: () => void
  onDragStart: (path: PathSeg[]) => void
  onDragEnd: () => void
  onMoveInto: () => void
  onDelete: () => void
}) {
  const { step, path } = props
  const [hover, setHover] = useState(false)
  const canDrop =
    props.dragging !== null && !pathEquals(props.dragging, path) && !isDescendantPath(props.dragging, path)

  return (
    <div
      draggable={!props.disabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', step.id)
        props.onDragStart(path)
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        if (!canDrop) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(event) => {
        if (!canDrop) return
        event.preventDefault()
        event.stopPropagation()
        setHover(false)
        props.onMoveInto()
      }}
      className={cn(
        'm-2 flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
        props.active
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/20 bg-background hover:bg-muted/40',
        hover && 'ring-2 ring-primary/60',
        props.dragging && pathEquals(props.dragging, path) && 'opacity-50',
      )}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50" aria-hidden />
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onSelect}
        className="flex flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[11px] font-medium',
            COLOR[step.kind],
          )}
          aria-hidden
        >
          {SHAPE[step.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{summarize(step)}</span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        disabled={props.disabled}
        onClick={props.onDelete}
        title="删除整个容器（含子步骤）"
        className="h-7 w-7 shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

/** 分支/顶层列表尾部的「+ 子步骤」行，同时兼作列表末尾的拖放落点。 */
function AddChildRow(props: {
  label: string
  disabled: boolean
  dragging: boolean
  onAdd: (kind: RuleStepSummary['kind']) => void
  onDropEnd: () => void
}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const add = (kind: RuleStepSummary['kind']) => {
    props.onAdd(kind)
    setOpen(false)
  }
  return (
    <div
      onDragOver={(event) => {
        if (!props.dragging) return
        event.preventDefault()
        event.stopPropagation()
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(event) => {
        if (!props.dragging) return
        event.preventDefault()
        event.stopPropagation()
        setHover(false)
        props.onDropEnd()
      }}
      className={cn(
        'flex items-center gap-1 rounded-md px-1 py-0.5',
        hover && 'ring-2 ring-primary/60',
      )}
    >
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          disabled={props.disabled}
          onClick={() => setOpen((v) => !v)}
          className="h-7 text-[11px] text-muted-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          子步骤
        </Button>
        {open ? (
          <div className="absolute left-0 z-10 mt-1 w-44 rounded-md border bg-popover p-1 text-sm shadow-md">
            {(Object.keys(LABEL) as RuleStepSummary['kind'][]).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={props.disabled}
                onClick={() => add(kind)}
                className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
              >
                <span className="mr-2 align-middle">{SHAPE[kind]}</span>
                {LABEL[kind]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {props.dragging ? (
        <span className="text-[10px] text-muted-foreground">← 拖到这里追加到末尾</span>
      ) : null}
    </div>
  )
}

function AddStepMenu(props: {
  ruleId: string
  disabled: boolean
  onAdd: (step: RuleStepSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const add = (kind: RuleStepSummary['kind']) => {
    props.onAdd(createStep(kind, props.ruleId))
    setOpen(false)
  }
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Plus className="h-4 w-4" />
        添加步骤
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-popover p-1 text-sm shadow-md">
          {(
            [
              { kind: 'filter', label: 'IF 条件' },
              { kind: 'ifElse', label: 'IF / ELSE 分支' },
              { kind: 'forEach', label: 'FOR 遍历' },
              { kind: 'transform', label: '写入变量' },
              { kind: 'action', label: '执行动作' },
            ] as { kind: RuleStepSummary['kind']; label: string }[]
          ).map((entry) => (
            <button
              key={entry.kind}
              type="button"
              disabled={props.disabled}
              onClick={() => add(entry.kind)}
              className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
            >
              <span className="mr-2 align-middle">{SHAPE[entry.kind]}</span>
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// —— 节点编辑面板 ——————————————————————————————————

function NodeEditor(props: {
  step: RuleStepSummary
  availableVars: Record<string, string[]>
  disabled: boolean
  onCommit: (next: RuleStepSummary) => void
  onClose: () => void
}) {
  const { step } = props
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{LABEL[step.kind]} 节点</span>
        <Button size="sm" variant="ghost" onClick={props.onClose} className="h-7">
          收起
        </Button>
      </div>
      {step.kind === 'filter' ? <FilterEditor step={step} disabled={props.disabled} onCommit={props.onCommit} /> : null}
      {step.kind === 'ifElse' ? <IfElseEditor step={step} disabled={props.disabled} onCommit={props.onCommit} /> : null}
      {step.kind === 'forEach' ? <ForEachEditor step={step} disabled={props.disabled} onCommit={props.onCommit} /> : null}
      {step.kind === 'transform' ? <TransformEditor step={step} disabled={props.disabled} onCommit={props.onCommit} /> : null}
      {step.kind === 'action' ? <ActionEditor step={step} disabled={props.disabled} onCommit={props.onCommit} /> : null}
      <p className="text-[11px] text-muted-foreground">
        子步骤在上方树里添加 / 拖拽调整；此处只编辑当前节点自身字段。
      </p>
      <AvailableVarsPanel vars={props.availableVars} />
    </div>
  )
}

function FilterEditor({
  step,
  disabled,
  onCommit,
}: {
  step: Extract<RuleStepSummary, { kind: 'filter' }>
  disabled: boolean
  onCommit: (next: RuleStepSummary) => void
}) {
  return (
    <div className="grid gap-2">
      <RuleSetJsonField
        label="命中条件（When JSON）"
        value={step.when}
        placeholder={'{"kind":"video"} 或 {"all":[...]}'}
        disabled={disabled}
        parse={parseUnknownJson}
        onCommit={(when) => onCommit({ ...step, when })}
      />
      <div className="grid gap-1.5">
        <Label>备注</Label>
        <Input
          value={step.why ?? ''}
          disabled={disabled}
          placeholder="保留条件的目的说明"
          onChange={(event) => onCommit({ ...step, why: event.target.value })}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        命中则继续往后执行；不命中则整条规则对该文件跳过。
      </p>
    </div>
  )
}

function IfElseEditor({
  step,
  disabled,
  onCommit,
}: {
  step: Extract<RuleStepSummary, { kind: 'ifElse' }>
  disabled: boolean
  onCommit: (next: RuleStepSummary) => void
}) {
  return (
    <div className="space-y-2">
      <RuleSetJsonField
        label="分支条件（When JSON）"
        value={step.when}
        placeholder={'{"kind":"video"} 或 {"all":[...]}'}
        disabled={disabled}
        parse={parseUnknownJson}
        onCommit={(when) => onCommit({ ...step, when })}
      />
      <div className="grid gap-1.5">
        <Label>分支说明</Label>
        <Input
          value={step.why ?? ''}
          disabled={disabled}
          placeholder="分支说明（可选）"
          onChange={(event) => onCommit({ ...step, why: event.target.value })}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        满足时 / 否则 两个分支的子步骤直接在上方树里编辑与拖拽。
      </p>
    </div>
  )
}

function ForEachEditor({
  step,
  disabled,
  onCommit,
}: {
  step: Extract<RuleStepSummary, { kind: 'forEach' }>
  disabled: boolean
  onCommit: (next: RuleStepSummary) => void
}) {
  const id = useId()
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-as`}>当前元素变量名</Label>
          <Input
            id={`${id}-as`}
            value={step.as}
            disabled={disabled}
            placeholder="item"
            onChange={(event) => onCommit({ ...step, as: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>遍历来源</Label>
          <Select
            value={step.of.kind}
            disabled={disabled}
            onValueChange={(kind) =>
              onCommit({
                ...step,
                of:
                  kind === 'self'
                    ? { kind: 'self' }
                    : kind === 'children'
                      ? { kind: 'children' }
                      : { kind: 'scope', step: 'last', var: '' },
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">自身</SelectItem>
              <SelectItem value="children">子项（children）</SelectItem>
              <SelectItem value="scope">作用域变量</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>备注</Label>
        <Input
          value={step.why ?? ''}
          disabled={disabled}
          placeholder="遍历说明（可选）"
          onChange={(event) => onCommit({ ...step, why: event.target.value })}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        循环体的子步骤在上方树里编辑与拖拽；嵌套 FOR / IF 均支持。
      </p>
    </div>
  )
}

function TransformEditor({
  step,
  disabled,
  onCommit,
}: {
  step: Extract<RuleStepSummary, { kind: 'transform' }>
  disabled: boolean
  onCommit: (next: RuleStepSummary) => void
}) {
  const id = useId()
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-as`}>写入变量名</Label>
          <Input
            id={`${id}-as`}
            value={step.as}
            disabled={disabled}
            placeholder="cleanStem"
            onChange={(event) => onCommit({ ...step, as: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>来源</Label>
          <Select
            value={step.from?.kind ?? 'self'}
            disabled={disabled}
            onValueChange={(kind) =>
              onCommit({
                ...step,
                from:
                  kind === 'self'
                    ? { kind: 'self' }
                    : kind === 'children'
                      ? { kind: 'children' }
                      : { kind: 'scope', step: 'last', var: '' },
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">自身</SelectItem>
              <SelectItem value="children">子项（children）</SelectItem>
              <SelectItem value="scope">作用域变量</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-expr`}>表达式（模板语法）</Label>
        <Input
          id={`${id}-expr`}
          value={step.expr}
          disabled={disabled}
          placeholder={'{name.regex_replace("[.*?]", "")}'}
          onChange={(event) => onCommit({ ...step, expr: event.target.value })}
        />
      </div>
    </div>
  )
}

function ActionEditor({
  step,
  disabled,
  onCommit,
}: {
  step: Extract<RuleStepSummary, { kind: 'action' }>
  disabled: boolean
  onCommit: (next: RuleStepSummary) => void
}) {
  const id = useId()
  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-action`}>动作</Label>
        <Select
          value={step.action}
          disabled={disabled}
          onValueChange={(value) => onCommit({ ...step, action: value as RuleAction })}
        >
          <SelectTrigger id={`${id}-action`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rename_file">重命名文件</SelectItem>
            <SelectItem value="rename_dir">重命名目录</SelectItem>
            <SelectItem value="move">移动</SelectItem>
            <SelectItem value="flatten_dir">拍平目录</SelectItem>
            <SelectItem value="delete_to_quarantine">移入隔离区</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-template`}>模板（可引用上一步变量）</Label>
        <Input
          id={`${id}-template`}
          value={step.template ?? ''}
          disabled={disabled}
          placeholder={'{scope.last.cleanStem}{ext}'}
          onChange={(event) => onCommit({ ...step, template: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-reason`}>原因</Label>
        <Input
          id={`${id}-reason`}
          value={step.reason ?? ''}
          disabled={disabled}
          placeholder="可读的变化说明"
          onChange={(event) => onCommit({ ...step, reason: event.target.value })}
        />
      </div>
    </div>
  )
}

function AvailableVarsPanel({ vars }: { vars: Record<string, string[]> }) {
  const levels = Object.keys(vars)
  if (levels.length === 0) {
    return (
      <div className="rounded-md border bg-background p-2 text-[11px] text-muted-foreground">
        当前节点尚无可引用的变量；试着先添加 transform 写入变量。
      </div>
    )
  }
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        可引用变量
      </div>
      <ul className="space-y-1">
        {levels.map((level) => (
          <li key={level} className="text-xs">
            <span className="text-muted-foreground">{level}</span>
            <span className="ml-2 font-mono">{(vars[level] ?? []).join(', ')}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        在模板里写 <code className="rounded bg-muted px-1">{'{scope.last.<var>}'}</code> 即可引用；
        也可写 <code className="rounded bg-muted px-1">{'{scope.<stepId>.<var>}'}</code> 取指定步骤。
      </p>
    </div>
  )
}

// —— 路径与不可变树操作 ————————————————————————————

type PathSeg = number | 'then' | 'else' | 'body'

function pathEquals(a: PathSeg[] | null, b: PathSeg[] | null): boolean {
  if (!a || !b) return false
  return a.length === b.length && a.every((seg, i) => seg === b[i])
}

/** b 是否在 a 的子树里（a 拖动时不能落到自己的子孙容器）。 */
function isDescendantPath(a: PathSeg[] | null, b: PathSeg[] | null): boolean {
  if (!a || !b) return false
  if (b.length <= a.length) return false
  return a.every((seg, i) => seg === b[i])
}

function cloneSteps(steps: RuleStepSummary[]): RuleStepSummary[] {
  return steps.map((step) => {
    if (step.kind === 'ifElse') {
      return {
        ...step,
        then: cloneSteps(step.then ?? []),
        else: step.else ? cloneSteps(step.else) : undefined,
      }
    }
    if (step.kind === 'forEach') {
      return { ...step, steps: cloneSteps(step.steps ?? []) }
    }
    return { ...step }
  })
}

/** 取 containerPath 指向的步骤列表（[] = 顶层；[0,'body'] = 顶层第 0 个 FOR 的循环体）。 */
function listAt(root: RuleStepSummary[], containerPath: PathSeg[]): RuleStepSummary[] | null {
  let list = root
  let i = 0
  while (i < containerPath.length) {
    const seg = containerPath[i]!
    if (typeof seg !== 'number') return null
    const node = list[seg]
    if (!node) return null
    const branch = containerPath[i + 1]
    if (branch === 'then' || branch === 'else') {
      if (node.kind !== 'ifElse') return null
      list = branch === 'then' ? (node.then ?? []) : (node.else ?? [])
      i += 2
    } else if (branch === 'body') {
      if (node.kind !== 'forEach') return null
      list = node.steps ?? []
      i += 2
    } else {
      return null
    }
  }
  return list
}

/** 就地（已克隆的树）把 step 插入 containerPath 列表的 index 处。 */
function insertStep(
  root: RuleStepSummary[],
  containerPath: PathSeg[],
  index: number,
  step: RuleStepSummary,
): RuleStepSummary[] | null {
  const list = listAt(root, containerPath)
  if (!list) return null
  list.splice(Math.max(0, Math.min(index, list.length)), 0, step)
  return root
}

/** 从已克隆的树里删除 path 指向的节点，返回被删节点。 */
function removeStepAt(root: RuleStepSummary[], path: PathSeg[]): RuleStepSummary | null {
  if (path.length === 0) return null
  const container = path.slice(0, -1)
  const index = path[path.length - 1]
  if (typeof index !== 'number') return null
  const list = listAt(root, container)
  if (!list) return null
  const [removed] = list.splice(index, 1)
  return removed ?? null
}

function removeStep(root: RuleStepSummary[], path: PathSeg[]): RuleStepSummary[] | null {
  const container = path.slice(0, -1)
  const removed = removeStepAt(root, path)
  if (!removed) return null
  // 删空的 then/else/body 数组保持 [] 即可，无需回收容器
  void container
  return root
}

function replaceStep(root: RuleStepSummary[], path: PathSeg[], patch: RuleStepSummary): RuleStepSummary[] | null {
  const container = path.slice(0, -1)
  const index = path[path.length - 1]
  if (typeof index !== 'number') return null
  const list = listAt(root, container)
  if (!list) return null
  list[index] = patch
  return root
}

/** 把 from 节点移动到 parentPath 列表 index 处（拒绝拖进自己的子树）。 */
function moveStep(
  root: RuleStepSummary[],
  from: PathSeg[],
  parentPath: PathSeg[],
  index: number,
): RuleStepSummary[] | null {
  if (isDescendantPath(from, parentPath) || pathEquals(from, parentPath)) return null
  const working = cloneSteps(root)
  const fromContainer = from.slice(0, -1)
  const removed = removeStepAt(working, from)
  if (!removed) return null
  let insertIndex = index
  if (
    fromContainer.length === parentPath.length &&
    fromContainer.every((seg, i) => seg === parentPath[i])
  ) {
    const fromIndex = from[from.length - 1] as number
    if (fromIndex < index) insertIndex = index - 1
  }
  return insertStep(working, parentPath, insertIndex, removed)
}

function findStep(steps: RuleStepSummary[], id: string): RuleStepSummary | undefined {
  for (const step of steps) {
    if (step.id === id) return step
    if (step.kind === 'ifElse') {
      const hitThen = findStep(step.then ?? [], id)
      if (hitThen) return hitThen
      if (step.else) {
        const hitElse = findStep(step.else, id)
        if (hitElse) return hitElse
      }
    } else if (step.kind === 'forEach') {
      const hit = findStep(step.steps ?? [], id)
      if (hit) return hit
    }
  }
  return undefined
}

interface FlatStep {
  step: RuleStepSummary
  path: PathSeg[]
  depth: number
}

function flattenSteps(steps: RuleStepSummary[], containerPath: PathSeg[] = [], depth = 0): FlatStep[] {
  const result: FlatStep[] = []
  steps.forEach((step, index) => {
    const path = [...containerPath, index]
    result.push({ step, path, depth })
    if (step.kind === 'ifElse') {
      result.push(...flattenSteps(step.then ?? [], [...path, 'then'], depth + 1))
      if (step.else) {
        result.push(...flattenSteps(step.else, [...path, 'else'], depth + 1))
      }
    } else if (step.kind === 'forEach') {
      result.push(...flattenSteps(step.steps ?? [], [...path, 'body'], depth + 1))
    }
  })
  return result
}

/**
 * 当前节点能引用的变量（近似启发）：扁平序列里位于它之前的 transform.as
 * 与 forEach.as（迭代变量）。按"最近"倒序排列。
 */
function scopeAt(flatten: FlatStep[], index: number): Record<string, string[]> {
  const recent: string[] = []
  for (let i = index - 1; i >= 0; i -= 1) {
    const entry = flatten[i]
    if (!entry) continue
    if (entry.step.kind === 'transform') {
      if (!recent.includes(entry.step.as)) recent.push(entry.step.as)
    } else if (entry.step.kind === 'forEach') {
      if (!recent.includes(entry.step.as)) recent.push(entry.step.as)
    }
  }
  if (recent.length === 0) {
    return { 提示: ['无（当前是首节点或上层无变量）'] }
  }
  return { '上层（最近优先）': recent }
}

// —— 工具与常量 —— 实际实现在 ./rule-step-display.ts。
const SHAPE = STEP_SHAPE
const COLOR = STEP_COLOR
const LABEL = STEP_LABEL
const summarize = summarizeStep

function createStep(kind: RuleStepSummary['kind'], ruleId: string): RuleStepSummary {
  const id = `${ruleId}:${kind}-${Math.random().toString(36).slice(2, 7)}`
  switch (kind) {
    case 'filter':
      return { id, kind: 'filter', target: { kind: 'self' } }
    case 'ifElse':
      return { id, kind: 'ifElse', then: [], else: [] }
    case 'forEach':
      return { id, kind: 'forEach', of: { kind: 'children' }, as: 'item', steps: [] }
    case 'transform':
      return { id, kind: 'transform', from: { kind: 'self' }, as: 'value', expr: '{name}' }
    case 'action':
      return { id, kind: 'action', action: 'rename_file', target: { kind: 'self' }, template: '{name}{ext}' }
  }
}
