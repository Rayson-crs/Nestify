import { Command, HardDrive, Search, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MagicWandInput } from '@/components/rules/RuleBuilderDialog'
import { Separator } from '@/components/ui/separator'

export function AppHeader({
  query,
  hasLibraries,
  onQuery,
  onOpenSpotlight,
  onOpenSettings,
}: {
  query: string
  hasLibraries: boolean
  onQuery: (value: string) => void
  onOpenSpotlight: () => void
  onOpenSettings: () => void
}) {
  return (
    <header className="flex h-12 items-center gap-3 border-b px-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <HardDrive className="h-4 w-4 text-primary" />
        Nestify
      </div>
      <Separator orientation="vertical" className="h-5" />
      <div className="min-w-0 flex-1">
        <MagicWandInput
          mode="search"
          value={query}
          onApply={onQuery}
          leadingIcon={<Search className="h-4 w-4" />}
          inputClassName="w-full pl-9 pr-10"
          placeholder="搜索文件名 / ext:mp4 / parent:下载 / kind:video"
          disabled={!hasLibraries}
        />
      </div>
      <Button variant="outline" size="icon" title="快速搜索 Ctrl+Space" onClick={onOpenSpotlight}>
        <Command className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="icon" title="搜索与运行设置" onClick={onOpenSettings}>
        <Settings className="h-4 w-4" />
      </Button>
    </header>
  )
}
