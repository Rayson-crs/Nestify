import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function BatchTrimPanel({
  disabled,
  customTrimCount,
  batchTrimStart,
  batchTrimEnd,
  onBatchTrimStart,
  onBatchTrimEnd,
  onApplyBatch,
}: {
  disabled: boolean
  customTrimCount: number
  batchTrimStart: number
  batchTrimEnd: number | null
  onBatchTrimStart: (value: number) => void
  onBatchTrimEnd: (value: number | null) => void
  onApplyBatch: (mode: 'non-custom' | 'all') => void
}) {
  return (
    <div className="mt-4 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">批量裁剪</span>
        <Badge variant="outline">自定义 {customTrimCount}</Badge>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">去头部秒数</Label>
          <Input
            type="number"
            min={0}
            step={0.1}
            value={batchTrimStart}
            disabled={disabled}
            onChange={(event) => onBatchTrimStart(Math.max(0, Number(event.target.value)))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">结尾去掉秒数（空为不去尾）</Label>
          <Input
            type="number"
            min={0}
            step={0.1}
            value={batchTrimEnd ?? ''}
            disabled={disabled}
            onChange={(event) =>
              onBatchTrimEnd(event.target.value.trim() === '' ? null : Number(event.target.value))}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onApplyBatch('non-custom')}>
          应用到未自定义
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onApplyBatch('all')}>
          覆盖全部
        </Button>
      </div>
    </div>
  )
}
