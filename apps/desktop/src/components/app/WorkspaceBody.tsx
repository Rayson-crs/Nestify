import { FileTreePane } from '@/components/files/FileTreePane'
import { FileViewTabs } from '@/components/files/FileViewTabs'
import { Inspector } from '@/components/files/Inspector'
import { SearchPane } from '@/components/files/SearchPane'
import type { AppViewModel } from '@/app/types'
import { errorMessage } from '@/lib/labels'
import { Loader2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { WorkspaceTab } from '@/lib/workspace'

const OrganizeWorkspace = lazy(() => import('@/components/app/OrganizeWorkspace').then((module) => ({ default: module.OrganizeWorkspace })))
const RenameWorkspace = lazy(() => import('@/components/app/RenameWorkspace').then((module) => ({ default: module.RenameWorkspace })))
const DuplicateWorkspace = lazy(() => import('@/components/app/DuplicateWorkspace').then((module) => ({ default: module.DuplicateWorkspace })))
const MergeWorkspace = lazy(() => import('@/components/app/MergeWorkspace').then((module) => ({ default: module.MergeWorkspace })))
const JobsPane = lazy(() => import('@/components/JobsPane').then((module) => ({ default: module.JobsPane })))

export function WorkspaceBody(vm: AppViewModel) {
  const [visitedTabs, setVisitedTabs] = useState<WorkspaceTab[]>(() => [vm.tab])
  if (!visitedTabs.includes(vm.tab)) {
    setVisitedTabs((current) => [...current, vm.tab])
  }
  const mountedTabs = visitedTabs.includes(vm.tab) ? visitedTabs : [...visitedTabs, vm.tab]
  const paneClassName = (active: boolean) => (active ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden')

  return (
    <Suspense fallback={<WorkspacePaneFallback />}>
    <div className="flex min-h-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {mountedTabs.includes('search') ? (
          <div className={paneClassName(vm.tab === 'search')}>
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
        {mountedTabs.includes('organize') ? (
          <div className={paneClassName(vm.tab === 'organize')}>
            <Suspense fallback={<WorkspacePaneFallback />}>
              <OrganizeWorkspace vm={vm} />
            </Suspense>
          </div>
        ) : null}
        {mountedTabs.includes('rename') ? (
          <div className={paneClassName(vm.tab === 'rename')}>
            <Suspense fallback={<WorkspacePaneFallback />}>
              <RenameWorkspace vm={vm} />
            </Suspense>
          </div>
        ) : null}
        {mountedTabs.includes('duplicates') ? (
          <div className={paneClassName(vm.tab === 'duplicates')}>
            <Suspense fallback={<WorkspacePaneFallback />}>
              <DuplicateWorkspace vm={vm} />
            </Suspense>
          </div>
        ) : null}
        {mountedTabs.includes('merge') ? (
          <div className={paneClassName(vm.tab === 'merge')}>
            <Suspense fallback={<WorkspacePaneFallback />}>
              <MergeWorkspace vm={vm} />
            </Suspense>
          </div>
        ) : null}
        {mountedTabs.includes('jobs') ? (
          <div className={paneClassName(vm.tab === 'jobs')}>
            <Suspense fallback={<WorkspacePaneFallback />}>
              <JobsPane
                jobs={vm.jobs}
                activeScan={vm.scanning ? vm.scan : null}
                activeScanJobId={vm.scanJobId}
                libraries={vm.libraries}
                selectedJobId={vm.selectedJobId}
                loading={vm.jobsLoading}
                onRefresh={() => void vm.loadJobs().catch((err) => vm.setError(errorMessage(err)))}
                onClear={() => void vm.clearJobs()}
                onSelect={(jobId) => void vm.openJobDetails(jobId)}
                onResumeMediaMerge={(jobId) => void vm.resumeMediaMerge(jobId)}
              />
            </Suspense>
          </div>
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
    </Suspense>
  )
}

function WorkspacePaneFallback() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="正在打开页面" />
      <div role="status" aria-live="polite">正在打开页面</div>
    </div>
  )
}
