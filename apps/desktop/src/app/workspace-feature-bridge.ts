import type { WorkspaceTab } from "@/lib/workspace"

export type WorkspaceFeatureBridge = {
  handleUseDuplicateDirectory: (directory: string) => Promise<void>
  handleUseRenameDirectory: (directory: string) => Promise<void>
  handleSendSelectionTo: (target: WorkspaceTab) => void
  setTab: (tab: WorkspaceTab) => void
  importSearchMedia?: (hits: Array<{ entryId: string; path: string; kind: string; size: number | null; mtime: number | null }>, entryIds: string[]) => boolean
  loadRules: () => Promise<void>
  planBusy: string | null
  executeProgress: { current: number; total: number; ok: number; failed: number; path: string | null } | null
}
