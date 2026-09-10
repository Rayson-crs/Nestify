import { Loader2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { KindIcon } from '@/components/files/kind'
import type { SearchHit } from '@/lib/ipc'
import { kindLabel } from '@/lib/labels'

export function SpotlightSearch({
  open,
  query,
  hits,
  busy,
  activeIndex,
  enabled,
  onOpenChange,
  onQuery,
  onActiveIndex,
  onOpen,
}: {
  open: boolean
  query: string
  hits: SearchHit[]
  busy: boolean
  activeIndex: number
  enabled: boolean
  onOpenChange: (open: boolean) => void
  onQuery: (value: string) => void
  onActiveIndex: (index: number) => void
  onOpen: (hit: SearchHit) => void
}) {
  const activeHit = hits[activeIndex] ?? null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true)
          return
        }
        if (typeof window !== 'undefined') {
          const keyboard = window.event
          if (keyboard instanceof KeyboardEvent && keyboard.ctrlKey) return
        }
        onOpenChange(false)
      }}
    >
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (event.ctrlKey) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="top-[18%] max-w-xl translate-y-[-18vh] gap-0 overflow-hidden p-0 sm:rounded-lg"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>快速搜索</DialogTitle>
          <DialogDescription>搜索并打开已索引文件</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            autoFocus
            disabled={!enabled}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.ctrlKey && (event.key === 'Escape' || event.code === 'Escape' || event.code === 'Space' || event.key === ' ')) {
                event.preventDefault()
                event.stopPropagation()
                return
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (hits.length === 0) return
                const delta = event.key === 'ArrowDown' ? 1 : -1
                onActiveIndex((activeIndex + delta + hits.length) % hits.length)
                return
              }
              if (event.key === 'Home') {
                event.preventDefault()
                onActiveIndex(0)
                return
              }
              if (event.key === 'End') {
                event.preventDefault()
                onActiveIndex(hits.length - 1)
                return
              }
              if (event.key === 'Enter' && activeHit) {
                event.preventDefault()
                onOpen(activeHit)
              }
            }}
            placeholder="搜索文件"
            className="h-12 border-0 px-0 shadow-none focus-visible:ring-0"
          />
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <ScrollArea horizontal={false} className="max-h-80 min-h-0 pb-1">
          {!enabled ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">添加资料库后搜索</div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query.trim() ? '没有匹配结果' : '输入关键词'}
            </div>
          ) : (
            <div className="p-1 pb-2">
              {hits.map((hit, index) => (
                <Button
                  key={hit.entryId}
                  variant={index === activeIndex ? 'secondary' : 'ghost'}
                  aria-selected={index === activeIndex}
                  className="flex h-auto w-full items-center justify-start gap-2 px-2 py-2 text-left"
                  onMouseEnter={() => onActiveIndex(index)}
                  onClick={() => onOpen(hit)}
                >
                  <span title={kindLabel(hit.kind)}>
                    <KindIcon kind={hit.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={hit.name}>
                      {hit.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground" title={hit.path}>
                      {hit.path}
                    </span>
                  </span>
                  <Badge variant="outline">{kindLabel(hit.kind)}</Badge>
                </Button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
