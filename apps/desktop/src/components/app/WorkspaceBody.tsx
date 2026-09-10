import { FileTreePane } from '@/components/files/FileTreePane'
import { FileViewTabs } from '@/components/files/FileViewTabs'
import { Inspector } from '@/components/files/Inspector'
import { SearchPane } from '@/components/files/SearchPane'
import { JobsPane } from '@/components/JobsPane'
import { DuplicatePane, RenamePane, RulesPane } from '@/components/workspace'
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
                path={vm.allLibrariesSelected && !vm.treePath ? '' : vm.treePath ?? vm.selectedLibrary?.roots[0] ?? ''}
                rootMode={vm.allLibrariesSelected && !vm.treePath}
                rootPath={vm.treeRootPath}
                selected={vm.selectedHit}
                busy={vm.treeBusy}
                actionsEnabled={vm.ipcReady}
                actionBusy={vm.busy !== null}
                sort={vm.treeSort}
                sortDirection={vm.treeSortDirection}
                onEnterDirectory={vm.setTreePath}
                onSelect={vm.setSelectedHit}
                onOpen={(hit) => void vm.handleOpen(hit.path)}
                onCopyPath={(hit) => void vm.handleCopyPath(hit.path)}
                onRename={vm.handleFileRename}
                onMove={vm.handleFileMove}
                onDelete={vm.handleFileDelete}
                onSort={vm.changeTreeSort}
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
        {vm.tab === 'rules' ? (
          <RulesPane
            ruleSets={vm.ruleSets}
            selectedRuleSet={vm.selectedRuleSet}
            collision={vm.collision}
            scope={vm.duplicateScope}
            directory={vm.duplicateDirectory}
            searchSelectedCount={vm.selectedEntryIds.length}
            canPreview={vm.canPreviewScope}
            canUseSelectedDirectory={Boolean(vm.selectedHit?.parent)}
            busy={vm.busy === 'rules'}
            actionBusy={vm.ruleActionBusy}
            ruleDraft={vm.ruleDraft}
            onSelectRuleSet={vm.setSelectedRuleSetId}
            onCollision={vm.setCollision}
            onScope={vm.setDuplicateScope}
            onDirectory={vm.setDuplicateDirectory}
            onUseSelectedDirectory={() => {
              if (vm.selectedHit?.parent) vm.setDuplicateDirectory(vm.selectedHit.parent)
            }}
            onRuleDraft={vm.setRuleDraft}
            onCreateRuleSet={() => void vm.handleCreateRuleSet()}
            onUpdateRuleSet={() => void vm.handleUpdateRuleSet()}
            onRefreshRuleSet={() => void vm.handleRefreshRuleSet()}
            onToggleRuleSet={() => void vm.handleToggleRuleSet()}
            onRuleSetPriority={(delta) => void vm.handleRuleSetPriority(delta)}
            onCloneRuleSet={() => void vm.handleCloneRuleSet()}
            onDeleteRuleSet={() => void vm.handleDeleteRuleSet()}
            onExportRuleSet={() => void vm.handleExportRuleSet()}
            onImportRuleSet={() => void vm.handleImportRuleSet()}
            onPreview={() => void vm.handleRulesPreview()}
            plan={vm.activePlan}
            selectedOps={vm.selectedOps}
            onToggleOp={(index, checked) => vm.setSelectedOps((current) => ({ ...current, [index]: checked }))}
            selectedCount={vm.selectedCount}
            busyExecute={vm.busy === 'execute'}
            busyRollback={vm.busy === 'rollback'}
            lastExecuteJobId={vm.lastExecuteJobId}
            onExecute={() => void vm.handleExecutePlan()}
            onRollback={() => void vm.handleRollback()}
            sampleHits={vm.selectedHit ? [vm.selectedHit, ...vm.hits.filter((hit) => hit.entryId !== vm.selectedHit?.entryId)] : vm.hits}
          />
        ) : null}
        {vm.tab === 'rename' ? (
          <RenamePane
            template={vm.template}
            collision={vm.collision}
            scope={vm.duplicateScope}
            directory={vm.duplicateDirectory}
            searchSelectedCount={vm.selectedEntryIds.length}
            canPreview={vm.canPreviewScope}
            canUseSelectedDirectory={Boolean(vm.selectedHit?.parent)}
            busy={vm.busy === 'rename' || vm.busy === 'rules'}
            onTemplate={vm.setTemplate}
            onCollision={vm.setCollision}
            onScope={vm.setDuplicateScope}
            onDirectory={vm.setDuplicateDirectory}
            onUseSelectedDirectory={() => {
              if (vm.selectedHit?.parent) vm.setDuplicateDirectory(vm.selectedHit.parent)
            }}
            onPreview={() => void vm.handleRenamePreview()}
            ruleSets={vm.ruleSets}
            selectedRuleSetId={vm.selectedRuleSetId}
            onRuleSet={vm.setSelectedRuleSetId}
            onPreviewRules={() => void vm.handleRulesPreview()}
            plan={vm.activePlan}
            selectedOps={vm.selectedOps}
            onToggleOp={(index, checked) => vm.setSelectedOps((current) => ({ ...current, [index]: checked }))}
            selectedCount={vm.selectedCount}
            busyExecute={vm.busy === 'execute'}
            busyRollback={vm.busy === 'rollback'}
            lastExecuteJobId={vm.lastExecuteJobId}
            onExecute={() => void vm.handleExecutePlan()}
            onRollback={() => void vm.handleRollback()}
            sampleHits={vm.selectedHit ? [vm.selectedHit, ...vm.hits.filter((hit) => hit.entryId !== vm.selectedHit?.entryId)] : vm.hits}
          />
        ) : null}
        {vm.tab === 'duplicates' ? (
          <DuplicatePane
            groups={vm.duplicateGroups}
            keepStrategy={vm.keepStrategy}
            hashStrategy={vm.duplicateHashStrategy}
            directory={vm.duplicateDirectory}
            matchedLibraryName={vm.libraryForDirectory?.name ?? null}
            busy={vm.busy === 'duplicates'}
            onKeepStrategy={vm.setKeepStrategy}
            onHashStrategy={vm.setDuplicateHashStrategy}
            onDirectory={vm.setDuplicateDirectory}
            onPickDirectory={() => void vm.handlePickDuplicateDirectory()}
            onAnalyze={() => void vm.handleAnalyzeDuplicates()}
            analyzeBlockReason={vm.analyzeBlockReason}
            plan={vm.activePlan}
            selectedOps={vm.selectedOps}
            onToggleOp={(index, checked) => vm.setSelectedOps((current) => ({ ...current, [index]: checked }))}
            selectedCount={vm.selectedCount}
            busyExecute={vm.busy === 'execute'}
            busyRollback={vm.busy === 'rollback'}
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
            busyJobId={vm.busy?.startsWith('rollback:') ? vm.busy.slice('rollback:'.length) : null}
            onRefresh={() => void vm.loadJobs().catch((err) => vm.setError(errorMessage(err)))}
            onSelect={vm.setSelectedJobId}
            onRollback={(job) => void vm.handleJobRollback(job)}
          />
        ) : null}
      </section>
      <Inspector
        hit={vm.selectedHit}
        preview={vm.preview}
        open={vm.inspectorOpen}
        busyOpen={vm.busy === 'open'}
        actionsBusy={vm.busy !== null || !vm.ipcReady}
        onOpenChange={vm.setInspectorOpen}
        onOpen={() => vm.selectedHit && void vm.handleOpen(vm.selectedHit.path)}
      />
    </div>
  )
}
