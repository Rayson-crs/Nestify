import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ChangePlan, PlanOp } from '@/lib/ipc'
import { opLabel } from '@/lib/labels'

export function PlanTable({
  plan,
  selectedOps,
  disabled,
  onToggleOp,
}: {
  plan: ChangePlan | null
  selectedOps: Record<number, boolean>
  disabled?: boolean
  onToggleOp: (index: number, checked: boolean) => void
}) {
  const pageSize = 200
  const [offset, setOffset] = useState(0)
  useEffect(() => setOffset(0), [plan])
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
          {plan.ops.slice(offset, offset + pageSize).map((op, pageIndex) => {
            const index = offset + pageIndex
            return (
            <PlanRow
              key={`${op.from}-${index}`}
              op={op}
              checked={Boolean(selectedOps[index])}
              disabled={disabled}
              onCheckedChange={(checked) => onToggleOp(index, checked)}
            />
            )
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">{plan.ops.length ? offset + 1 : 0}-{Math.min(plan.ops.length, offset + pageSize)} / {plan.ops.length}</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="上一页" disabled={offset === 0 || disabled} onClick={() => setOffset((current) => Math.max(0, current - pageSize))}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="下一页" disabled={offset + pageSize >= plan.ops.length || disabled} onClick={() => setOffset((current) => current + pageSize)}>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
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

