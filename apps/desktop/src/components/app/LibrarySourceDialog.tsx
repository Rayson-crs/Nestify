import { useState } from 'react'
import { FolderOpen, HardDrive, Loader2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'

export function LibrarySourceDialog({
  open,
  busy,
  onOpenChange,
  onCustomDirectory,
  onEntireComputer,
}: {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onCustomDirectory: () => void
  onEntireComputer: (splitByDrive: boolean) => void
}) {
  const [splitByDrive, setSplitByDrive] = useState(true)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl">
        <DialogHeader>
          <DialogTitle>添加资料库</DialogTitle>
          <DialogDescription>选择需要建立索引的范围。之后仍可以在左侧资料库中重新扫描。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-24 w-full min-w-0 items-start justify-start gap-3 p-4 text-left"
            disabled={busy}
            onClick={onCustomDirectory}
          >
            <FolderOpen className="h-5 w-5 shrink-0" />
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="font-medium leading-5">自定义目录</span>
              <span className="whitespace-normal break-words text-xs font-normal leading-5 text-muted-foreground">选择一个或多个需要管理的文件夹</span>
            </span>
          </Button>
          <div className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-24 w-full min-w-0 items-start justify-start gap-3 p-4 text-left"
              disabled={busy}
              onClick={() => onEntireComputer(splitByDrive)}
            >
              {busy ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <HardDrive className="h-5 w-5 shrink-0" />}
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="font-medium leading-5">读取整台电脑</span>
                <span className="whitespace-normal break-words text-xs font-normal leading-5 text-muted-foreground">
                  {splitByDrive ? '扫描全部磁盘，每个磁盘单独建立一个资料库' : '扫描全部磁盘，合并为一个资料库'}
                </span>
              </span>
            </Button>
            <div className="flex items-center justify-end gap-2">
              <Checkbox
                id="split-by-drive"
                checked={splitByDrive}
                disabled={busy}
                onCheckedChange={(checked) => setSplitByDrive(checked === true)}
              />
              <Label htmlFor="split-by-drive" className="cursor-pointer text-xs text-muted-foreground">
                按磁盘分别建立资料库
              </Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
