import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppDialogs } from '@/components/app/AppDialogs'
import { AppFooter } from '@/components/app/AppFooter'
import { AppHeader } from '@/components/app/AppHeader'
import { LibrarySidebar } from '@/components/app/LibrarySidebar'
import { WorkspaceBody } from '@/components/app/WorkspaceBody'
import type { AppViewModel } from '@/app/types'
import type { WorkspaceTab } from '@/lib/workspace'

export function AppShell(vm: AppViewModel) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <AppHeader
        query={vm.query}
        hasLibraries={vm.hasLibraries}
        searchBusy={vm.searchBusy}
        onQuery={(value) => {
          vm.setQuery(value)
          vm.setFileViewMode('results')
        }}
        onSearch={() => {
          vm.setFileViewMode('results')
          void vm.runSearch(vm.query, vm.selectedLibraryId ?? undefined, vm.searchOffset)
        }}
        onOpenSpotlight={() => vm.setSpotlightOpen(true, 'header')}
      />

      <div className="flex min-h-0 flex-1">
        <LibrarySidebar
          libraries={vm.libraries}
          selectedLibraryId={vm.selectedLibraryId}
          selectedLibrary={vm.selectedLibrary}
          allLibrariesSelected={vm.allLibrariesSelected}
          libraryRootCount={vm.libraryRootHits.length}
          ipcReady={vm.ipcReady}
          busy={vm.busy}
          scanning={vm.scanning}
          scanPaused={vm.scanPaused}
          scanJobId={vm.scanJobId}
          removingLibrary={vm.removingLibrary}
          onSelect={vm.setSelectedLibraryId}
          onAdd={() => void vm.handleAddLibrary()}
          onEdit={() => vm.selectedLibrary && vm.setEditingLibraryId(vm.selectedLibrary.id)}
          onRemove={() => vm.selectedLibrary && void vm.handleRemoveLibrary(vm.selectedLibrary.id, vm.selectedLibrary.name)}
          onScan={() => void vm.handleScan()}
          onScanControl={(action) => void vm.handleScanControl(action)}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <Tabs value={vm.tab} onValueChange={(value) => vm.setTab(value as WorkspaceTab)}>
              <TabsList>
                <TabsTrigger value="search">文件</TabsTrigger>
                <TabsTrigger value="rules">规则</TabsTrigger>
                <TabsTrigger value="rename">改名</TabsTrigger>
                <TabsTrigger value="duplicates">重复</TabsTrigger>
                <TabsTrigger value="jobs">任务</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {vm.allLibrariesSelected
                ? `全部资料库 / ${vm.libraries.length} 个`
                : vm.selectedLibrary
                  ? vm.selectedLibrary.roots[0]
                  : '未选择资料库'}
              {vm.searchElapsed != null ? <Badge>搜索 {vm.searchElapsed}ms</Badge> : null}
            </div>
          </div>

          {vm.error ? (
            <div className="border-b p-3">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{vm.error}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          {vm.notice && !vm.error ? (
            <div className="border-b p-3">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>{vm.notice}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          <WorkspaceBody {...vm} />
        </main>
      </div>

      <AppFooter
        scan={vm.scan}
        scanPhaseLabel={vm.scanPhaseLabel}
        scanPercentDisplay={vm.scanPercentDisplay}
        scanCompleted={vm.scanCompleted}
        searchElapsed={vm.searchElapsed}
        hitTotal={vm.hitTotal}
      />

      <AppDialogs {...vm} />
    </div>
  )
}
