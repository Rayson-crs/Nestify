import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2 } from 'lucide-react'
import { MagicParameterInput } from '@/components/rules/MagicParameterInput'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MediaMergeOrderCriterion, MediaMergeOrderProfile } from '@/lib/ipc'

const FIELD_OPTIONS: Array<{ value: MediaMergeOrderCriterion['field']; label: string }> = [
  { value: 'name', label: '文件名' },
  { value: 'number', label: '名称中的数字' },
  { value: 'extension', label: '扩展名' },
  { value: 'path', label: '完整路径' },
  { value: 'mtime', label: '修改时间' },
  { value: 'size', label: '文件大小' },
]

export function MergeOrderDialog({
  profile,
  disabled,
  onChange,
  onMove,
}: {
  profile: MediaMergeOrderProfile
  disabled: boolean
  onChange: (criteria: MediaMergeOrderCriterion[]) => void
  onMove: (from: number, to: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [dialogContent, setDialogContent] = useState<HTMLDivElement | null>(null)

  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        <Settings2 className="h-4 w-4" />
        排序设置
        <span className="text-xs text-muted-foreground">{profile.criteria.length} 组</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent ref={setDialogContent} className="w-[calc(100vw-2rem)] max-w-3xl min-w-0 overflow-visible">
          <DialogHeader>
            <DialogTitle>排序设置</DialogTitle>
            <DialogDescription>规则组从上到下依次比较。命中条件的文件按该组排序，未命中的文件排在后面。没有规则组时保持当前顺序，拖动文件只调整个别项。</DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(28rem,55vh)] min-h-0 space-y-3 overflow-y-auto pr-1">
            {profile.criteria.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                还没有规则组
              </div>
            ) : null}
            {profile.criteria.map((criterion, index) => (
              <OrderGroup
                key={criterion.id}
                index={index}
                count={profile.criteria.length}
                criterion={criterion}
                disabled={disabled}
                portalContainer={dialogContent}
                onChange={(patch) => onChange(profile.criteria.map((item, position) =>
                  position === index ? { ...item, ...patch } : item,
                ))}
                onMove={onMove}
                onRemove={() => onChange(profile.criteria.filter((_, position) => position !== index))}
              />
            ))}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => onChange([...profile.criteria, newCriterion(profile.criteria.length)])}
            >
              <Plus className="h-4 w-4" />
              添加规则组
            </Button>
            <Button onClick={() => setOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function OrderGroup({
  index,
  count,
  criterion,
  disabled,
  portalContainer,
  onChange,
  onMove,
  onRemove,
}: {
  index: number
  count: number
  criterion: MediaMergeOrderCriterion
  disabled: boolean
  portalContainer: HTMLElement | null
  onChange: (patch: Partial<MediaMergeOrderCriterion>) => void
  onMove: (from: number, to: number) => void
  onRemove: () => void
}) {
  const numeric = criterion.field === 'mtime' || criterion.field === 'size' || criterion.field === 'number'

  return (
    <section className="rounded-md border p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-medium">规则组 {index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" title="上移" disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" title="下移" disabled={disabled || index === count - 1} onClick={() => onMove(index, index + 1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" title="删除规则组" disabled={disabled} onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>匹配条件</Label>
          <MagicParameterInput
            context="scope-filter"
            value={criterion.pattern}
            disabled={disabled}
            portalContainer={portalContainer}
            placeholder="留空匹配全部，例：ext:jpg AND name:图片"
            onChange={(value) => onChange({ pattern: value })}
          />
          <p className="text-xs text-muted-foreground">留空匹配全部文件。助手条件只决定这一组排序哪些文件。</p>
        </div>
        <div className="space-y-1">
          <Label>排序方式</Label>
          <div className="grid grid-cols-3 gap-2">
            <Select value={criterion.field} disabled={disabled} onValueChange={(value) => onChange({ field: value as MediaMergeOrderCriterion['field'] })}>
              <SelectTrigger aria-label={`规则组 ${index + 1} 排序字段`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={criterion.direction} disabled={disabled} onValueChange={(value) => onChange({ direction: value as MediaMergeOrderCriterion['direction'] })}>
              <SelectTrigger aria-label={`规则组 ${index + 1} 排序方向`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">升序</SelectItem>
                <SelectItem value="desc">降序</SelectItem>
              </SelectContent>
            </Select>
            <Select value={criterion.textMode} disabled={disabled || numeric} onValueChange={(value) => onChange({ textMode: value as MediaMergeOrderCriterion['textMode'] })}>
              <SelectTrigger aria-label={`规则组 ${index + 1} 文本比较`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="natural">自然序</SelectItem>
                <SelectItem value="literal">字面序</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </section>
  )
}

function newCriterion(index: number): MediaMergeOrderCriterion {
  return {
    id: `order-${Date.now()}-${index}`,
    field: 'name',
    direction: 'asc',
    textMode: 'natural',
    pattern: '',
  }
}
