import type { SearchHit } from "@/lib/ipc"
import type { WorkspaceTab } from "@/lib/workspace"
import type { WorkspaceFeatureBridge } from "@/app/workspace-feature-bridge"

export function sendSelectionTo(input: {
  target: Exclude<WorkspaceTab, "search" | "jobs">
  searchHits: SearchHit[]
  selectedHit: SearchHit | null
  selectedEntryIds: string[]
  setSelectedEntryIds: (entryIds: string[]) => void
  featureBridge: WorkspaceFeatureBridge | null
  setError: (error: string | null) => void
  setNotice: (notice: string | null) => void
}): void {
  const selected = input.selectedHit
  const entryIds = input.selectedEntryIds.length > 0
    ? input.selectedEntryIds
    : selected
      ? [selected.entryId]
      : []
  const directory = selected
    ? selected.kind === "dir"
      ? selected.path
      : selected.parent ?? ""
    : ""
  const plans = input.featureBridge
  if (!plans) {
    input.setNotice("功能页面还在准备")
    return
  }

  if (input.target === "duplicates") {
    input.setSelectedEntryIds(entryIds)
    if (directory) {
      void plans.handleUseDuplicateDirectory(directory)
      input.setNotice(`已定位到目录：${directory}`)
    } else {
      input.setNotice("请在重复分析里填入或选择目录")
    }
    plans.setTab("duplicates")
    return
  }

  if (input.target === "rename") {
    input.setSelectedEntryIds(entryIds)
    if (directory) {
      void plans.handleUseRenameDirectory(directory)
      input.setNotice(`已定位到目录：${directory}`)
    } else {
      input.setNotice("请在改名里填入或选择目录")
    }
    plans.setTab("rename")
    return
  }

  if (input.target === "merge") {
    const imported = plans.importSearchMedia?.(input.searchHits, entryIds) ?? false
    if (!imported) input.setError("请先选择图片或视频文件")
    plans.setTab("merge")
    return
  }

  if (entryIds.length === 0) {
    input.setError("请先选择搜索结果")
    return
  }
  input.setSelectedEntryIds(entryIds)
  plans.handleSendSelectionTo(input.target)
}
