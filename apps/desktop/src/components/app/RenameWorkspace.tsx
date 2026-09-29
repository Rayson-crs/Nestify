import { RenamePane } from "@/components/workspace/RenamePane"
import { usePlans } from "@/app/usePlans"
import type { AppViewModel } from "@/app/types"
import { useEffect } from "react"

export function RenameWorkspace({ vm }: { vm: AppViewModel }) {
  const plans = usePlans({ ...vm.featureInput, tab: 'rename' })
  const active = vm.tab === 'rename'
  useEffect(() => {
    if (!active) return
    vm.rememberFeatureBridge(plans)
    return () => vm.rememberFeatureBridge(null)
  }, [active, plans, vm])
  return (
    <RenamePane
      step={plans.renameStep}
      directory={plans.renameDirectory}
      matchedLibraryName={plans.libraryForRename?.name ?? null}
      analyzeBlockReason={plans.renameBlockReason}
      filter={plans.renameFilter}
      groups={plans.renameGroups}
      ruleSelected={plans.renameRuleSelected}
      collision={plans.collision}
      preview={plans.renamePreview}
      previewTotal={plans.renamePreviewTotal}
      previewOffset={plans.renamePreviewOffset}
      previewHasMore={plans.renamePreviewHasMore}
      previewLoading={plans.renamePreviewLoading}
      previewSort={plans.renamePreviewSort}
      previewSortDirection={plans.renamePreviewSortDirection}
      filterPreview={plans.renameFilterPreview}
      filterPreviewTotal={plans.renameFilterPreviewTotal}
      filterPreviewOffset={plans.renameFilterPreviewOffset}
      filterPreviewHasMore={plans.renameFilterPreviewHasMore}
      filterPreviewLoading={plans.renameFilterPreviewBusy}
      canGoParent={plans.canRenameGoParent}
      busy={vm.busy === "rename"}
      previewBusy={plans.renamePreviewBusy}
      onDirectory={plans.handleRenameDirectoryChange}
      onPickDirectory={() => void plans.handlePickRenameDirectory()}
      onFilter={plans.handleRenameFilterChange}
      onGroups={plans.setRenameGroups}
      onToggleRule={plans.handleToggleRenameRule}
      onToggleAllRules={plans.handleToggleAllRenameRules}
      onCollision={plans.setCollision}
      onPreviewSort={plans.handleRenamePreviewSort}
      onPreviewPage={plans.handleRenamePreviewPage}
      onFilterPreviewPage={plans.handleRenameFilterPreviewPage}
      onEnterDirectory={plans.handleRenameEnterDirectory}
      onGoParent={plans.handleRenameGoParent}
      onNextFromFilter={plans.handleRenameNextFromFilter}
      onNextFromRules={() => void plans.handleRenameNextFromRules()}
      onBackToPick={() => plans.setRenameStep("pick")}
      onEditFilter={() => plans.setRenameStep("filter")}
      onEditRules={() => plans.setRenameStep("rules")}
      plan={plans.renameCurrentPlan}
      resultOps={plans.renameResultOps}
      selectedOps={plans.selectedOps}
      planOffset={plans.renamePlanOffset}
      planTotal={plans.renamePlanTotal}
      onPlanPage={plans.handleRenamePlanPage}
      onToggleOp={(index, checked) => plans.setSelectedOps((current) => ({ ...current, [index]: checked }))}
      selectedCount={plans.selectedCount}
      busyExecute={vm.busy === "execute"}
      executeProgress={plans.executeProgress}
      busyRollback={vm.busy === "rollback"}
      lastExecuteJobId={plans.lastExecuteJobId}
      onExecute={() => void plans.handleExecutePlan()}
      onRollback={() => void plans.handleRollback()}
    />
  )
}
