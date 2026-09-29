import type { DatabaseSync } from "node:sqlite";
import type { ChangePlan, DuplicateAnalysisProgress, ExecutionModule, JobId, PlanExecutionProgress } from "@nestify/shared";
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
import { searchEntries, type SearchCandidateEvaluation } from "../search/index.ts";
import {
  analyzeDuplicates,
  DuplicateAnalysisCancelledError,
  type RuntimeDuplicateAnalyzeResult,
} from "../duplicates/analyzer.ts";
import {
  persistDuplicateAnalysis,
  persistDuplicateAnalysisAsync,
  type DuplicateAnalysisPersistenceSummary,
} from "../duplicates/persistence.ts";
import type { ScanProgress } from "../modules/types.ts";

export async function executeRuntimePlan(input: {
  db: DatabaseSync;
  libraryId: string;
  plan: ChangePlan;
  selectedOps?: number[];
  quarantineDir: string;
  /** 直接删除处置（如回收站）；提供后 delete op 可执行。 */
  trashHandler?: (path: string) => Promise<boolean>;
  module?: ExecutionModule;
  jobId?: JobId;
  onProgress?: (progress: PlanExecutionProgress) => void;
}): Promise<PlanExecuteResult> {
  const library = getLibrary(input.db, input.libraryId);
  if (!library) throw new Error(`library not found: ${input.libraryId}`);
  if (input.plan.libraryId !== input.libraryId) throw new Error("plan does not belong to library");
  if (input.plan.status !== "draft") throw new Error("plan is not executable");
  if (input.plan.dryRun !== true) throw new Error("only preview plans can be executed");
  const result = await executePlan({
    db: input.db,
    plan: input.plan,
    library: { id: library.id, roots: library.roots },
    selectedOps: input.selectedOps,
    quarantineDir: input.quarantineDir,
    jobId: input.jobId,
    trashHandler: input.trashHandler,
    module: input.module,
    onProgress: input.onProgress,
  });
  return result;
}

export async function rollbackRuntimePlan(input: {
  db: DatabaseSync;
  jobId: string;
}): Promise<PlanRollbackResult> {
  const job = input.db
    .prepare(`SELECT library_id FROM jobs WHERE id = ?`)
    .get(input.jobId) as { library_id: string | null } | undefined;
  if (!job?.library_id) throw new Error(`job not found: ${input.jobId}`);
  return rollbackPlan(input.db, input.jobId);
}

export async function analyzeRuntimeDuplicates(input: {
  db: DatabaseSync;
  libraryId: string;
  scope?: OrganizeScope;
  entryIds?: string[];
  directory?: string;
  filter?: string;
  hashStrategy?: Exclude<HashStrategy, "off">;
  keepStrategy?: KeepStrategy;
  dispose?: "quarantine" | "delete";
  quarantineDir: string;
  jobId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: DuplicateAnalysisProgress) => void;
}): Promise<RuntimeDuplicateAnalyzeResult & { persistence: DuplicateAnalysisPersistenceSummary }> {
  const library = getLibrary(input.db, input.libraryId);
  if (!library) throw new Error(`library not found: ${input.libraryId}`);
  const allEntries = listEntries(input.db, input.libraryId);
  // 搜索表达式预过滤（如 kind:image AND size:>1MB）：匹配不到的条目不参与查重。
  const entries = input.filter?.trim()
    ? filterEntriesBySearch(allEntries, input.db, input.libraryId, input.filter.trim())
    : allEntries;
  const result = await analyzeDuplicates({
    entries,
    quarantineDir: input.quarantineDir,
    scope: input.scope,
    entryIds: input.entryIds,
    directory: input.directory,
    hashStrategy: input.hashStrategy,
    keepStrategy: input.keepStrategy ?? "newest",
    dispose: input.dispose,
    signal: input.signal,
    analysisId: input.jobId,
    onProgress: input.onProgress,
  });
  input.onProgress?.({
    status: "running",
    phase: "finalizing",
    phaseCurrent: 0,
    phaseTotal: 1,
    percent: 95,
    path: null,
    jobId: input.jobId,
  });
  if (input.signal?.aborted) throw new DuplicateAnalysisCancelledError();
  const persistence = await persistDuplicateAnalysisAsync(input.db, {
    libraryId: input.libraryId,
    result,
    analysisId: input.jobId,
    signal: input.signal,
    onProgress: (progress) => input.onProgress?.({ ...progress, jobId: input.jobId }),
  });
  return {
    ...result,
    plan: { ...result.plan, libraryId: asLibraryId(input.libraryId) },
    persistence,
  };
}

/** 用搜索语法在内存中过滤条目（复用 searchEntries 的解析与过滤，仅取 id 集）。 */
export function filterEntriesBySearch(
  entries: readonly import("@nestify/shared").Entry[],
  db: DatabaseSync,
  libraryId: string,
  filter: string,
): import("@nestify/shared").Entry[] {
  const ids = searchEntryIds(db, libraryId, filter, entries.map((entry) => entry.id));
  return entries.filter((entry) => ids.has(entry.id));
}

export function searchEntryIds(
  db: DatabaseSync,
  libraryId: string,
  filter: string,
  candidateIds?: readonly string[],
  directory?: string,
  evaluation?: SearchCandidateEvaluation,
): Set<string> {
  if (candidateIds && candidateIds.length === 0) return new Set();

  const ids = new Set<string>();
  const pageSize = 1000;
  let offset = 0;
  if (candidateIds) {
    // Keep SQLite below its bound-variable limit while forcing the rule query
    // to drive from the already-selected candidate IDs.
    const unique = [...new Set(candidateIds)];
    const chunkSize = 500;
    for (let start = 0; start < unique.length; start += chunkSize) {
      const chunk = unique.slice(start, start + chunkSize);
      const matched = searchEntries(db, {
        libraryId,
        text: filter,
        limit: chunk.length,
        offset: 0,
      scope: directory ? "directory" : "library",
      directory,
      resultMode: "hits-only",
      candidateEntryIds: chunk,
    }, evaluation);
      for (const hit of matched.hits) {
        ids.add(hit.entryId);
      }
    }
    return ids;
  }

  for (;;) {
    const matched = searchEntries(db, {
      libraryId,
      text: filter,
      limit: pageSize,
      offset,
      scope: directory ? "directory" : "library",
      directory,
      resultMode: "hits-only",
    });
    for (const hit of matched.hits) ids.add(hit.entryId);
    if (!matched.hasMore || matched.hits.length === 0) break;
    offset += matched.hits.length;
  }
  return ids;
}

export async function refreshRuntimeLibrary(
  db: DatabaseSync,
  libraryId: string,
  onProgress: (progress: ScanProgress) => void,
  concurrency: number,
): Promise<void> {
  const library = getLibrary(db, libraryId);
  if (!library) return;
  await runScan(
    db,
    { roots: library.roots, incremental: true, hashStrategy: library.hashStrategy },
    { libraryId, onProgress, concurrency },
  );
}
