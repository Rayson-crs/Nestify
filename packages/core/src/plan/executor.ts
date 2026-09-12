import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { DatabaseSync } from "node:sqlite";
import type { ChangePlan, ExecutionModule, JobId, LibraryId, PlanExecutionProgress, PlanOp } from "@nestify/shared";
import { asJobId } from "@nestify/shared";
import { createJob, updateJobStatus } from "../db/repos/jobs.ts";
import {
  fileNameOf,
  isAbsolutePath,
  isIllegalName,
  normalizeKey,
  parentPathOf,
  splitStemExt,
} from "./paths.ts";
import { validatePlan } from "./validator.ts";

export interface PlanExecuteInput {
  db: DatabaseSync;
  plan: ChangePlan;
  library: { id: LibraryId; roots: string[] };
  selectedOps?: number[];
  quarantineDir: string;
  protectedPaths?: string[];
  /**
   * delete 操作的处置函数（默认禁用）。宿主可注入"移入系统回收站"等实现；
   * 返回 true 表示已处置。注入后 delete op 不再抛错。
   */
  trashHandler?: (path: string) => Promise<boolean>;
  module?: ExecutionModule;
  onProgress?: (progress: PlanExecutionProgress) => void;
}

export interface PlanExecuteResult {
  jobId: string;
  status: "completed" | "failed";
  total: number;
  ok: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface PlanRollbackResult {
  jobId: string;
  status: "completed" | "failed";
  ok: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface ExecuteCtx {
  db: DatabaseSync;
  libraryRoots: string[];
  quarantineDir: string;
  protectedPaths: string[];
  trashHandler?: (path: string) => Promise<boolean>;
}

export async function executePlan(input: PlanExecuteInput): Promise<PlanExecuteResult> {
  const db = input.db;
  const selection = new Set(input.selectedOps ?? []);
  const ops = input.plan.ops
    .map((op, index) => ({ op, index }))
    .filter(({ op, index }) => (input.selectedOps ? selection.has(index) : op.selected))
    .filter(({ op }) => op.to != null || op.op === "mkdir" || op.op === "flatten" || op.op === "delete")
    .map(({ op }) => op);
  const jobId = asJobId(randomUUID());
  const ctx: ExecuteCtx = {
    db,
    libraryRoots: input.library.roots,
    quarantineDir: input.quarantineDir,
    protectedPaths: [...defaultProtectedPaths(), ...(input.protectedPaths ?? [])],
    trashHandler: input.trashHandler,
  };
  const errors: string[] = [];
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const validationIssues = await validatePlan({
    ...input,
    allowDelete: Boolean(input.trashHandler),
  });

  createJob(db, {
    id: jobId,
    libraryId: input.library.id,
    kind: "plan-execute",
    status: "running",
    startedAt: Date.now(),
    dryRun: false,
  });
  const emitProgress = (status: PlanExecutionProgress['status'], current: number, path: string | null = null) => {
    input.onProgress?.({ module: input.module ?? 'rules', status, current, total: ops.length, ok, skipped, failed, path });
  };
  emitProgress('running', 0);

  try {
    if (validationIssues.length > 0) {
      const messages = validationIssues.map(
        (issue) => `${issue.opIndex != null ? `op ${issue.opIndex}: ` : ""}${issue.message}`,
      );
      failed = ops.length;
      updateJobStatus(db, jobId, "failed", {
        finishedAt: Date.now(),
        error: messages[0] ?? "plan validation failed",
        stats: { total: ops.length, ok, skipped, failed },
      });
      emitProgress('failed', 0);
      return { jobId, status: "failed", total: ops.length, ok, skipped, failed, errors: messages };
    }

    await mkdir(input.quarantineDir, { recursive: true });
    for (let seq = 0; seq < ops.length; seq += 1) {
      const op = ops[seq]!;
      try {
        const status = await executeOp(op, ctx);
        if (status === "skipped") skipped += 1;
        else ok += 1;
        insertJobOp(db, jobId, seq, op, status);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${op.from}: ${message}`);
        insertJobOp(db, jobId, seq, op, "failed", message);
      }
      emitProgress('running', seq + 1, op.to ?? op.from);
    }

    const status = failed > 0 ? "failed" : "completed";
    updateJobStatus(db, jobId, status, {
      finishedAt: Date.now(),
      stats: { total: ops.length, ok, skipped, failed },
    });
    emitProgress(status === 'completed' ? 'completed' : 'failed', ops.length, null);
    return { jobId, status, total: ops.length, ok, skipped, failed, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateJobStatus(db, jobId, "failed", { finishedAt: Date.now(), error: message });
    emitProgress('failed', ops.length, null);
    return {
      jobId,
      status: "failed",
      total: ops.length,
      ok,
      skipped,
      failed,
      errors: [...errors, message],
    };
  }
}

export async function rollbackPlan(db: DatabaseSync, jobId: string): Promise<PlanRollbackResult> {
  const rows = db
    .prepare(
      `SELECT seq, op, from_path, to_path
       FROM job_ops
       WHERE job_id = ? AND status = 'ok'
       ORDER BY seq DESC`,
    )
    .all(jobId) as Array<{ seq: number; op: string; from_path: string; to_path: string | null }>;
  const rollbackJobId = asJobId(randomUUID());
  createJob(db, {
    id: rollbackJobId,
    kind: "plan-rollback",
    status: "running",
    startedAt: Date.now(),
    dryRun: false,
  });

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const row of rows) {
    try {
      if (row.op === "mkdir" || row.op === "flatten") {
        if (!existsSync(row.from_path)) skipped += 1;
        else if ((await readdir(row.from_path)).length > 0) skipped += 1;
        else {
          await rm(row.from_path, { recursive: false, force: false });
          ok += 1;
        }
        continue;
      }

      if (!row.to_path || !existsSync(row.to_path) || existsSync(row.from_path)) {
        skipped += 1;
        continue;
      }
      await mkdir(dirname(row.from_path), { recursive: true });
      await relocateOnDisk(row.to_path, row.from_path);
      restorePrimaryEntryByPath(db, row.to_path, row.from_path);
      updateEntryPathForPrefix(db, row.to_path, row.from_path);
      ok += 1;
    } catch (error) {
      failed += 1;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const status = failed > 0 ? "failed" : "completed";
  updateJobStatus(db, rollbackJobId, status, {
    finishedAt: Date.now(),
    stats: { ok, skipped, failed },
  });
  return { jobId: rollbackJobId, status, ok, skipped, failed, errors };
}

async function executeOp(op: PlanOp, ctx: ExecuteCtx): Promise<"ok" | "skipped"> {
  if (op.risk === "overwrite" || op.risk === "illegal_name") return "skipped";
  if (op.op === "delete") {
    if (!ctx.trashHandler) throw new Error("delete is disabled; use quarantine");
    if (!existsSync(op.from)) return "skipped";
    const trashed = await ctx.trashHandler(op.from);
    if (!trashed) return "skipped";
    if (op.entryId) {
      tombstoneIndexedEntry(ctx.db, op.entryId);
    }
    return "ok";
  }
  if (op.op === "mkdir") {
    validateMkdir(op, ctx);
    await mkdir(op.from, { recursive: true });
    return "ok";
  }
  if (!op.to) return "skipped";
  validateRelocate(op, ctx);

  if (op.op === "flatten") {
    if (!existsSync(op.from)) return "skipped";
    if ((await readdir(op.from)).length > 0) return "skipped";
    await rm(op.from, { recursive: false, force: false });
    if (op.entryId) {
      tombstoneIndexedEntry(ctx.db, op.entryId);
    }
    return "ok";
  }

  if (!existsSync(op.from)) return "skipped";
  if (existsSync(op.to)) {
    if (op.risk === "occupied") return "skipped";
    throw new Error("target already exists");
  }
  await mkdir(dirname(op.to), { recursive: true });
  await relocateOnDisk(op.from, op.to);
  if (op.entryId) updatePrimaryEntry(ctx, op);
  updateEntryPathForPrefix(ctx.db, op.from, op.to);
  return "ok";
}

export async function relocateOnDisk(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EPERM") throw error;
    const source = await stat(from);
    if (source.isDirectory()) {
      const copiedFiles = await copyDirWithFiles(from, to);
      await assertCopiedFilesMatch(copiedFiles);
      await rm(from, { recursive: true, force: true });
    } else {
      await copyFile(from, to);
      await assertCopiedFilesMatch([[from, to]]);
      await rm(from, { force: true });
    }
  }
}

async function copyDirWithFiles(from: string, to: string): Promise<Array<[string, string]>> {
  await mkdir(to, { recursive: true });
  const copiedFiles: Array<[string, string]> = [];
  for (const item of await readdir(from, { withFileTypes: true })) {
    const source = joinPathForCopy(from, item.name);
    const target = joinPathForCopy(to, item.name);
    if (item.isDirectory()) copiedFiles.push(...(await copyDirWithFiles(source, target)));
    else {
      await copyFile(source, target);
      copiedFiles.push([source, target]);
    }
  }
  return copiedFiles;
}

async function assertCopiedFilesMatch(files: ReadonlyArray<readonly [string, string]>): Promise<void> {
  for (const [source, target] of files) {
    const sourceSize = (await stat(source)).size;
    const targetSize = (await stat(target)).size;
    if (sourceSize !== targetSize) throw new Error("cross-device copy size mismatch");
    if ((await hashFile(source)) !== (await hashFile(target))) {
      throw new Error("cross-device copy checksum mismatch");
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

function validateRelocate(op: PlanOp, ctx: ExecuteCtx): void {
  const targetName = fileNameOf(op.to ?? "");
  if (!isAbsolutePath(op.from) || !isAbsolutePath(op.to ?? "") || isIllegalName(targetName)) {
    throw new Error("invalid path in plan");
  }
  assertNotProtected(op.from, ctx.protectedPaths);
  assertNotProtected(op.to ?? "", ctx.protectedPaths);
  const quarantined = isUnder(op.to ?? "", ctx.quarantineDir);
  if (!quarantined && !isUnderAny(op.from, ctx.libraryRoots)) throw new Error("source is outside library");
  if (!quarantined && !isUnderAny(op.to ?? "", ctx.libraryRoots)) throw new Error("destination is outside library");
}

function validateMkdir(op: PlanOp, ctx: ExecuteCtx): void {
  if (!isAbsolutePath(op.from)) throw new Error("invalid path in plan");
  assertNotProtected(op.from, ctx.protectedPaths);
  if (!isUnderAny(op.from, ctx.libraryRoots)) throw new Error("destination is outside library");
}

function assertNotProtected(path: string, protectedPaths: ReadonlySet<string> | readonly string[]): void {
  for (const protectedPath of protectedPaths) {
    if (isProtected(path, protectedPath)) throw new Error(`protected path: ${protectedPath}`);
  }
}

function isUnder(path: string, root: string): boolean {
  if (!root) return false;
  const value = normalizeKey(path);
  const base = normalizeKey(root);
  return value === base || value.startsWith(`${base}/`);
}

function isUnderAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => isUnder(path, root));
}

function isProtected(path: string, protectedPath: string): boolean {
  const value = normalizeKey(path);
  const base = normalizeKey(protectedPath);
  if (!base) return false;
  if (/^[a-z]:$/.test(base) || base === "/") return value === base;
  return value === base || value.startsWith(`${base}/`);
}

function defaultProtectedPaths(): string[] {
  if (process.platform === "win32") {
    return [
      process.env.SystemRoot,
      process.env.windir,
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramData,
      process.env.SYSTEMDRIVE,
    ].filter((value): value is string => Boolean(value));
  }
  return ["/", "/bin", "/etc", "/sbin", "/usr", "/var"];
}

function updatePrimaryEntry(ctx: ExecuteCtx, op: PlanOp): void {
  const entryId = op.entryId;
  if (!op.to || !entryId) return;
  const name = fileNameOf(op.to);
  const row = ctx.db
    .prepare(`SELECT is_dir, rel_path FROM entries WHERE id = ?`)
    .get(entryId) as { is_dir: number; rel_path: string } | undefined;
  if (!row) return;
  const { stem, ext } = splitStemExt(name, row.is_dir === 1);
  const sourceRoot = ctx.libraryRoots.find((root) => isUnder(op.from, root));
  const relPath = sourceRoot
    ? replacePrefixPath(row.rel_path, op.from, op.to)
    : row.rel_path;
  ctx.db
    .prepare(
      `UPDATE entries
       SET name = ?, stem = ?, ext = ?, path = ?, parent_path = ?, rel_path = ?, indexed_at = ?
       WHERE id = ?`,
    )
    .run(name, stem, ext, op.to, parentPathOf(op.to), relPath, Date.now(), entryId);
}

function restorePrimaryEntryByPath(db: DatabaseSync, from: string, to: string): void {
  const row = db
    .prepare(`SELECT id, is_dir, rel_path FROM entries WHERE path = ?`)
    .get(from) as { id: string; is_dir: number; rel_path: string } | undefined;
  if (!row) return;
  const name = fileNameOf(to);
  const { stem, ext } = splitStemExt(name, row.is_dir === 1);
  const relPath = replacePrefixPath(row.rel_path, from, to);
  db.prepare(
    `UPDATE entries
     SET name = ?, stem = ?, ext = ?, path = ?, parent_path = ?, rel_path = ?, indexed_at = ?
     WHERE id = ?`,
  ).run(name, stem, ext, to, parentPathOf(to), relPath, Date.now(), row.id);
}

function updateEntryPathForPrefix(db: DatabaseSync, from: string, to: string): void {
  const rows = db
    .prepare(`SELECT id, path, parent_path, rel_path FROM entries ORDER BY depth DESC`)
    .all() as Array<{ id: string; path: string; parent_path: string | null; rel_path: string }>;
  for (const row of rows) {
    if (!isUnder(row.path, from) || normalizeKey(row.path) === normalizeKey(from)) continue;
    const path = replacePrefixPath(row.path, from, to);
    const parentPath = row.parent_path ? replacePrefixPath(row.parent_path, from, to) : null;
    const relPath = replacePrefixPath(row.rel_path, from, to);
    db.prepare(`UPDATE entries SET path = ?, parent_path = ?, rel_path = ?, indexed_at = ? WHERE id = ?`)
      .run(path, parentPath, relPath, Date.now(), row.id);
  }
}

function replacePrefixPath(path: string, from: string, to: string): string {
  const value = normalizeKey(path);
  const base = normalizeKey(from);
  if (!value.startsWith(`${base}/`)) return path;
  const sep = to.includes("\\") ? "\\" : "/";
  return `${to.replace(/[\\/]+$/, "")}${sep}${value.slice(base.length + 1).replaceAll("/", sep)}`;
}

function tombstoneIndexedEntry(db: DatabaseSync, entryId: string): void {
  const now = Date.now();
  db.prepare(`UPDATE entries SET tombstone = 1, indexed_at = ? WHERE id = ?`).run(now, entryId);
  db.prepare(`UPDATE library_entries SET tombstone = 1 WHERE entry_id = ?`).run(entryId);
}

function insertJobOp(
  db: DatabaseSync,
  jobId: JobId,
  seq: number,
  op: PlanOp,
  status: "ok" | "skipped" | "failed",
  error?: string,
): void {
  db.prepare(
    `INSERT INTO job_ops(
      id, job_id, seq, op, from_path, to_path, rule_id, status, risk, reason, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `${jobId}:${seq}`,
    jobId,
    seq,
    op.op,
    op.from,
    op.to,
    op.ruleId,
    status,
    op.risk,
    op.reason,
    error ?? null,
  );
}

function joinPathForCopy(base: string, child: string): string {
  return `${base.replace(/[\\/]+$/, "")}\\${child}`;
}
