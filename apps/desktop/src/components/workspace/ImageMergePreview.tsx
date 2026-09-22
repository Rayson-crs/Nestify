import { useEffect, useState } from 'react'
import { Images, Loader2 } from 'lucide-react'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { callNestify } from '@/lib/ipc'
import { baseName } from './merge-pane-shared'

export function ImageMergePreview({ merge }: { merge: MediaMergeController }) {
  const [images, setImages] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const paths = merge.items.map((item) => item.path).join('\n')
  const settings = merge.imageSettings

  useEffect(() => {
    let cancelled = false
    const selectedPaths = paths.split('\n').filter(Boolean)
    setLoading(true)
    setFailed(false)
    void Promise.all(selectedPaths.map(async (path) => {
      const preview = await callNestify((api) =>
        api.mediaMergePreview
          ? api.mediaMergePreview({ path, selectedPaths })
          : Promise.resolve({ kind: 'none' as const }),
      )
      return [path, preview] as const
    }))
      .then((entries) => {
        if (cancelled) return
        const next: Record<string, string> = {}
        for (const [path, preview] of entries) {
          if (preview.kind === 'image' && preview.dataUrl) next[path] = preview.dataUrl
        }
        setImages(next)
        setFailed(Object.keys(next).length !== selectedPaths.length)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [paths])

  const layout = settings.layout ?? 'vertical'
  const gap = Math.max(0, settings.gap)
  const columns = Math.max(1, Math.min(settings.columns ?? 2, merge.items.length || 1))
  const previewStyle = layout === 'horizontal'
    ? { display: 'flex', gap, alignItems: 'stretch', height: 180 }
    : layout === 'grid'
      ? { display: 'grid', gap, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
      : { display: 'flex', flexDirection: 'column' as const, gap }

  return (
    <section className="rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
        <span>合成预览</span>
        <span className="text-xs text-muted-foreground">{settings.format.toUpperCase()} · {layoutLabel(layout)} · {settings.background === 'white' ? '白底' : '透明底'}</span>
      </div>
      <div className="relative min-h-56 overflow-auto bg-[linear-gradient(45deg,#ececec_25%,transparent_25%),linear-gradient(-45deg,#ececec_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ececec_75%),linear-gradient(-45deg,transparent_75%,#ececec_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] p-3">
        {loading ? <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : null}
        <div className="mx-auto w-fit max-w-full p-2" style={{ background: settings.background === 'white' ? '#ffffff' : 'transparent' }}>
          <div style={previewStyle}>
            {merge.items.map((item) => (
              images[item.path] ? (
                <img key={item.id} src={images[item.path]} alt={baseName(item.path)} className="max-w-full object-contain" style={imageStyle(layout)} />
              ) : (
                <div key={item.id} className="flex h-20 min-w-20 items-center justify-center bg-muted text-muted-foreground"><Images className="h-4 w-4" /></div>
              )
            ))}
          </div>
        </div>
      </div>
      {failed ? <div className="border-t px-3 py-2 text-xs text-muted-foreground">部分原图无法读取，预览仅显示可用图片。</div> : null}
    </section>
  )
}

function imageStyle(layout: 'vertical' | 'horizontal' | 'grid'): { width?: string; height?: string } {
  if (layout === 'horizontal') return { height: '100%', width: 'auto' }
  if (layout === 'grid') return { width: '100%', height: 'auto' }
  return { width: 220, height: 'auto' }
}

function layoutLabel(layout: 'vertical' | 'horizontal' | 'grid'): string {
  if (layout === 'horizontal') return '横向'
  if (layout === 'grid') return '网格'
  return '纵向'
}
