import { ExternalLink, Loader2, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FilePreview, SearchHit } from '@/lib/ipc'
import { kindLabel, parentName } from '@/lib/labels'
import { formatBytes, formatTime } from '@/lib/utils'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="break-all text-foreground">{value}</div>
    </div>
  )
}

export function Inspector({
  hit,
  preview,
  open,
  busyOpen,
  actionsBusy,
  onOpenChange,
  onOpen,
}: {
  hit: SearchHit | null
  preview: FilePreview | null
  open: boolean
  busyOpen: boolean
  actionsBusy: boolean
  onOpenChange: (open: boolean) => void
  onOpen: () => void
}) {
  if (!open) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l bg-background py-2">
        <Button variant="ghost" size="icon" title="展开预览" onClick={() => onOpenChange(true)}>
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </aside>
    )
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-background">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">预览</div>
        <Button variant="ghost" size="icon" title="收起预览" onClick={() => onOpenChange(false)}>
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="mx-4 mb-4 flex h-44 items-center justify-center overflow-hidden rounded-md border bg-muted">
        {preview?.kind === 'image' && preview.dataUrl ? (
          <img src={preview.dataUrl} alt={hit?.name} className="h-full w-full object-contain" />
        ) : preview?.kind === 'video' && preview.src ? (
          <video src={preview.src} className="h-full w-full object-contain" controls muted />
        ) : (
          <div className="px-4 text-center text-xs text-muted-foreground">
            {preview?.kind === 'too-large' ? '图片过大，未内嵌预览' : hit ? '该类型暂无内嵌预览' : '选择一条结果'}
          </div>
        )}
      </div>
      <div className="space-y-4 px-4 text-sm">
        <Field label="名称" value={hit?.name ?? '-'} />
        <Field label="类型" value={hit ? kindLabel(hit.kind) : '-'} />
        <Field label="大小" value={hit && hit.kind !== 'dir' ? formatBytes(hit.size) : '-'} />
        <Field label="修改" value={formatTime(hit?.mtime)} />
        <Field label="父目录" value={parentName(hit?.parent)} />
        <Field label="路径" value={hit?.path ?? '-'} />
      </div>
      <div className="mt-auto flex gap-2 p-4">
        <Button className="w-full" disabled={!hit || actionsBusy} onClick={onOpen}>
          {busyOpen ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          打开
        </Button>
      </div>
    </aside>
  )
}
