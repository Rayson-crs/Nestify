import type { DatabaseSync } from "node:sqlite";
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
    .prepare(`SELECT library_id FROM jobs WHERE id = ?`)
    .get(input.jobId) as { library_id: string | null } | undefined;
  if (!job?.library_id) throw new Error(`job not found: ${input.jobId}`);
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
  if (!library) throw new Error(`library not found: ${input.libraryId}`);
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
