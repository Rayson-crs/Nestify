import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PreviewPagination({
  offset,
  pageSize,
  total,
  hasMore,
  busy,
  onPage,
}: {
  offset: number
  pageSize: number
  total: number
  hasMore: boolean
  busy?: boolean
  onPage: (delta: -1 | 1) => void
}) {
  const start = total === 0 ? 0 : offset + 1
  const end = total === 0 ? 0 : Math.min(total, offset + pageSize)
  return (
    <div className="flex items-center justify-end gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="加载中" /> : null}
      <span className="tabular-nums">{start}-{end} / {total}</span>
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="上一页" disabled={busy || offset === 0} onClick={() => onPage(-1)}>
        <ArrowLeft className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="下一页" disabled={busy || !hasMore} onClick={() => onPage(1)}>
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
