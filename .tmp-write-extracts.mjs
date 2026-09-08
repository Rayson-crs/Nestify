import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function read(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}
function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replaceAll("\r\n", "\n"));
  console.log("wrote", path, text.split("\n").length);
}

write("packages/core/src/app/runtime-plans.ts", `import type { DatabaseSync } from "node:sqlite";
import type { ChangePlan } from "@nestify/shared";
import { asLibraryId } from "@nestify/shared";
import {
  getLibrary,
  listEntries,
} from "../db/repos/index.ts";
import type {
  HashStrategy,
  KeepStrategy,
  OrganizeScope,
} from "../modules/types.ts";
import { executePlan, rollbackPlan, type PlanExecuteResult, type PlanRollbackResult } from "../plan/executor.ts";
import { runScan } from "../scan/indexer.ts";
import { analyzeDuplicates, type RuntimeDuplicateAnalyzeResult } from "../duplicates/analyzer.ts";
import {
  persistDuplicateAnalysis,
  type DuplicateAnalysisPersistenceSummary,
} from "../duplicates/persistence.ts";
import type { ScanProgress } from "../modules/types.ts";

export async function executeRuntimePlan(input: {
  db: DatabaseSync;
  libraryId: string;
  plan: ChangePlan;
  selectedOps?: number[];
  quarantineDir: string;
  refresh: (libraryId: string) => Promise<void>;
}): Promise<PlanExecuteResult> {
  const library = getLibrary(input.db, input.libraryId);
  if (!library) throw new Error(\`library not found: \${input.libraryId}\`);
  if (input.plan.libraryId !== input.libraryId) throw new Error("plan does not belong to library");
  if (input.plan.status !== "draft") throw new Error("plan is not executable");
  if (input.plan.dryRun !== true) throw new Error("only preview plans can be executed");
  const result = await executePlan({
    db: input.db,
    plan: input.plan,
    library: { id: library.id, roots: library.roots },
    selectedOps: input.selectedOps,
    quarantineDir: input.quarantineDir,
  });
  await input.refresh(library.id);
  return result;
}

export async function rollbackRuntimePlan(input: {
  db: DatabaseSync;
  jobId: string;
  refresh: (libraryId: string) => Promise<void>;
}): Promise<PlanRollbackResult> {
  const job = input.db
    .prepare(\`SELECT library_id FROM jobs WHERE id = ?\`)
    .get(input.jobId) as { library_id: string | null } | undefined;
  if (!job?.library_id) throw new Error(\`job not found: \${input.jobId}\`);
  const result = await rollbackPlan(input.db, input.jobId);
  await input.refresh(job.library_id);
  return result;
}

export async function analyzeRuntimeDuplicates(input: {
  db: DatabaseSync;
  libraryId: string;
  scope?: OrganizeScope;
  entryIds?: string[];
  directory?: string;
  hashStrategy?: Exclude<HashStrategy, "off">;
  keepStrategy?: KeepStrategy;
  quarantineDir: string;
}): Promise<RuntimeDuplicateAnalyzeResult & { persistence: DuplicateAnalysisPersistenceSummary }> {
  const library = getLibrary(input.db, input.libraryId);
  if (!library) throw new Error(\`library not found: \${input.libraryId}\`);
  const result = await analyzeDuplicates({
    entries: listEntries(input.db, input.libraryId),
    quarantineDir: input.quarantineDir,
    scope: input.scope,
    entryIds: input.entryIds,
    directory: input.directory,
    hashStrategy: input.hashStrategy,
    keepStrategy: input.keepStrategy ?? "newest",
  });
  const persistence = persistDuplicateAnalysis(input.db, {
    libraryId: input.libraryId,
    result,
  });
  return {
    ...result,
    plan: { ...result.plan, libraryId: asLibraryId(input.libraryId) },
    persistence,
  };
}

export async function refreshRuntimeLibrary(
  db: DatabaseSync,
  libraryId: string,
  onProgress: (progress: ScanProgress) => void,
): Promise<void> {
  const library = getLibrary(db, libraryId);
  if (!library) return;
  await runScan(
    db,
    { roots: library.roots, incremental: true, hashStrategy: library.hashStrategy },
    { libraryId, onProgress },
  );
}
`);

