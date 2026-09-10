import { useEffect, useState } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FileOperationRequest } from '@/app/types'

export function FileOperationDialogs({
  request,
  busy,
  onOpenChange,
  onSubmit,
  onPickDirectory,
}: {
  request: FileOperationRequest | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: { kind: FileOperationRequest['kind']; hit: FileOperationRequest['hit']; name?: string; directory?: string }) => void
  onPickDirectory: () => Promise<string | null>
}) {
  const [name, setName] = useState('')
  const [directory, setDirectory] = useState('')

  useEffect(() => {
    setName(request?.hit.name ?? '')
    setDirectory(request?.hit.parent ?? '')
  }, [request])

  const open = request !== null
  const close = () => {
    if (!busy) onOpenChange(false)
  }
  const pickDirectory = async () => {
    const picked = await onPickDirectory()
    if (picked) setDirectory(picked)
  }

  return (
    <>
      <Dialog open={open && request?.kind !== 'delete'} onOpenChange={(next) => !next && close()}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>{request?.kind === 'rename' ? '重命名' : '移动到目录'}</DialogTitle>
            <DialogDescription className="break-all">{request?.hit.path}</DialogDescription>
          </DialogHeader>
          {request?.kind === 'rename' ? (
            <div className="grid gap-2">
              <Label htmlFor="file-operation-name">新名称</Label>
              <Input id="file-operation-name" value={name} autoFocus disabled={busy} onChange={(event) => setName(event.target.value)} />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="file-operation-directory">目标目录</Label>
              <div className="flex gap-2">
                <Input id="file-operation-directory" value={directory} disabled={busy} onChange={(event) => setDirectory(event.target.value)} />
                <Button variant="outline" size="icon" title="选择目录" disabled={busy} onClick={() => void pickDirectory()}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">目标目录必须位于当前资料库根目录内。</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>取消</Button>
            <Button
              disabled={busy || (request?.kind === 'rename' ? !name.trim() : !directory.trim())}
              onClick={() => request && void onSubmit({ kind: request.kind, hit: request.hit, name, directory })}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {request?.kind === 'rename' ? '保存' : '移动'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={open && request?.kind === 'delete'} onOpenChange={(next) => !next && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除？</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              “{request?.hit.name}”会从电脑中直接删除，不会移动到隔离区，删除后无法通过 Nestify 恢复。{request?.hit.path}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => request && void onSubmit({ kind: 'delete', hit: request.hit })}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
