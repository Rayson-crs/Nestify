from pathlib import Path
Path('apps/desktop/src/components/app/AppFooter.tsx').write_text(r'''import { Progress } from '@/components/ui/progress'
import type { ScanProgress } from '@/lib/ipc'

export function AppFooter({
  scan,
  scanPhaseLabel,
  scanPercentDisplay,
  scanCompleted,
  searchElapsed,
  hitTotal,
}: {
  scan: ScanProgress
  scanPhaseLabel: string
  scanPercentDisplay: number
  scanCompleted: boolean
  searchElapsed: number | null
  hitTotal: number
}) {
  return (
    <footer className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
      <span className="w-16">{scanPhaseLabel}</span>
      <Progress
        value={scanPercentDisplay}
        className="w-40"
        indicatorClassName={scanCompleted ? 'bg-green-600' : undefined}
      />
      <span className="w-10 text-right">{Math.round(scanPercentDisplay)}%</span>
      <span>文件 {scan.filesScanned}</span>
      <span>目录 {scan.dirsScanned}</span>
      {scan.filesPerSecond ? <span>{Math.round(scan.filesPerSecond)}/s</span> : null}
      {scan.errors ? <span className="text-destructive">错误 {scan.errors}</span> : null}
      <span className="min-w-0 flex-1 truncate">{scan.currentPath || '就绪'}</span>
      {searchElapsed != null ? <span>搜索 {searchElapsed}ms / {hitTotal}</span> : null}
    </footer>
  )
}
''', encoding='utf-8')

Path('apps/desktop/src/components/app/AppDialogs.tsx').write_text(r'''import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { LibraryEditor } from '@/components/LibraryEditor'
import { SpotlightSearch } from '@/components/files/SpotlightSearch'
import type { AppViewModel } from '@/app/types'

export function AppDialogs(vm: AppViewModel) {
  return (
    <>
      <AlertDialog
        open={vm.confirmation !== null}
        onOpenChange={(open) => {
          if (!open) vm.setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{vm.confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{vm.confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => vm.setConfirmation(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void vm.runConfirmation()}>{vm.confirmation?.confirmLabel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={vm.closePromptOpen} onOpenChange={vm.setClosePromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭 Nestify</AlertDialogTitle>
            <AlertDialogDescription>
              最小化后会保留在系统托盘，可从托盘图标重新打开或退出。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void vm.handleQuitApp()}>退出</AlertDialogAction>
            <AlertDialogAction onClick={() => void vm.handleMinimizeToTray()}>最小化</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SpotlightSearch
        open={vm.spotlightOpen}
        query={vm.spotlightQuery}
        hits={vm.spotlightHits}
        busy={vm.spotlightBusy}
        activeIndex={vm.spotlightActiveIndex}
        enabled={vm.ipcReady && vm.libraries.length > 0}
        onOpenChange={(open) => vm.setSpotlightOpen(open, 'dialog')}
        onQuery={(value) => {
          vm.setSpotlightQuery(value)
          vm.setSpotlightActiveIndex(0)
        }}
        onActiveIndex={vm.setSpotlightActiveIndex}
        onOpen={vm.openSpotlightHit}
      />

      <LibraryEditor
        open={vm.editingLibraryId !== null}
        draft={vm.libraryDraft}
        busy={vm.editingLibraryId ? vm.busy === `library:update:${vm.editingLibraryId}` : false}
        onOpenChange={(open) => {
          if (!open) vm.setEditingLibraryId(null)
        }}
        onDraft={vm.setLibraryDraft}
        onSave={() => void vm.handleUpdateLibrary()}
      />
    </>
  )
}
''', encoding='utf-8')
print('footer and dialogs written')
