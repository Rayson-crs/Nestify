import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppDialogs } from '@/components/app/AppDialogs'
import { AppFooter } from '@/components/app/AppFooter'
import { AppHeader } from '@/components/app/AppHeader'
import { LibrarySidebar } from '@/components/app/LibrarySidebar'
import { SettingsDialog } from '@/components/app/SettingsDialog'
import { WorkspaceBody } from '@/components/app/WorkspaceBody'
import { Toast, ToastViewport } from '@/components/ui/toast'
import type { AppViewModel } from '@/app/types'
import type { WorkspaceTab } from '@/lib/workspace'
import { useState } from 'react'

export function AppShell(vm: AppViewModel) {
  const [librarySidebarCollapsed, setLibrarySidebarCollapsed] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <AppHeader
        query={vm.query}
        hasLibraries={vm.hasLibraries}
        onQuery={(value) => {
          vm.setQuery(value)
          vm.setFileViewMode('results')
        }}
        onOpenSpotlight={() => vm.setSpotlightOpen(true, 'header')}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <LibrarySidebar
          libraries={vm.libraries}
          selectedLibraryId={vm.selectedLibraryId}
          selectedLibrary={vm.selectedLibrary}
          allLibrariesSelected={vm.allLibrariesSelected}
          ipcReady={vm.ipcReady}
          busy={vm.busy}
          scanning={vm.scanning}
          scanPaused={vm.scanPaused}
          scanJobId={vm.scanJobId}
          removingLibrary={vm.removingLibrary}
          removalProgress={vm.removalProgress}
          refreshing={vm.refreshingLibraries}
          onSelect={vm.setSelectedLibraryId}
          onAdd={() => void vm.handleAddLibrary()}
          onEdit={() => vm.selectedLibrary && vm.setEditingLibraryId(vm.selectedLibrary.id)}
          onRemove={() => vm.selectedLibrary && void vm.handleRemoveLibrary(vm.selectedLibrary.id, vm.selectedLibrary.name)}
          onScan={() => void vm.handleScan()}
          onScanControl={(action) => void vm.handleScanControl(action)}
          collapsed={librarySidebarCollapsed}
          onToggleCollapsed={() => setLibrarySidebarCollapsed((current) => !current)}
          onRefresh={() => void vm.handleRefreshLibraries()}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <Tabs value={vm.tab} onValueChange={(value) => vm.setTab(value as WorkspaceTab)}>
              <TabsList>
                <TabsTrigger value="search">文件</TabsTrigger>
              <TabsTrigger value="organize">整理</TabsTrigger>
                <TabsTrigger value="rename">改名</TabsTrigger>
                <TabsTrigger value="duplicates">重复</TabsTrigger>
                <TabsTrigger value="merge">合并</TabsTrigger>
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

          <WorkspaceBody {...vm} />
        </main>
      </div>

      <AppFooter
        scan={vm.scan}
        scanPhaseLabel={vm.scanPhaseLabel}
        scanPercentDisplay={vm.scanPercentDisplay}
        scanCompleted={vm.scanCompleted}
        scanning={vm.scanning}
        executeProgress={vm.executeProgress}
        removalProgress={vm.removalProgress}
        fileOperationProgress={vm.fileOperationProgress}
        searchElapsed={vm.searchElapsed}
        hitTotal={vm.hitTotal}
      />

      <AppDialogs {...vm} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={vm.setNotice} />
      <ToastViewport>
        {vm.error ? <Toast description={vm.error} variant="destructive" onClose={() => vm.setError(null)} /> : null}
        {vm.notice && !vm.error ? <Toast description={vm.notice} onClose={() => vm.setNotice(null)} /> : null}
      </ToastViewport>
    </div>
  )
}
