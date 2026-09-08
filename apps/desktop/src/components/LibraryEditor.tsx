import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { LibraryHashStrategy, LibraryMediaStrategy, LibraryPreviewStrategy } from '@/lib/ipc'
import {
  HASH_STRATEGY_OPTIONS,
  MEDIA_STRATEGY_OPTIONS,
  PREVIEW_STRATEGY_OPTIONS,
  type LibraryDraft,
} from '@/lib/workspace'

export function LibraryEditor({
  open,
  draft,
  busy,
  onOpenChange,
  onDraft,
  onSave,
}: {
  open: boolean
  draft: LibraryDraft
  busy: boolean
  onOpenChange: (open: boolean) => void
  onDraft: (draft: LibraryDraft) => void
  onSave: () => void
}) {
  const setDraft = <K extends keyof LibraryDraft>(key: K, value: LibraryDraft[K]) =>
    onDraft({ ...draft, [key]: value })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>编辑资料库</DialogTitle>
          <DialogDescription>调整索引、哈希与预览策略</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>名称</Label>
            <Input value={draft.name} onChange={(event) => setDraft('name', event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>根目录（每行一个）</Label>
            <Textarea value={draft.roots} onChange={(event) => setDraft('roots', event.target.value)} spellCheck={false} />
          </div>
          <div className="grid gap-2">
            <Label>排除规则（每行一个 glob）</Label>
            <Textarea
              value={draft.excludeGlobs}
              onChange={(event) => setDraft('excludeGlobs', event.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>最大深度</Label>
              <Input
                value={draft.maxDepth}
                min={0}
                inputMode="numeric"
                placeholder="不限制"
                onChange={(event) => setDraft('maxDepth', event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>哈希策略</Label>
              <Select
                value={draft.hashStrategy}
                onValueChange={(value) => setDraft('hashStrategy', value as LibraryHashStrategy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HASH_STRATEGY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>媒体策略</Label>
              <Select
                value={draft.mediaStrategy}
                onValueChange={(value) => setDraft('mediaStrategy', value as LibraryMediaStrategy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEDIA_STRATEGY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>预览策略</Label>
              <Select
                value={draft.previewStrategy}
                onValueChange={(value) => setDraft('previewStrategy', value as LibraryPreviewStrategy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREVIEW_STRATEGY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={draft.followSymlinks}
                onCheckedChange={(checked) => setDraft('followSymlinks', checked === true)}
              />
              符号链接
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={draft.scanHidden}
                onCheckedChange={(checked) => setDraft('scanHidden', checked === true)}
              />
              隐藏文件
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy} onClick={onSave}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
