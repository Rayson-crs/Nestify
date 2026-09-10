import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { FileViewMode } from '@/lib/workspace'

export function FileViewTabs({
  mode,
  onMode,
}: {
  mode: FileViewMode
  onMode: (mode: FileViewMode) => void
}) {
  return (
    <div className="flex items-center border-b px-3 py-2">
      <Tabs value={mode} onValueChange={(value) => onMode(value as FileViewMode)}>
        <TabsList>
          <TabsTrigger value="tree">目录结构</TabsTrigger>
          <TabsTrigger value="results">搜索结果</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}
