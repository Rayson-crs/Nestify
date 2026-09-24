import { useEffect, useState } from 'react'
import { Images, Loader2 } from 'lucide-react'
import type { MediaMergeController } from '@/app/useMediaMerge'
import { callNestify } from '@/lib/ipc'
import type { MediaMergeImageSettings } from '@/lib/ipc'
import { baseName, mediaFileUrl } from './merge-pane-shared'

const MAX_FALLBACK_BYTES = 8 * 1024 * 1024
const PREVIEW_EDGE = 480

type PreviewResult = {
  src?: string
  width?: number
  height?: number
  error?: string | null
}

type Cell = {
  id: string
  path: string
  left: number
  top: number
  width: number
  height: number
  src?: string
}

export function ImageMergePreview({ merge }: { merge: MediaMergeController }) {
  const [composite, setComposite] = useState<PreviewResult | null>(null)
  const [cells, setCells] = useState<Cell[]>([])
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const itemsKey = merge.items.map((item) => [
    item.id,
    item.path,
    item.size,
    item.rotation ?? 'none',
    item.frameFit ?? 'contain',
    item.frameScalePercent ?? 100,
    item.frameFocusX ?? 50,
    item.frameFocusY ?? 50,
    item.imageDurationSeconds ?? '',
    item.imageClipSource ?? '',
  ].join('\t')).join('\n')
  const settings = merge.imageSettings
  const settingsKey = [
    settings.layout ?? 'vertical',
    settings.width,
    settings.height ?? '',
    settings.columns ?? '',
    settings.gap,
    settings.background,
    settings.format,
    settings.gifWidth ?? '',
    settings.gifHeight ?? '',
    settings.gifFrameDurationSeconds ?? '',
    settings.gifLoopCount ?? '',
  ].join(':')

  useEffect(() => {
    let cancelled = false
    const items = merge.items
    setLoading(true)
    setNote(null)
    void callNestify(async (api) => {
      const preview = (api as NestifyPreviewApi).mediaMergeImagePreview
      if (!preview) return null
      return preview({ items, settings })
    })
      .then((result) => {
        if (cancelled) return
        if (result) {
          setComposite(result)
          setCells([])
          setNote(result.error?.trim() ? result.error : null)
          return
        }
        setComposite(null)
        return drawFallback(items, settings).then((drawn) => {
          if (cancelled) return
          setCells(drawn.cells)
          setNote(drawn.note)
        })
      })
      .catch(() => {
        if (cancelled) return
        setComposite(null)
        setCells([])
        setNote('合成预览失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [itemsKey, settings, settingsKey])

  const layout = settings.layout ?? 'vertical'
  const canvasWidth = composite?.width && composite.width > 0
    ? composite.width
    : cells.reduce((max, cell) => Math.max(max, cell.left + cell.width), 0)
  const canvasHeight = composite?.height && composite.height > 0
    ? composite.height
    : cells.reduce((max, cell) => Math.max(max, cell.top + cell.height), 0)

  return (
    <section className="rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
        <span>合成预览</span>
        <span className="text-xs text-muted-foreground">
          {settings.format.toUpperCase()} · {settings.format === 'gif' ? '图片轮播' : layoutLabel(layout)} · {settings.background === 'white' ? '白底' : '透明底'}
        </span>
      </div>
      <div className="relative min-h-56 overflow-auto bg-[linear-gradient(45deg,#ececec_25%,transparent_25%),linear-gradient(-45deg,#ececec_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ececec_75%),linear-gradient(-45deg,transparent_75%,#ececec_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] p-3">
        {loading ? <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : null}
        {note ? (
          <div className="flex min-h-48 items-center justify-center px-4 text-center text-sm text-destructive">{note}</div>
        ) : composite?.src ? (
          <img
            src={composite.src}
            alt="合成预览"
            className="mx-auto block max-h-[480px] max-w-full object-contain"
            width={canvasWidth || undefined}
            height={canvasHeight || undefined}
          />
        ) : (
          <div
            className="relative mx-auto"
            style={{
              width: canvasWidth || undefined,
              height: canvasHeight || undefined,
              maxWidth: '100%',
              background: settings.background === 'white' ? '#ffffff' : 'transparent',
            }}
          >
            {cells.map((cell) => (
              cell.src ? (
                <img
                  key={cell.id}
                  src={cell.src}
                  alt={baseName(cell.path)}
                  className="absolute object-fill"
                  style={{ left: cell.left, top: cell.top, width: cell.width, height: cell.height }}
                />
              ) : (
                <div
                  key={cell.id}
                  className="absolute flex items-center justify-center bg-muted text-muted-foreground"
                  style={{ left: cell.left, top: cell.top, width: cell.width, height: cell.height }}
                >
                  <Images className="h-4 w-4" />
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

type NestifyPreviewApi = {
  mediaMergeImagePreview?: (input: { items: MediaMergeController['items']; settings: MediaMergeImageSettings }) => Promise<PreviewResult>
}

async function drawFallback(
  items: Array<{ id: string; path: string; size: number }>,
  settings: MediaMergeImageSettings,
): Promise<{ cells: Cell[]; note: string | null }> {
  const ratios = await Promise.all(items.map(async (item) => ({
    item,
    ratio: item.size > MAX_FALLBACK_BYTES ? 1 : await readAspect(item.path),
    src: item.size > MAX_FALLBACK_BYTES ? undefined : mediaSrc(item.path),
  })))
  const layout = layoutCells(ratios.map((entry) => entry.ratio), settings)
  return {
    note: layout.note,
    cells: layout.placements.map((placement, index) => ({
      id: ratios[index]?.item.id ?? String(index),
      path: ratios[index]?.item.path ?? '',
      src: ratios[index]?.src,
      ...placement,
    })),
  }
}

function layoutCells(ratios: number[], settings: MediaMergeImageSettings): {
  placements: Array<{ left: number; top: number; width: number; height: number }>
  note: string | null
} {
  const layout = settings.layout ?? 'vertical'
  const gap = clamp(Math.round(settings.gap), 0, 128)
  const count = Math.max(ratios.length, 1)
  const shared = layout === 'horizontal'
    ? clamp(Math.round(settings.height ?? 1080), 16, 8192)
    : clamp(Math.round(settings.width), 16, 8192)
  const columns = layout === 'grid'
    ? Math.min(count, clamp(Math.round(settings.columns ?? 2), 1, 8))
    : 1
  const raw = rawPlacements(ratios.length ? ratios : [1], layout, shared, gap, columns)
  const longest = Math.max(
    ...raw.map((cell) => cell.left + cell.width),
    ...raw.map((cell) => cell.top + cell.height),
    1,
  )
  const scale = Math.min(1, PREVIEW_EDGE / longest)
  const placements = raw.map((cell) => ({
    left: Math.round(cell.left * scale),
    top: Math.round(cell.top * scale),
    width: Math.max(1, Math.round(cell.width * scale)),
    height: Math.max(1, Math.round(cell.height * scale)),
  }))
  const width = raw.reduce((max, cell) => Math.max(max, cell.left + cell.width), 0)
  const height = raw.reduce((max, cell) => Math.max(max, cell.top + cell.height), 0)
  return { placements, note: limitNote(width, height) }
}

function rawPlacements(
  ratios: number[],
  layout: 'vertical' | 'horizontal' | 'grid',
  shared: number,
  gap: number,
  columns: number,
): Array<{ left: number; top: number; width: number; height: number }> {
  if (layout === 'horizontal') {
    return ratios.map((ratio, index) => {
      const width = Math.max(1, Math.round(ratio * shared))
      const left = ratios.slice(0, index).reduce((total, value) => total + Math.max(1, Math.round(value * shared)) + gap, 0)
      return { left, top: 0, width, height: shared }
    })
  }
  if (layout === 'grid') {
    const cellWidth = Math.max(1, Math.floor((shared - gap * (columns - 1)) / columns))
    const cells: Array<{ left: number; top: number; width: number; height: number }> = []
    let top = 0
    for (let offset = 0; offset < ratios.length; offset += columns) {
      const row = ratios.slice(offset, offset + columns)
      const heights = row.map((ratio) => Math.max(1, Math.round(cellWidth / Math.max(ratio, 0.01))))
      const rowHeight = Math.max(...heights)
      heights.forEach((height, column) => {
        cells.push({
          left: column * (cellWidth + gap),
          top: top + Math.round((rowHeight - height) / 2),
          width: cellWidth,
          height,
        })
      })
      top += rowHeight + gap
    }
    return cells
  }
  return ratios.map((ratio, index) => {
    const height = Math.max(1, Math.round(shared / Math.max(ratio, 0.01)))
    const top = ratios.slice(0, index).reduce((total, value) => total + Math.max(1, Math.round(shared / Math.max(value, 0.01))) + gap, 0)
    return { left: 0, top, width: shared, height }
  })
}

function limitNote(width: number, height: number): string | null {
  if (width > 32767 || height > 32767) {
    return `输出图片尺寸 ${Math.round(width)}x${Math.round(height)} 超过单边 32767px 限制，请降低尺寸或分批合并`
  }
  if (width * height > 100_000_000) {
    return `输出图片共 ${Math.round(width * height)} 像素，超过 1 亿像素安全限制，请降低尺寸或分批合并`
  }
  return null
}

function readAspect(path: string): Promise<number> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1)
    image.onerror = () => resolve(1)
    image.src = mediaSrc(path)
  })
}

function mediaSrc(path: string): string {
  return mediaFileUrl(path)
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

function layoutLabel(layout: 'vertical' | 'horizontal' | 'grid'): string {
  if (layout === 'horizontal') return '横向'
  if (layout === 'grid') return '网格'
  return '纵向'
}
