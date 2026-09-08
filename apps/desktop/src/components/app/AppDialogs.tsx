import {
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
        enabled={vm.ipcReady}
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
