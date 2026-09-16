import { FileTreePane } from '@/components/files/FileTreePane'
import { FileViewTabs } from '@/components/files/FileViewTabs'
import { Inspector } from '@/components/files/Inspector'
import { SearchPane } from '@/components/files/SearchPane'
import { JobsPane } from '@/components/JobsPane'
import { DuplicatePane, OrganizePane, RenamePane } from '@/components/workspace'
import type { AppViewModel } from '@/app/types'
import { errorMessage } from '@/lib/labels'

export function WorkspaceBody(vm: AppViewModel) {
  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {vm.tab === 'search' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <FileViewTabs
              mode={vm.fileViewMode}
              onMode={vm.setFileViewMode}
            />
            {vm.fileViewMode === 'tree' ? (
              <FileTreePane
                hits={vm.allLibrariesSelected && !vm.treePath ? vm.libraryRootHits : vm.treeHits}
                total={vm.allLibrariesSelected && !vm.treePath ? vm.libraryRootHits.length : vm.treeTotal}
                offset={vm.allLibrariesSelected && !vm.treePath ? 0 : vm.treeOffset}
                hasMore={vm.allLibrariesSelected && !vm.treePath ? false : vm.treeHasMore}
                path={vm.allLibrariesSelected && !vm.treePath ? '' : vm.treePath ?? vm.selectedLibrary?.roots[0] ?? ''}
                rootMode={vm.allLibrariesSelected && !vm.treePath}
                rootPath={vm.treeRootPath}
                selected={vm.selectedHit}
                busy={vm.treeBusy}
                actionsEnabled={vm.ipcReady}
                actionBusy={vm.busy !== null}
                sort={vm.treeSort}
                sortDirection={vm.treeSortDirection}
                onEnterDirectory={vm.enterTreeDirectory}
                onSelect={vm.setSelectedHit}
                onOpen={(hit) => void vm.handleOpen(hit.path)}
                onCopyPath={(hit) => void vm.handleCopyPath(hit.path)}
                onRename={vm.handleFileRename}
                onMove={vm.handleFileMove}
                onDelete={vm.handleFileDelete}
                onSort={vm.changeTreeSort}
                onPage={vm.changeTreePage}
                empty={!vm.hasLibraries}
              />
            ) : (
              <SearchPane
                hits={vm.hits}
                total={vm.hitTotal}
                selected={vm.selectedHit}
                selectedIds={vm.selectedEntryIds}
                kind={vm.searchKind}
                sort={vm.searchSort}
                sortDirection={vm.searchSortDirection}
                scope={vm.searchScope}
                directory={vm.searchDirectory}
                offset={vm.searchOffset}
                hasMore={vm.searchHasMore}
                busy={vm.searchBusy}
                actionsEnabled={vm.ipcReady}
                actionBusy={vm.busy !== null}
                canUseSelectedDirectory={Boolean(vm.selectedHit?.parent)}
                onSelect={vm.setSelectedHit}
                onKind={vm.setSearchKind}
                onSort={vm.changeSearchSort}
                onSortDirection={vm.setSearchSortDirection}
                onScope={vm.setSearchScope}
                onDirectory={vm.setSearchDirectory}
                onUseSelectedDirectory={() => {
                  if (vm.selectedHit?.parent) vm.setSearchDirectory(vm.selectedHit.parent)
                }}
                onPage={(delta) => {
                  const next = Math.max(0, vm.searchOffset + delta * 100)
                  if (next === vm.searchOffset || (delta > 0 && !vm.searchHasMore)) return
                  void vm.runSearch(vm.query, vm.selectedLibraryId, next)
                }}
                onToggleSelect={(entryId, checked) =>
                  vm.setSelectedEntryIds((current) =>
                    checked ? [...new Set([...current, entryId])] : current.filter((id) => id !== entryId),
                  )
                }
                onOpen={(hit) => void vm.handleOpen(hit.path)}
                onCopyPath={(hit) => void vm.handleCopyPath(hit.path)}
                onRename={vm.handleFileRename}
                onMove={vm.handleFileMove}
                onDelete={vm.handleFileDelete}
                onEnterDirectory={vm.revealInTree}
                onShowInTree={vm.revealInTree}
                onSendTo={vm.handleSendSelectionTo}
                empty={!vm.hasLibraries}
              />
            )}
          </div>
        ) : null}
        {vm.tab === 'organize' ? (
          <OrganizePane
            step={vm.organizeStep}
            directory={vm.organizeDirectory}
            matchedLibraryName={vm.libraryForOrganize?.name ?? null}
            blockReason={vm.organizeBlockReason}
            filter={vm.organizeFilter}
            filterPreview={vm.organizeFilterPreview}
            filterPreviewTotal={vm.organizeFilterPreviewTotal}
            filterPreviewOffset={vm.organizeFilterPreviewOffset}
            filterPreviewHasMore={vm.organizeFilterPreviewHasMore}
            filterPreviewBusy={vm.organizeFilterPreviewBusy}
            directoryPreview={vm.organizeDirectoryPreview}
            directoryPreviewTotal={vm.organizeDirectoryPreviewTotal}
            directoryPreviewOffset={vm.organizeDirectoryPreviewOffset}
            directoryPreviewHasMore={vm.organizeDirectoryPreviewHasMore}
            directoryPreviewBusy={vm.organizeDirectoryPreviewBusy}
            previewSort={vm.organizeDirectoryPreviewSort}
            previewSortDirection={vm.organizeDirectoryPreviewSortDirection}
            ruleDraft={vm.organizeRuleDraft}
            collision={vm.collision}
            selectedCount={vm.selectedCount}
            canPick={vm.organizeCanPick}
            canRules={vm.organizeCanRules}
            busy={vm.organizeBusy}
            previewBusy={vm.organizePreviewBusy}
            preview={vm.organizePreview}
            plan={vm.activePlan}
            selectedOps={vm.selectedOps}
            busyExecute={vm.busy === 'execute'}
            executeProgress={vm.executeProgress}
            busyRollback={vm.busy === 'rollback'}
            lastExecuteJobId={vm.lastExecuteJobId}
            canGoParent={vm.canOrganizeGoParent}
            onDirectory={vm.handleOrganizeDirectoryChange}
            onPickDirectory={() => void vm.handlePickOrganizeDirectory()}
            onFilter={vm.handleOrganizeFilterChange}
            onRuleDraft={vm.setOrganizeRuleDraft}
            onCollision={vm.setCollision}
            onPreviewSort={vm.handleOrganizePreviewSort}
            onDirectoryPreviewPage={vm.handleOrganizeDirectoryPreviewPage}
            onFilterPreviewPage={vm.handleOrganizeFilterPreviewPage}
            onEnterDirectory={vm.handleOrganizeEnterDirectory}
            onGoParent={vm.handleOrganizeGoParent}
            onNextFromFilter={vm.handleOrganizeNextFromFilter}
            onNextFromRules={() => void vm.handleOrganizeNextFromRules()}
            onBackToPick={() => vm.setOrganizeStep('pick')}
            onEditFilter={() => vm.setOrganizeStep('filter')}
            onEditRules={() => vm.setOrganizeStep('rules')}
            onToggleOp={(index, checked) => vm.setSelectedOps((current) => ({ ...current, [index]: checked }))}
            onExecute={() => void vm.handleExecutePlan()}
            onRollback={() => void vm.handleRollback()}
          />
        ) : null}
        {vm.tab === 'rename' ? (
          <RenamePane
            step={vm.renameStep}
            directory={vm.renameDirectory}
            matchedLibraryName={vm.libraryForRename?.name ?? null}
            analyzeBlockReason={vm.renameBlockReason}
            filter={vm.renameFilter}
            groups={vm.renameGroups}
            ruleSelected={vm.renameRuleSelected}
            collision={vm.collision}
            preview={vm.renamePreview}
            previewTotal={vm.renamePreviewTotal}
            previewOffset={vm.renamePreviewOffset}
            previewHasMore={vm.renamePreviewHasMore}
            previewLoading={vm.renamePreviewLoading}
            previewSort={vm.renamePreviewSort}
            previewSortDirection={vm.renamePreviewSortDirection}
            filterPreview={vm.renameFilterPreview}
            filterPreviewTotal={vm.renameFilterPreviewTotal}
            filterPreviewOffset={vm.renameFilterPreviewOffset}
            filterPreviewHasMore={vm.renameFilterPreviewHasMore}
            filterPreviewLoading={vm.renameFilterPreviewBusy}
            canGoParent={vm.canRenameGoParent}
            busy={vm.busy === 'rename'}
            previewBusy={vm.renamePreviewBusy}
            onDirectory={vm.handleRenameDirectoryChange}
            onPickDirectory={() => void vm.handlePickRenameDirectory()}
            onFilter={vm.handleRenameFilterChange}
            onGroups={vm.setRenameGroups}
            onToggleRule={vm.handleToggleRenameRule}
            onToggleAllRules={vm.handleToggleAllRenameRules}
            onCollision={vm.setCollision}
            onPreviewSort={vm.handleRenamePreviewSort}
            onPreviewPage={vm.handleRenamePreviewPage}
            onFilterPreviewPage={vm.handleRenameFilterPreviewPage}
            onEnterDirectory={vm.handleRenameEnterDirectory}
            onGoParent={vm.handleRenameGoParent}
            onNextFromFilter={vm.handleRenameNextFromFilter}
            onNextFromRules={() => void vm.handleRenameNextFromRules()}
            onBackToPick={() => vm.setRenameStep('pick')}
            onEditFilter={() => vm.setRenameStep('filter')}
            onEditRules={() => vm.setRenameStep('rules')}
            plan={vm.activePlan}
            selectedOps={vm.selectedOps}
            onToggleOp={(index, checked) => vm.setSelectedOps((current) => ({ ...current, [index]: checked }))}
            selectedCount={vm.selectedCount}
            busyExecute={vm.busy === 'execute'}
            executeProgress={vm.executeProgress}
            busyRollback={vm.busy === 'rollback'}
            lastExecuteJobId={vm.lastExecuteJobId}
            onExecute={() => void vm.handleExecutePlan()}
            onRollback={() => void vm.handleRollback()}
          />
        ) : null}
        {vm.tab === 'duplicates' ? (
          <DuplicatePane
            step={vm.duplicateStep}
            groups={vm.duplicateGroups}
            keepStrategy={vm.keepStrategy}
            hashStrategy={vm.duplicateHashStrategy}
            directory={vm.duplicateDirectory}
            matchedLibraryName={vm.libraryForDirectory?.name ?? null}
            analyzeBlockReason={vm.analyzeBlockReason}
            filter={vm.duplicateFilter}
            preview={vm.duplicatePreview}
            previewTotal={vm.duplicatePreviewTotal}
            previewOffset={vm.duplicatePreviewOffset}
            previewHasMore={vm.duplicatePreviewHasMore}
            previewBusy={vm.duplicatePreviewBusy}
            previewSort={vm.duplicatePreviewSort}
            previewSortDirection={vm.duplicatePreviewSortDirection}
            filterPreview={vm.duplicateFilterPreview}
            filterPreviewTotal={vm.duplicateFilterPreviewTotal}
            filterPreviewOffset={vm.duplicateFilterPreviewOffset}
            filterPreviewHasMore={vm.duplicateFilterPreviewHasMore}
            filterPreviewBusy={vm.duplicateFilterPreviewBusy}
            analysisProgress={vm.duplicateAnalysisProgress}
            activeGroupId={vm.activeGroupId}
            groupsPaneWidth={vm.groupsPaneWidth}
            onPreviewSort={vm.handleDuplicatePreviewSort}
            onPreviewPage={vm.handleDuplicatePreviewPage}
            onFilterPreviewPage={vm.handleDuplicateFilterPreviewPage}
            onEnterDirectory={vm.handleDuplicateEnterDirectory}
            onGoParent={vm.handleDuplicateGoParent}
            canGoParent={vm.canDuplicateGoParent}
            busy={vm.busy === 'duplicates'}
            onKeepStrategy={vm.handleDuplicateKeepStrategyChange}
            onHashStrategy={vm.setDuplicateHashStrategy}
            onDirectory={vm.handleDuplicateDirectoryChange}
            onPickDirectory={() => void vm.handlePickDuplicateDirectory()}
            onFilter={vm.handleDuplicateFilterChange}
            onAnalyze={() => void vm.handleAnalyzeDuplicates()}
            onBackToPick={() => vm.setDuplicateStep('pick')}
            onEditFilter={() => vm.setDuplicateStep('filter')}
            plan={vm.activePlan}
            selectedOps={vm.selectedOps}
            onToggleOp={(index, checked) => vm.setSelectedOps((current) => ({ ...current, [index]: checked }))}
            onToggleKeep={vm.handleDuplicateToggleKeep}
            onResetGroup={vm.handleDuplicateResetGroup}
            onSelectGroup={vm.setActiveGroupId}
            onGroupsPaneResize={vm.setGroupsPaneWidth}
            selectedCount={vm.selectedCount}
            busyExecute={vm.busy === 'execute'}
            executeProgress={vm.executeProgress}
            lastExecuteJobId={vm.lastExecuteJobId}
            onExecute={() => void vm.handleExecutePlan()}
            onRollback={() => void vm.handleRollback()}
          />
        ) : null}
        {vm.tab === 'jobs' ? (
          <JobsPane
            jobs={vm.jobs}
            libraries={vm.libraries}
            selectedJobId={vm.selectedJobId}
            ops={vm.jobOps}
            loading={vm.jobsLoading}
            opsLoading={vm.jobOpsLoading}
            onRefresh={() => void vm.loadJobs().catch((err) => vm.setError(errorMessage(err)))}
            onSelect={(jobId) => void vm.openJobDetails(jobId)}
          />
        ) : null}
      </section>
      <Inspector
        hit={vm.selectedHit}
        preview={vm.preview}
        thumbnail={vm.thumbnail}
        open={vm.inspectorOpen}
        busyOpen={vm.busy === 'open'}
        actionsBusy={vm.busy !== null || !vm.ipcReady}
        onOpenChange={vm.setInspectorOpen}
        onOpen={() => vm.selectedHit && void vm.handleOpen(vm.selectedHit.path)}
      />
    </div>
  )
}
