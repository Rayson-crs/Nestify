import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { PlanOpView } from '@/app/plan-state'
import type { ChangePlan, PlanOp } from '@/lib/ipc'
import { opLabel } from '@/lib/labels'
import { PreviewPagination } from './PreviewPagination'

export function PlanTable({
  plan,
  selectedOps,
  disabled,
  onToggleOp,
  pageRows,
  pageOffset = 0,
  pageSize = 200,
  total,
  hasMore = false,
  busy = false,
  onPage,
}: {
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  disabled?: boolean
  onToggleOp: (index: number, checked: boolean) => void
  pageRows?: PlanOpView[]
  pageOffset?: number
  pageSize?: number
  total?: number
  hasMore?: boolean
  busy?: boolean
  onPage?: (delta: -1 | 1) => void
}) {
  const [offset, setOffset] = useState(0)
  useEffect(() => setOffset(0), [plan])
  const controlled = pageRows !== undefined
  const effectiveOffset = controlled ? pageOffset : offset
  const effectiveTotal = controlled ? total ?? pageRows.length : plan?.ops.length ?? 0
  const effectiveHasMore = controlled
    ? hasMore || effectiveTotal < 0
    : effectiveOffset + pageSize < effectiveTotal
  const rows = controlled
    ? pageRows
    : plan?.ops.slice(effectiveOffset, effectiveOffset + pageSize).map((op, index) => ({
        op,
        index: effectiveOffset + index,
      })) ?? []
  if (!plan) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">先做 Dry-run，不会写盘</div>
  }
  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-wrap gap-2 px-3 py-2 text-sm text-muted-foreground">
        <Badge>改名 {plan.summary.rename}</Badge>
        <Badge>移动 {plan.summary.move}</Badge>
        <Badge>拍平 {plan.summary.flatten}</Badge>
        <Badge>隔离 {plan.summary.quarantine}</Badge>
        <Badge variant={plan.summary.conflicts ? 'secondary' : 'default'}>冲突 {plan.summary.conflicts}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead className="w-16">操作</TableHead>
            <TableHead>原路径</TableHead>
            <TableHead>新路径</TableHead>
            <TableHead className="w-24">风险</TableHead>
            <TableHead>原因</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ op, index }) => (
            <PlanRow
              key={`${op.from}-${index}`}
              op={op}
              checked={Boolean(selectedOps[index])}
              disabled={disabled}
              onCheckedChange={(checked) => onToggleOp(index, checked)}
            />
          ))}
        </TableBody>
      </Table>
      <PreviewPagination
        offset={effectiveOffset}
        pageSize={pageSize}
        total={effectiveTotal}
        hasMore={effectiveHasMore}
        busy={busy || disabled}
        onPage={(delta) => {
          if (controlled) {
            onPage?.(delta)
            return
          }
          setOffset((current) => Math.max(0, current + delta * pageSize))
        }}
      />
    </ScrollArea>
  )
}

function PlanRow({
  op,
  checked,
  disabled,
  onCheckedChange,
}: {
  op: PlanOp
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <TableRow>
      <TableCell>
        <Checkbox
          checked={checked}
          disabled={disabled || op.risk === 'overwrite'}
          title="覆盖操作需要显式确认，当前版本暂不可执行"
          onCheckedChange={onCheckedChange}
        />
      </TableCell>
      <TableCell>{opLabel(op.op)}</TableCell>
      <TableCell className="max-w-[18rem] truncate" title={op.from}>
        {op.from}
      </TableCell>
      <TableCell className="max-w-[18rem] truncate" title={op.to ?? ''}>
        {op.to ?? '-'}
      </TableCell>
      <TableCell>
        <Badge variant={op.risk === 'none' ? 'default' : op.risk === 'overwrite' ? 'destructive' : 'secondary'}>{op.risk}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{op.reason}</TableCell>
    </TableRow>
  )
}

