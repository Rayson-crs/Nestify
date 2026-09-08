import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { FileViewMode } from '@/lib/workspace'

export function FileViewTabs({
  mode,
  onMode,
  inspectorOpen,
  onInspectorOpenChange,
}: {
  mode: FileViewMode
  onMode: (mode: FileViewMode) => void
  inspectorOpen: boolean
  onInspectorOpenChange: (open: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between border-b px-3 py-2">
      <Tabs value={mode} onValueChange={(value) => onMode(value as FileViewMode)}>
        <TabsList>
          <TabsTrigger value="tree">目录结构</TabsTrigger>
          <TabsTrigger value="results">搜索结果</TabsTrigger>
        </TabsList>
      </Tabs>
      <Button
        variant="outline"
        size="icon"
        title={inspectorOpen ? '收起预览' : '展开预览'}
        onClick={() => onInspectorOpenChange(!inspectorOpen)}
      >
        {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
      </Button>
    </div>
  )
}
