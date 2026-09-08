import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function write(path, text) {
  writeFileSync(path, text.replaceAll("\r\n", "\n"));
  console.log("wrote", path);
}

function patch(path, replacements) {
  let text = read(path);
  for (const [from, to] of replacements) {
    if (!text.includes(from)) {
      throw new Error(`missing in ${path}:\n${from.slice(0, 180)}`);
    }
    text = text.replace(from, to);
  }
  write(path, text);
}

let plans = read("apps/desktop/src/app/usePlans.ts");
if (!plans.includes("import { useRuleSetActions } from '@/app/useRuleSetActions'")) {
  plans = plans.replace(
    "import type { ConfirmationRequest } from '@/app/types'\nimport type { JobRecord } from '@nestify/shared'",
    "import type { ConfirmationRequest } from '@/app/types'\nimport { useRuleSetActions } from '@/app/useRuleSetActions'\nimport type { JobRecord } from '@nestify/shared'",
  );
}

const start = plans.indexOf("  const runRuleAction = async (");
const end = plans.indexOf("  const handleSendSelectionTo");
if (start < 0 || end < 0) {
  throw new Error(`markers not found start=${start} end=${end}`);
}
const replacement = `  const {
    handleCreateRuleSet,
    handleUpdateRuleSet,
    handleRefreshRuleSet,
    handleToggleRuleSet,
    handleRuleSetPriority,
    handleCloneRuleSet,
    handleDeleteRuleSet,
    handleExportRuleSet,
    handleImportRuleSet,
  } = useRuleSetActions({
    selectedRuleSet,
    ruleDraft,
    setError,
    setNotice,
    setRuleSets,
    setRuleActionBusy,
    loadRules,
    requestConfirmation,
  })

`;
plans = plans.slice(0, start) + replacement + plans.slice(end);
if (plans.includes("type NestifyApi") || plans.match(/\bNestifyApi\b/) && !plans.includes("useRuleSetActions")) {
  // keep import if still used
}
if (!plans.includes("NestifyApi")) {
  plans = plans.replace("  type NestifyApi,\n", "");
}
write("apps/desktop/src/app/usePlans.ts", plans);

patch("apps/desktop/src/components/files/ResizableTable.tsx", [
  [
    "import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'",
    "import { ScrollArea } from '@/components/ui/scroll-area'",
  ],
]);

patch("apps/desktop/src/components/files/FileViewTabs.tsx", [
  [
    `import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { FileViewMode } from '@/lib/workspace'

export function FileViewTabs({
  mode,
  onMode,
}: {
  mode: FileViewMode
  onMode: (mode: FileViewMode) => void
}) {
  return (
    <div className="border-b px-3 py-2">
      <Tabs value={mode} onValueChange={(value) => onMode(value as FileViewMode)}>
        <TabsList>
          <TabsTrigger value="tree">目录结构</TabsTrigger>
          <TabsTrigger value="results">搜索结果</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}`,
    `import { PanelRightClose, PanelRightOpen } from 'lucide-react'
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
}`,
  ],
]);

patch("apps/desktop/src/components/app/WorkspaceBody.tsx", [
  [
    "            <FileViewTabs mode={vm.fileViewMode} onMode={vm.setFileViewMode} />",
    `            <FileViewTabs
              mode={vm.fileViewMode}
              onMode={vm.setFileViewMode}
              inspectorOpen={vm.inspectorOpen}
              onInspectorOpenChange={vm.setInspectorOpen}
            />`,
  ],
]);

console.log("ui patches done");
