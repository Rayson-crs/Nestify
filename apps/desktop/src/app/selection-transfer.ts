import type { SearchHit } from '@/lib/ipc'
import type { WorkspaceTab } from '@/lib/workspace'
import type { MediaMergeController } from '@/app/useMediaMerge'

type PlanController = {
  handleUseDuplicateDirectory: (directory: string) => Promise<void>
  handleUseRenameDirectory: (directory: string) => Promise<void>
  handleSendSelectionTo: (target: WorkspaceTab) => void
  setTab: (tab: WorkspaceTab) => void
}

export function sendSelectionTo(input: {
  target: Exclude<WorkspaceTab, 'search' | 'jobs'>
  searchHits: SearchHit[]
  selectedHit: SearchHit | null
  selectedEntryIds: string[]
  setSelectedEntryIds: (entryIds: string[]) => void
  merge: Pick<MediaMergeController, 'importFromSearch'>
  plans: PlanController
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
    ? selected.kind === 'dir'
      ? selected.path
      : selected.parent ?? ''
    : ''

  if (input.target === 'duplicates') {
    input.setSelectedEntryIds(entryIds)
    if (directory) {
      void input.plans.handleUseDuplicateDirectory(directory)
      input.setNotice(`已定位到目录：${directory}`)
    } else {
      input.setNotice('请在重复分析里填入或选择目录')
    }
    input.plans.setTab('duplicates')
    return
  }

  if (input.target === 'rename') {
    input.setSelectedEntryIds(entryIds)
    if (directory) {
      void input.plans.handleUseRenameDirectory(directory)
      input.setNotice(`已定位到目录：${directory}`)
    } else {
      input.setNotice('请在改名里填入或选择目录')
    }
    input.plans.setTab('rename')
    return
  }

  if (input.target === 'merge') {
    input.merge.importFromSearch(input.searchHits, entryIds)
    input.plans.setTab('merge')
    return
  }

  if (entryIds.length === 0) {
    input.setError('请先选择搜索结果')
    return
  }
  input.setSelectedEntryIds(entryIds)
  input.plans.handleSendSelectionTo(input.target)
}
