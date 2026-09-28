import { OrganizePane } from "@/components/workspace/OrganizePane"
import { usePlans } from "@/app/usePlans"
import type { AppViewModel } from "@/app/types"
import { useEffect } from "react"

export function OrganizeWorkspace({ vm }: { vm: AppViewModel }) {
  const plans = usePlans({ ...vm.featureInput, tab: 'organize' })
  const active = vm.tab === 'organize'
  useEffect(() => {
    if (!active) return
    vm.rememberFeatureBridge(plans)
    return () => vm.rememberFeatureBridge(null)
  }, [active, plans, vm])
  return (
    <OrganizePane
      step={plans.organizeStep}
      directory={plans.organizeDirectory}
      matchedLibraryName={plans.libraryForOrganize?.name ?? null}
      blockReason={plans.organizeBlockReason}
      filter={plans.organizeFilter}
      filterPreview={plans.organizeFilterPreview}
      filterPreviewTotal={plans.organizeFilterPreviewTotal}
      filterPreviewOffset={plans.organizeFilterPreviewOffset}
      filterPreviewHasMore={plans.organizeFilterPreviewHasMore}
      filterPreviewBusy={plans.organizeFilterPreviewBusy}
      directoryPreview={plans.organizeDirectoryPreview}
      directoryPreviewTotal={plans.organizeDirectoryPreviewTotal}
      directoryPreviewOffset={plans.organizeDirectoryPreviewOffset}
      directoryPreviewHasMore={plans.organizeDirectoryPreviewHasMore}
      directoryPreviewBusy={plans.organizeDirectoryPreviewBusy}
      previewSort={plans.organizeDirectoryPreviewSort}
      previewSortDirection={plans.organizeDirectoryPreviewSortDirection}
      ruleDraft={plans.organizeRuleDraft}
      collision={plans.collision}
      selectedCount={plans.selectedCount}
      canPick={plans.organizeCanPick}
      canRules={plans.organizeCanRules}
      busy={plans.planBusy === "organize"}
      previewBusy={plans.organizePreviewBusy}
      preview={plans.organizePreview}
      plan={plans.activePlan}
      planOffset={plans.organizePlanOffset}
      planTotal={plans.organizePlanTotal}
      resultOps={plans.organizeResultOps}
      onPlanPage={(delta) => void plans.handleOrganizePlanPage(delta)}
      selectedOps={plans.selectedOps}
      busyExecute={vm.busy === "execute"}
      executeProgress={plans.executeProgress}
      busyRollback={vm.busy === "rollback"}
      lastExecuteJobId={plans.lastExecuteJobId}
      canGoParent={plans.canOrganizeGoParent}
      onDirectory={plans.handleOrganizeDirectoryChange}
      onPickDirectory={() => void plans.handlePickOrganizeDirectory()}
      onFilter={plans.handleOrganizeFilterChange}
      onRuleDraft={plans.setOrganizeRuleDraft}
      onCollision={plans.setCollision}
      onPreviewSort={plans.handleOrganizePreviewSort}
      onDirectoryPreviewPage={plans.handleOrganizeDirectoryPreviewPage}
      onFilterPreviewPage={plans.handleOrganizeFilterPreviewPage}
      onEnterDirectory={plans.handleOrganizeEnterDirectory}
      onGoParent={plans.handleOrganizeGoParent}
      onNextFromFilter={plans.handleOrganizeNextFromFilter}
      onNextFromRules={() => void plans.handleOrganizeNextFromRules()}
      onBackToPick={() => plans.setOrganizeStep("pick")}
      onEditFilter={() => plans.setOrganizeStep("filter")}
      onEditRules={() => plans.setOrganizeStep("rules")}
      onToggleOp={(index, checked) => plans.setSelectedOps((current) => ({ ...current, [index]: checked }))}
      onExecute={() => void plans.handleExecutePlan()}
      onRollback={() => void plans.handleRollback()}
    />
  )
}
