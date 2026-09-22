import type { DatabaseSync } from "node:sqlite";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import type { Job, JobKind, JobOpsPage, JobRecord, JobStatus } from "@nestify/shared";
import { allOrm, getOrm, orm, runOrm } from "../orm.ts";
import { jobOps, jobs } from "../schema.ts";

type JobRow = {
  id: string;
  library_id: string | null;
  kind: string;
  status: string;
  dry_run: number;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  stats_json: string | null;
};

type JobListRow = JobRow & {
  op_total: number;
  op_ok: number;
  op_skipped: number;
  op_failed: number;
};

type JobStatusRow = Pick<JobRow, "id" | "error" | "started_at" | "finished_at" | "stats_json">;

type JobOpRow = {
  job_id: string;
  seq: number;
  op: string;
  from_path: string;
  to_path: string | null;
  rule_id: string | null;
  status: string;
  risk: string;
  reason: string;
  error: string | null;
};

export function createJob(
  db: DatabaseSync,
  job: Partial<Job> & {
    id: string
    kind: JobKind
    status: JobStatus
    dryRun?: boolean
    stats?: unknown
  },
): void {
  runOrm(
    db,
    orm().insert(jobs).values({
      id: job.id,
      libraryId: job.libraryId ?? null,
      kind: job.kind,
      status: job.status,
      dryRun: job.dryRun === false ? 0 : 1,
      startedAt: job.startedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      error: job.error ?? null,
      statsJson: job.stats === undefined ? null : JSON.stringify(job.stats),
    }),
  );
}

export function updateJobStatus(
  db: DatabaseSync,
  id: string,
  status: JobStatus,
  extra?: {
    error?: string | null;
    startedAt?: number | null;
    finishedAt?: number | null;
    stats?: unknown;
  },
): void {
  const current = getOrm<JobStatusRow>(
    db,
    orm()
      .select({
        id: jobs.id,
        error: jobs.error,
        started_at: jobs.startedAt,
        finished_at: jobs.finishedAt,
        stats_json: jobs.statsJson,
      })
      .from(jobs)
      .where(eq(jobs.id, id)),
  );
  if (!current) return;

  const statsJson =
    extra && Object.prototype.hasOwnProperty.call(extra, "stats")
      ? extra.stats === undefined
        ? null
        : JSON.stringify(extra.stats)
      : current.stats_json;

  runOrm(
    db,
    orm()
      .update(jobs)
      .set({
        status,
        error:
          extra && Object.prototype.hasOwnProperty.call(extra, "error")
            ? (extra.error ?? null)
            : current.error,
        startedAt:
          extra && Object.prototype.hasOwnProperty.call(extra, "startedAt")
            ? (extra.startedAt ?? null)
            : current.started_at,
        finishedAt:
          extra && Object.prototype.hasOwnProperty.call(extra, "finishedAt")
            ? (extra.finishedAt ?? null)
            : current.finished_at,
        statsJson,
      })
      .where(eq(jobs.id, id)),
  );
}

export function listJobs(
  db: DatabaseSync,
  input: { libraryId?: string; limit?: number } = {},
): JobRecord[] {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = allOrm<JobListRow>(
    db,
    orm()
      .select({
        id: jobs.id,
        library_id: jobs.libraryId,
        kind: jobs.kind,
        status: jobs.status,
        dry_run: jobs.dryRun,
        started_at: jobs.startedAt,
        finished_at: jobs.finishedAt,
        error: jobs.error,
        stats_json: jobs.statsJson,
        op_total: count(jobOps.id).as("op_total"),
        op_ok: sql<number>`coalesce(sum(case when ${jobOps.status} = 'ok' then 1 else 0 end), 0)`.as(
          "op_ok",
        ),
        op_skipped: sql<number>`coalesce(sum(case when ${jobOps.status} = 'skipped' then 1 else 0 end), 0)`.as(
          "op_skipped",
        ),
        op_failed: sql<number>`coalesce(sum(case when ${jobOps.status} = 'failed' then 1 else 0 end), 0)`.as(
          "op_failed",
        ),
      })
      .from(jobs)
      .leftJoin(jobOps, eq(jobOps.jobId, jobs.id))
      .where(input.libraryId ? eq(jobs.libraryId, input.libraryId) : undefined)
      .groupBy(jobs.id)
      .orderBy(
        desc(sql`coalesce(${jobs.startedAt}, ${jobs.finishedAt})`),
        desc(sql`jobs.rowid`),
      )
      .limit(limit),
  );

  return rows.map((row) => ({
    id: row.id,
    libraryId: row.library_id,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    dryRun: row.dry_run === 1,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    stats: parseStats(row.stats_json),
    opStats: {
      total: row.op_total,
      ok: row.op_ok,
      skipped: row.op_skipped,
      failed: row.op_failed,
    },
  }));
}

