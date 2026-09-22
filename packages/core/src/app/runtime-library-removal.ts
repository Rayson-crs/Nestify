import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Job, JobId, Library, LibraryRemovalProgress } from "@nestify/shared";
import { asJobId } from "@nestify/shared";
import { createJob, updateJobStatus } from "../db/repos/jobs.ts";
import { getLibrary } from "../db/repos/index.ts";
import { isActiveScan } from "./runtime-helpers.ts";

export function startRuntimeLibraryRemoval(input: {
  db: DatabaseSync;
  libraryId: string;
  activeScan: { jobId: JobId; libraryId: string; status: Job["status"] } | null;
  beforeDelete?: (report: (stage: string, current: number) => void) => Promise<void>;
  removeData?: (report: (stage: string, current: number) => void) => Promise<void>;
  afterDelete?: (report: (stage: string, current: number) => void) => Promise<void>;
  onProgress?: (progress: LibraryRemovalProgress) => void;
}): { jobId: string; completion: Promise<void> } {
  const library = getLibrary(input.db, input.libraryId);
  if (!library) throw new Error(`library not found: ${input.libraryId}`);
  if (input.activeScan?.libraryId === input.libraryId && isActiveScan(input.activeScan)) {
    throw new Error("cannot remove a library while its scan is active");
  }

  const jobId = asJobId(randomUUID());
  const total = 100;
  const emit = (
    status: LibraryRemovalProgress["status"],
    current: number,
    stage: string,
    error: string | null = null,
  ) => {
    input.onProgress?.(removalProgress(jobId, library, status, current, total, stage, error));
  };

  createJob(input.db, {
    id: jobId,
    libraryId: library.id,
    kind: "library-remove",
    status: "running",
    startedAt: Date.now(),
    dryRun: false,
  });
  emit("running", 0, "准备移除资料库");

  const completion = (async () => {
    try {
      await input.beforeDelete?.((stage, current) => emit("running", current, stage));
      if (input.removeData) {
        await input.removeData((stage, current) => emit("running", current, stage));
      } else {
        throw new Error("library removal worker is unavailable");
      }
      await input.afterDelete?.((stage, current) => emit("running", current, stage));
      updateJobStatus(input.db, jobId, "completed", {
        finishedAt: Date.now(),
        stats: {
          total,
          current: total,
          stages: ["停止缩略图", "停止目录监听", "删除索引", "清理缓存"],
        },
      });
      emit("completed", total, "资料库已移除");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateJobStatus(input.db, jobId, "failed", {
        finishedAt: Date.now(),
        error: message,
      });
      emit("failed", 0, "移除失败", message);
      throw error;
    }
  })();
  return { jobId, completion };
}

function removalProgress(
  jobId: JobId,
  library: Library,
  status: LibraryRemovalProgress["status"],
  current: number,
  total: number,
  stage: string,
  error: string | null,
): LibraryRemovalProgress {
  return {
    jobId,
    libraryId: library.id,
    libraryName: library.name,
    status,
    current,
    total,
    stage,
    error,
  };
}
