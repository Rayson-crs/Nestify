import { DuplicatePane } from "@/components/workspace/DuplicatePane"
import { usePlans } from "@/app/usePlans"
import type { AppViewModel } from "@/app/types"
import { useEffect } from "react"

export function DuplicateWorkspace({ vm }: { vm: AppViewModel }) {
  const plans = usePlans({ ...vm.featureInput, tab: 'duplicates' })
  const active = vm.tab === 'duplicates'
  useEffect(() => {
    if (!active) return
    vm.rememberFeatureBridge(plans)
    return () => vm.rememberFeatureBridge(null)
  }, [active, plans, vm])
  return (
    <DuplicatePane
      step={plans.duplicateStep}
      groups={plans.duplicateGroups}
      keepStrategy={plans.keepStrategy}
      hashStrategy={plans.duplicateHashStrategy}
      directory={plans.duplicateDirectory}
      matchedLibraryName={plans.libraryForDirectory?.name ?? null}
      analyzeBlockReason={plans.analyzeBlockReason}
      filter={plans.duplicateFilter}
      preview={plans.duplicatePreview}
      previewTotal={plans.duplicatePreviewTotal}
      previewOffset={plans.duplicatePreviewOffset}
      previewHasMore={plans.duplicatePreviewHasMore}
      previewBusy={plans.duplicatePreviewBusy}
      previewSort={plans.duplicatePreviewSort}
      previewSortDirection={plans.duplicatePreviewSortDirection}
      filterPreview={plans.duplicateFilterPreview}
      filterPreviewTotal={plans.duplicateFilterPreviewTotal}
      filterPreviewOffset={plans.duplicateFilterPreviewOffset}
      filterPreviewHasMore={plans.duplicateFilterPreviewHasMore}
      filterPreviewBusy={plans.duplicateFilterPreviewBusy}
      analysisProgress={plans.duplicateAnalysisProgress}
      resultLoading={plans.duplicateResultLoading}
      jobId={plans.duplicateJobId}
      groupsOffset={plans.duplicateGroupsOffset}
      groupsTotal={plans.duplicateGroupsTotal}
      groupsHasMore={plans.duplicateGroupsHasMore}
      resultFileCount={plans.duplicateResultFileCount}
      resultWastedBytes={plans.duplicateResultWastedBytes}
      resultSelectedCount={plans.duplicateSelectedCount}
      resultSelectedBytes={plans.duplicateSelectedBytes}
      files={plans.duplicateFiles}
      filesOffset={plans.duplicateFilesOffset}
      filesTotal={plans.duplicateFilesTotal}
      filesHasMore={plans.duplicateFilesHasMore}
      filesBusy={plans.duplicateFilesBusy}
      resultKindFilter={plans.resultKindFilter}
      activeGroupId={plans.activeGroupId}
      groupsPaneWidth={plans.groupsPaneWidth}
      onPreviewSort={plans.handleDuplicatePreviewSort}
      onPreviewPage={plans.handleDuplicatePreviewPage}
      onFilterPreviewPage={plans.handleDuplicateFilterPreviewPage}
      onEnterDirectory={plans.handleDuplicateEnterDirectory}
      onGoParent={plans.handleDuplicateGoParent}
      canGoParent={plans.canDuplicateGoParent}
      busy={vm.busy === "duplicates"}
      onKeepStrategy={plans.handleDuplicateKeepStrategyChange}
      onHashStrategy={plans.setDuplicateHashStrategy}
      onDirectory={plans.handleDuplicateDirectoryChange}
      onPickDirectory={() => void plans.handlePickDuplicateDirectory()}
      onFilter={plans.handleDuplicateFilterChange}
      onAnalyze={() => void plans.handleAnalyzeDuplicates()}
      onBackToPick={() => plans.setDuplicateStep("pick")}
      onEditFilter={() => plans.setDuplicateStep("filter")}
      plan={plans.activePlan}
      selectedOps={plans.selectedOps}
      onToggleOp={(index, checked) => plans.setSelectedOps((current) => ({ ...current, [index]: checked }))}
      onToggleKeep={plans.handleDuplicateToggleKeep}
      onResetGroup={plans.handleDuplicateResetGroup}
      onSelectGroup={plans.handleDuplicateSelectGroup}
      onCancelAnalysis={() => void plans.handleDuplicateCancelAnalysis()}
      onGroupsPage={plans.handleDuplicateGroupsPage}
      onFilesPage={plans.handleDuplicateFilesPage}
      onResultKindChange={plans.handleDuplicateResultKindChange}
      onGroupsPaneResize={plans.setGroupsPaneWidth}
      selectedCount={plans.selectedCount}
      busyExecute={vm.busy === "execute"}
      executeProgress={plans.executeProgress}
      lastExecuteJobId={plans.lastExecuteJobId}
      onExecute={() => void plans.handleExecutePlan()}
      onRollback={() => void plans.handleRollback()}
    />
  )
}