export function listJobOps(
  db: DatabaseSync,
  jobId: string,
  input: { offset?: number; limit?: number } = {},
): JobOpsPage {
  const limit = normalizeLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS total FROM job_ops WHERE job_id = ?`)
      .get(jobId) as { total: number }
  ).total;
  const rows = allOrm<JobOpRow>(
    db,
    orm()
      .select({
        job_id: jobOps.jobId,
        seq: jobOps.seq,
        op: jobOps.op,
        from_path: jobOps.fromPath,
        to_path: jobOps.toPath,
        rule_id: jobOps.ruleId,
        status: jobOps.status,
        risk: jobOps.risk,
        reason: jobOps.reason,
        error: jobOps.error,
      })
      .from(jobOps)
      .where(eq(jobOps.jobId, jobId))
      .orderBy(asc(jobOps.seq))
      .offset(offset)
      .limit(limit),
  );

  return {
    total,
    offset,
    limit,
    ops: rows.map((row) => ({
      jobId: row.job_id,
      seq: row.seq,
      op: row.op as JobOpsPage["ops"][number]["op"],
      from: row.from_path,
      to: row.to_path,
      ruleId: row.rule_id,
      status: row.status as JobOpsPage["ops"][number]["status"],
      risk: row.risk as JobOpsPage["ops"][number]["risk"],
      reason: row.reason,
      error: row.error,
    })),
  };
}

export function getJobById(db: DatabaseSync, id: string): JobRecord | null {
  const row = getOrm<JobListRow>(
    db,
    orm()
      .select({
        id: jobs.id,
        library_id: jobs.libraryId,
        kind: jobs.kind,
        status: jobs.status,
        dry_run: jobs.dryRun,
        started_at: jobs.startedAt,
        finished_at: jobs.finishedAt,
        error: jobs.error,
        stats_json: jobs.statsJson,
        op_total: count(jobOps.id).as("op_total"),
        op_ok: sql<number>`coalesce(sum(case when ${jobOps.status} = 'ok' then 1 else 0 end), 0)`.as(
          "op_ok",
        ),
        op_skipped: sql<number>`coalesce(sum(case when ${jobOps.status} = 'skipped' then 1 else 0 end), 0)`.as(
          "op_skipped",
        ),
        op_failed: sql<number>`coalesce(sum(case when ${jobOps.status} = 'failed' then 1 else 0 end), 0)`.as(
          "op_failed",
        ),
      })
      .from(jobs)
      .leftJoin(jobOps, eq(jobOps.jobId, jobs.id))
      .where(eq(jobs.id, id))
      .groupBy(jobs.id),
  );
  if (!row) return null;
  return {
    id: row.id,
    libraryId: row.library_id,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    dryRun: row.dry_run === 1,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    stats: parseStats(row.stats_json),
    opStats: {
      total: row.op_total,
      ok: row.op_ok,
      skipped: row.op_skipped,
      failed: row.op_failed,
    },
  };
}

export function reconcileInterruptedMediaMergeJobs(db: DatabaseSync): Array<{ id: string; error: string }> {
  const rows = allOrm<{ id: string; stats_json: string | null }>(
    db,
    orm()
      .select({ id: jobs.id, stats_json: jobs.statsJson })
      .from(jobs)
      .where(sql`${jobs.kind} = 'media-merge' and ${jobs.status} in ('running', 'cancelling')`),
  );
  const interruptedAt = Date.now();
  return rows.map((row) => {
    const stats = parseStats(row.stats_json) as
      | { progress?: Record<string, unknown>; checkpoint?: unknown }
      | null;
    const message = "应用重启时合并任务被中断；可从任务详情显式恢复。";
    const nextStats = {
      ...stats,
      progress: {
        ...(stats?.progress ?? {}),
        status: "failed",
        phase: "finalizing",
        error: message,
        resumeSupported: true,
      },
      interruptedAt,
    };
    runOrm(
      db,
      orm()
        .update(jobs)
        .set({
          status: "failed",
          error: message,
          finishedAt: interruptedAt,
          statsJson: JSON.stringify(nextStats),
        })
        .where(eq(jobs.id, row.id)),
    );
    return { id: row.id, error: message };
  });
}

function normalizeLimit(value: number | undefined): number {
  const limit = value != null && Number.isFinite(value) ? Math.trunc(value) : 100;
  return Math.min(Math.max(limit, 1), 200);
}

function normalizeOffset(value: number | undefined): number {
  const offset = value != null && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(offset, 0);
}

function parseStats(value: string | null): unknown {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
