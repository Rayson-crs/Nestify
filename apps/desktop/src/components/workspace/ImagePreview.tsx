import { useEffect, useState } from 'react'
import { Images, Loader2 } from 'lucide-react'
import type { FilePreview, MediaMergeItem } from '@/lib/ipc'
import { callNestify } from '@/lib/ipc'
import { formatBytes } from '@/lib/utils'
import { baseName, selectedPathsKey, splitSelectedPaths } from './merge-pane-shared'

export function ImagePreview({
  item,
  items,
  ipcReady,
}: {
  item: MediaMergeItem
  items: MediaMergeItem[]
  ipcReady: boolean
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const pathsKey = selectedPathsKey(items)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setLoading(true)
    const selectedPaths = splitSelectedPaths(pathsKey)
    void callNestify((api) =>
      api.mediaMergePreview
        ? api.mediaMergePreview({ path: item.path, selectedPaths })
        : Promise.resolve({ kind: 'none' as const }),
    )
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch(() => {
        if (!cancelled) setPreview({ kind: 'none' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ipcReady, item.path, pathsKey])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <div className="truncate text-sm font-medium" title={item.path}>{baseName(item.path)}</div>
        <div className="truncate text-xs text-muted-foreground" title={item.path}>{formatBytes(item.size)}</div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : preview?.kind === 'image' ? (
          <img src={preview.dataUrl} alt={baseName(item.path)} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <Images className="h-8 w-8" />
            {preview?.kind === 'too-large' ? '图片超过 8MB，无法预览' : '预览不可用'}
          </div>
        )}
      </div>
    </div>
  )
}
