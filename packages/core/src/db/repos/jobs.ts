import type { DatabaseSync } from "node:sqlite";
import type { Job, JobKind, JobOpRecord, JobRecord, JobStatus } from "@nestify/shared";

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
  job: Partial<Job> & { id: string; kind: JobKind; status: JobStatus; dryRun?: boolean },
): void {
  db.prepare(
    `INSERT INTO jobs(
      id, library_id, kind, status, dry_run, started_at, finished_at, error, stats_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.libraryId ?? null,
    job.kind,
    job.status,
    job.dryRun === false ? 0 : 1,
    job.startedAt ?? null,
    job.finishedAt ?? null,
    job.error ?? null,
    null,
  );
}

export function updateJobStatus(
  db: DatabaseSync,
  id: string,
  status: JobStatus,
  extra?: { error?: string; startedAt?: number; finishedAt?: number; stats?: unknown },
): void {
  const current = db
    .prepare(`SELECT id, error, started_at, finished_at, stats_json FROM jobs WHERE id = ?`)
    .get(id) as JobRow | undefined;
  if (!current) return;

  const statsJson =
    extra && Object.prototype.hasOwnProperty.call(extra, "stats")
      ? extra.stats === undefined
        ? null
        : JSON.stringify(extra.stats)
      : current.stats_json;

  db.prepare(
    `UPDATE jobs
     SET status = ?, error = ?, started_at = ?, finished_at = ?, stats_json = ?
     WHERE id = ?`,
  ).run(
    status,
    extra && Object.prototype.hasOwnProperty.call(extra, "error") ? (extra.error ?? null) : current.error,
    extra && Object.prototype.hasOwnProperty.call(extra, "startedAt")
      ? (extra.startedAt ?? null)
      : current.started_at,
    extra && Object.prototype.hasOwnProperty.call(extra, "finishedAt")
      ? (extra.finishedAt ?? null)
      : current.finished_at,
    statsJson,
    id,
  );
}

export function listJobs(
  db: DatabaseSync,
  input: { libraryId?: string; limit?: number } = {},
): JobRecord[] {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const where = input.libraryId ? "WHERE j.library_id = ?" : "";
  const statement = db.prepare(
    `SELECT
       j.id,
       j.library_id,
       j.kind,
       j.status,
       j.dry_run,
       j.started_at,
       j.finished_at,
       j.error,
       j.stats_json,
       COUNT(o.id) AS op_total,
       COALESCE(SUM(CASE WHEN o.status = 'ok' THEN 1 ELSE 0 END), 0) AS op_ok,
       COALESCE(SUM(CASE WHEN o.status = 'skipped' THEN 1 ELSE 0 END), 0) AS op_skipped,
       COALESCE(SUM(CASE WHEN o.status = 'failed' THEN 1 ELSE 0 END), 0) AS op_failed
     FROM jobs j
     LEFT JOIN job_ops o ON o.job_id = j.id
     ${where}
     GROUP BY j.id
     ORDER BY COALESCE(j.started_at, j.finished_at) DESC, j.rowid DESC
     LIMIT ?`,
  );
  const rows = (
    input.libraryId
      ? statement.all(input.libraryId, limit)
      : statement.all(limit)
  ) as JobListRow[];

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

export function listJobOps(db: DatabaseSync, jobId: string): JobOpRecord[] {
  const rows = db
    .prepare(
      `SELECT job_id, seq, op, from_path, to_path, rule_id, status, risk, reason, error
       FROM job_ops
       WHERE job_id = ?
       ORDER BY seq`,
    )
    .all(jobId) as JobOpRow[];

  return rows.map((row) => ({
    jobId: row.job_id,
    seq: row.seq,
    op: row.op as JobOpRecord["op"],
    from: row.from_path,
    to: row.to_path,
    ruleId: row.rule_id,
    status: row.status as JobOpRecord["status"],
    risk: row.risk as JobOpRecord["risk"],
    reason: row.reason,
    error: row.error,
  }));
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