write("apps/desktop/src/components/files/SearchToolbar.tsx", `import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSearch,
  Folder,
  FolderOpen,
  Layers,
  Pencil,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SearchHit, SearchScope } from '@/lib/ipc'
import {
  SEARCH_KIND_OPTIONS,
  SEARCH_SCOPE_LABEL,
  type SearchKindFilter,
  type WorkspaceTab,
} from '@/lib/workspace'

export function SearchToolbar({
  selected,
  selectedIds,
  kind,
  scope,
  directory,
  offset,
  total,
  hitsLength,
  busy,
  actionsEnabled,
  actionBusy,
  canUseSelectedDirectory,
  onKind,
  onScope,
  onDirectory,
  onUseSelectedDirectory,
  onPage,
  onOpen,
  onCopyPath,
  onShowInTree,
  onSendTo,
}: {
  selected: SearchHit | null
  selectedIds: string[]
  kind: SearchKindFilter
  scope: SearchScope
  directory: string
  offset: number
  total: number
  hitsLength: number
  busy: boolean
  actionsEnabled: boolean
  actionBusy: boolean
  canUseSelectedDirectory: boolean
  onKind: (value: SearchKindFilter) => void
  onScope: (value: SearchScope) => void
  onDirectory: (value: string) => void
  onUseSelectedDirectory: () => void
  onPage: (delta: number) => void
  onOpen: (hit: SearchHit) => void
  onCopyPath: (hit: SearchHit) => void
  onShowInTree: (hit: SearchHit) => void
  onSendTo: (target: Exclude<WorkspaceTab, 'search' | 'jobs'>) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <div className="w-28">
        <Select value={kind} disabled={busy} onValueChange={(value) => onKind(value as SearchKindFilter)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEARCH_KIND_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-32">
        <Select value={scope} disabled={busy} onValueChange={(value) => onScope(value as SearchScope)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SEARCH_SCOPE_LABEL) as SearchScope[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SEARCH_SCOPE_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {scope === 'directory' ? (
        <div className="flex min-w-[16rem] flex-1 items-center gap-2">
          <Input
            value={directory}
            disabled={busy}
            onChange={(event) => onDirectory(event.target.value)}
            placeholder="D:\\\\目录"
          />
          <Button
            variant="outline"
            size="icon"
            title="使用当前选中文件所在目录"
            disabled={!canUseSelectedDirectory || busy}
            onClick={onUseSelectedDirectory}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      {scope === 'selection' ? <Badge variant="outline">已选 {selectedIds.length}</Badge> : null}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          title="打开 (Enter)"
          disabled={!actionsEnabled || !selected || actionBusy}
          onClick={() => selected && onOpen(selected)}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="复制完整路径"
          disabled={!actionsEnabled || !selected || actionBusy}
          onClick={() => selected && onCopyPath(selected)}
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="在目录结构中查看"
          disabled={!actionsEnabled || !selected}
          onClick={() => selected && onShowInTree(selected)}
        >
          <Folder className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="加入规则测试选择"
          disabled={!actionsEnabled || (!selected && selectedIds.length === 0)}
          onClick={() => onSendTo('rules')}
        >
          <FileSearch className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="加入重命名器"
          disabled={!actionsEnabled || (!selected && selectedIds.length === 0)}
          onClick={() => onSendTo('rename')}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="加入重复分析"
          disabled={!actionsEnabled || (!selected && selectedIds.length === 0)}
          onClick={() => onSendTo('duplicates')}
        >
          <Layers className="h-4 w-4" />
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="outline" size="icon" title="上一页" disabled={busy || offset === 0} onClick={() => onPage(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-24 text-center text-xs text-muted-foreground">
          {hitsLength === 0 ? \`0 / \${total}\` : \`\${offset + 1}-\${offset + hitsLength} / \${total}\`}
        </span>
        <Button
          variant="outline"
          size="icon"
          title="下一页"
          disabled={busy || offset + hitsLength >= total}
          onClick={() => onPage(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
`);
console.log("created extracted files");
