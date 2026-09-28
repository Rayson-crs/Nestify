import { MergePane } from "@/components/workspace/MergePane"
import { useMediaMerge } from "@/app/useMediaMerge"
import type { AppViewModel } from "@/app/types"
import { useEffect } from "react"

export function MergeWorkspace({ vm }: { vm: AppViewModel }) {
  const merge = useMediaMerge(vm.mergeInput)
  const active = vm.tab === 'merge'
  useEffect(() => {
    if (!active) return
    vm.rememberFeatureBridge({
      ...vm.featureBridge,
      importSearchMedia: (hits, entryIds) => {
        merge.importFromSearch(hits as never, entryIds)
        return true
      },
      handleUseDuplicateDirectory: async () => undefined,
      handleUseRenameDirectory: async () => undefined,
      handleSendSelectionTo: () => undefined,
      setTab: vm.setTab,
      loadRules: async () => undefined,
      planBusy: null,
      executeProgress: null,
    })
    return () => vm.rememberFeatureBridge(null)
  }, [active, merge, vm])
  return <MergePane merge={merge} ipcReady={vm.ipcReady} />
}
