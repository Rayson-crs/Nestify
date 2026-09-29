import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ChangePlan, Entry, PlanOp } from "@nestify/shared";
import { asLibraryId, asPlanId, asRuleId } from "@nestify/shared";
import { resolveCollision } from "../plan/collision.ts";
import { getJobById } from "../db/repos/index.ts";
import type { KeepStrategy } from "../modules/types.ts";
import type { RuntimeDuplicateGroup, RuntimeDuplicateHit } from "./analyzer.ts";

export interface StoredDuplicateGroup extends RuntimeDuplicateGroup {
  fileCount: number;
  selectedCount: number;
  representativeName: string;
  files: [];
}

export interface DuplicateResultPage {
  jobId: string;
  libraryId: string;
  groups: StoredDuplicateGroup[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  fileCount: number;
  wastedBytes: number;
  selectedCount: number;
  selectedBytes: number;
}

export interface DuplicateFilesPage {
  jobId: string;
  libraryId: string;
  groupId: string | null;
  files: Array<RuntimeDuplicateHit & { groupId: string }>;
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  selectedCount: number;
  selectedBytes: number;
  plan: ChangePlan;
}

export interface DuplicateKeepUpdateResult {
  selectedCount: number;
  selectedBytes: number;
}

type GroupSummaryRow = {
  id: string;
  hash_full: string | null;
  size: number | null;
  wasted_bytes: number | null;
  file_count: number | null;
  status: string;
  selected_count: number;
  representative_name: string | null;
};

type FileSelectionRow = { selected: number; selected_bytes: number };

type FileRow = {
  group_id: string;
  group_status: string;
  entry_id: string;
  name: string;
  path: string;
  kind: string;
  size: number;
  mtime: number | null;
  keep: number;
  is_dir: number;
};

export function listDuplicateResultPage(
  db: DatabaseSync,
  input: { jobId: string; offset?: number; limit?: number; kind?: string },
): DuplicateResultPage {
  const job = requireCompletedDuplicateJob(db, input.jobId);
  const offset = normalizeOffset(input.offset);
  const limit = normalizeLimit(input.limit, 100, 1);
  const kind = normalizeKind(input.kind);
  const args = [job.libraryId ?? "", input.jobId];
  const kindFilter = kind ? " AND e.kind = ?" : "";
  if (kind) args.push(kind);

  if (!kind) {
    const totals = db.prepare(`
      SELECT COUNT(*) AS groups,
             COALESCE(SUM(file_count), 0) AS files,
             COALESCE(SUM(wasted_bytes), 0) AS wasted
      FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
      WHERE g.library_id = ? AND g.analysis_id = ? AND g.status IN ('open', 'candidate')
    `).get(...args) as { groups: number; files: number; wasted: number };
    const selection = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN m.keep = 0 THEN 1 ELSE 0 END), 0) AS selected,
             COALESCE(SUM(CASE WHEN m.keep = 0 THEN COALESCE(g.size, 0) ELSE 0 END), 0) AS selected_bytes
      FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
      JOIN dup_members m ON m.group_id = g.id
      WHERE g.library_id = ? AND g.analysis_id = ? AND g.status IN ('open', 'candidate')
    `).get(...args) as FileSelectionRow;
    const rows = db.prepare(`
      SELECT *
      FROM (
        SELECT id, hash_full, size, wasted_bytes, file_count, status
        FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
        WHERE g.library_id = ? AND g.analysis_id = ? AND g.status IN ('open', 'candidate')
        ORDER BY COALESCE(g.wasted_bytes, 0) DESC, COALESCE(g.size, 0) DESC, g.id
        LIMIT ? OFFSET ?
      ) g
    `).all(...args, limit + 1, offset) as Array<Omit<GroupSummaryRow, "selected_count" | "representative_name">>;

    return {
      jobId: input.jobId,
      libraryId: job.libraryId ?? "",
      groups: rows.slice(0, limit).map((row) => {
        const selectedRow = db.prepare(
          `SELECT COUNT(*) AS count FROM dup_members WHERE group_id = ? AND keep = 0`,
        ).get(row.id) as { count: number } | undefined;
        const selectedCount = Number(selectedRow?.count ?? 0);
        const representative = db.prepare(`
          SELECT entries.name
          FROM dup_members
          JOIN entries ON entries.id = dup_members.entry_id
          WHERE dup_members.group_id = ?
          ORDER BY entries.path
          LIMIT 1
        `).get(row.id) as { name: string } | undefined;
        return {
          id: row.id,
          status: row.status === "candidate" ? "candidate" : "confirmed",
          hash: row.hash_full ?? "",
          size: row.size ?? 0,
          wastedBytes: row.wasted_bytes ?? 0,
          fileCount: row.file_count ?? 0,
          selectedCount,
          representativeName: representative?.name ?? "",
          files: [],
        };
      }),
      offset,
      limit,
      total: Number(totals.groups ?? 0),
      hasMore: rows.length > limit,
      fileCount: Number(totals.files ?? 0),
      wastedBytes: Number(totals.wasted ?? 0),
      selectedCount: Number(selection.selected ?? 0),
      selectedBytes: Number(selection.selected_bytes ?? 0),
    };
  }

  const totals = db.prepare(`
    SELECT COUNT(DISTINCT g.id) AS groups,
           COUNT(m.entry_id) AS files,
           COALESCE(SUM(CASE WHEN m.keep = 0 THEN e.size ELSE 0 END), 0) AS wasted,
           COALESCE(SUM(CASE WHEN m.keep = 0 THEN 1 ELSE 0 END), 0) AS selected
    FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE g.library_id = ? AND g.analysis_id = ? AND g.status IN ('open', 'candidate')${kindFilter}
  `).get(...args) as { groups: number; files: number; wasted: number; selected: number };
  const rows = db.prepare(`
    SELECT g.id, g.hash_full, g.size, g.wasted_bytes, g.file_count, g.status,
           SUM(CASE WHEN m.keep = 0 THEN 1 ELSE 0 END) AS selected_count,
           (
             SELECT representative_entry.name
             FROM dup_members representative
             JOIN entries representative_entry ON representative_entry.id = representative.entry_id
             WHERE representative.group_id = g.id
             ORDER BY representative_entry.path
             LIMIT 1
           ) AS representative_name
    FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE g.library_id = ? AND g.analysis_id = ? AND g.status IN ('open', 'candidate')${kindFilter}
    GROUP BY g.id
    ORDER BY COALESCE(g.wasted_bytes, 0) DESC, COALESCE(g.size, 0) DESC, g.id
    LIMIT ? OFFSET ?
  `).all(...args, limit + 1, offset) as GroupSummaryRow[];

  return {
    jobId: input.jobId,
    libraryId: job.libraryId ?? "",
    groups: rows.slice(0, limit).map((row) => ({
      id: row.id,
      status: row.status === "candidate" ? "candidate" : "confirmed",
      hash: row.hash_full ?? "",
      size: row.size ?? 0,
      wastedBytes: row.wasted_bytes ?? 0,
      fileCount: row.file_count ?? 0,
      selectedCount: Number(row.selected_count ?? 0),
      representativeName: row.representative_name ?? "",
      files: [],
    })),
    offset,
    limit,
    total: Number(totals.groups ?? 0),
    hasMore: rows.length > limit,
    fileCount: Number(totals.files ?? 0),
    wastedBytes: Number(totals.wasted ?? 0),
    selectedCount: Number(totals.selected ?? 0),
    selectedBytes: Number(totals.wasted ?? 0),
  };
}

export function listDuplicateFilesPage(
  db: DatabaseSync,
  input: { jobId: string; quarantineDir: string; groupId?: string | null; offset?: number; limit?: number; kind?: string },
): DuplicateFilesPage {
  const job = requireCompletedDuplicateJob(db, input.jobId);
  const offset = normalizeOffset(input.offset);
  const limit = normalizeLimit(input.limit, 200, 1);
  const kind = normalizeKind(input.kind);
  const groupId = typeof input.groupId === "string" && input.groupId ? input.groupId : null;
  const baseArgs = [job.libraryId ?? "", input.jobId];
  const filters = [
    "g.library_id = ?",
    "g.analysis_id = ?",
    "g.status IN ('open', 'candidate')",
    "le.tombstone = 0",
  ];
  if (groupId) {
    filters.push("g.id = ?");
    baseArgs.push(groupId);
  }
  if (kind) {
    filters.push("e.kind = ?");
    baseArgs.push(kind);
  }
  const where = filters.join(" AND ");
  const groupWhere = filters.filter((filter) => filter !== "le.tombstone = 0").join(" AND ");
  if (!kind) {
    const summary = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(g.file_count, 0)), 0) AS total,
             COALESCE(SUM(CASE WHEN COALESCE(g.file_count, 0) > 1
                               THEN COALESCE(g.file_count, 0) - 1 ELSE 0 END), 0) AS selected,
             COALESCE(SUM(COALESCE(g.wasted_bytes, 0)), 0) AS selected_bytes
      FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
      WHERE ${groupWhere}
    `).get(...baseArgs) as { total: number; selected: number; selected_bytes: number };
    const rows = db.prepare(`
      WITH ranked_groups AS (
        SELECT g.id, g.status AS group_status,
               COALESCE(g.file_count, 0) AS file_count,
               ROW_NUMBER() OVER (
                 ORDER BY COALESCE(g.wasted_bytes, 0) DESC, COALESCE(g.size, 0) DESC, g.id
               ) AS group_order,
               SUM(COALESCE(g.file_count, 0)) OVER (
                 ORDER BY COALESCE(g.wasted_bytes, 0) DESC, COALESCE(g.size, 0) DESC, g.id
                 ROWS UNBOUNDED PRECEDING
               ) AS end_sequence
        FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
        WHERE ${groupWhere}
      ),
      candidate_groups AS (
        SELECT id, group_status, group_order, end_sequence - file_count AS start_sequence
        FROM ranked_groups
        WHERE end_sequence > ? AND end_sequence - file_count < ?
      ),
      sequenced_files AS (
        SELECT cg.group_order, cg.start_sequence,
               g.id AS group_id, g.status AS group_status, e.id AS entry_id,
               e.name, e.path, e.kind, e.size, e.mtime, m.keep, e.is_dir,
               cg.start_sequence + ROW_NUMBER() OVER (
                 PARTITION BY g.id ORDER BY e.path
               ) - 1 AS sequence
        FROM candidate_groups cg
        CROSS JOIN dup_groups g ON g.id = cg.id
        CROSS JOIN dup_members m ON m.group_id = g.id
        CROSS JOIN entries e ON e.id = m.entry_id
        CROSS JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
        WHERE le.tombstone = 0
      )
      SELECT group_id, group_status, entry_id, name, path, kind, size, mtime, keep, is_dir
      FROM sequenced_files
      WHERE sequence >= ? AND sequence < ?
      ORDER BY sequence
    `).all(...baseArgs, offset, offset + limit, offset, offset + limit) as FileRow[];
    const page = rows.slice(0, limit);
    const files = page.map(mapFile);

    return {
      jobId: input.jobId,
      libraryId: job.libraryId ?? "",
      groupId,
      files,
      offset,
      limit,
      total: Number(summary.total ?? 0),
      hasMore: Number(summary.total ?? 0) > offset + page.length,
      selectedCount: Number(summary.selected ?? 0),
      selectedBytes: Number(summary.selected_bytes ?? 0),
      plan: buildStoredDuplicatePlan(files, page, job.libraryId ?? "", input.quarantineDir),
    };
  }

  const total = Number((db.prepare(`
    SELECT COUNT(*) AS total
    FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE ${where}
  `).get(...baseArgs) as { total: number }).total);
  const selection = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN m.keep = 0 THEN 1 ELSE 0 END), 0) AS selected,
           COALESCE(SUM(CASE WHEN m.keep = 0 THEN e.size ELSE 0 END), 0) AS selected_bytes
    FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE ${where}
  `).get(...baseArgs) as FileSelectionRow;
  const rows = db.prepare(`
    SELECT g.id AS group_id, g.status AS group_status, e.id AS entry_id,
           e.name, e.path, e.kind, e.size, e.mtime, m.keep, e.is_dir
    FROM dup_groups g INDEXED BY idx_dup_groups_analysis_status
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE ${where}
    ORDER BY COALESCE(g.wasted_bytes, 0) DESC, COALESCE(g.size, 0) DESC, g.id, e.path
    LIMIT ? OFFSET ?
  `).all(...baseArgs, limit + 1, offset) as FileRow[];
  const page = rows.slice(0, limit);
  const files = page.map(mapFile);

  return {
    jobId: input.jobId,
    libraryId: job.libraryId ?? "",
    groupId,
    files,
    offset,
    limit,
    total,
    hasMore: rows.length > limit,
    selectedCount: Number(selection.selected ?? 0),
    selectedBytes: Number(selection.selected_bytes ?? 0),
    plan: buildStoredDuplicatePlan(files, page, job.libraryId ?? "", input.quarantineDir),
  };
}

export function listDuplicateExecutionPlan(
  db: DatabaseSync,
  input: { jobId: string; quarantineDir: string; kind?: string },
): ChangePlan {
  const job = requireCompletedDuplicateJob(db, input.jobId);
  const kind = normalizeKind(input.kind);
  const filters = [
    "g.library_id = ?",
    "g.analysis_id = ?",
    "g.status = 'open'",
    "m.keep = 0",
    "le.tombstone = 0",
  ];
  const args = [job.libraryId ?? "", input.jobId];
  if (kind) {
    filters.push("e.kind = ?");
    args.push(kind);
  }
  const rows = db.prepare(`
    SELECT g.id AS group_id, g.status AS group_status, e.id AS entry_id,
           e.name, e.path, e.kind, e.size, e.mtime, m.keep, e.is_dir
    FROM dup_groups g
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE ${filters.join(" AND ")}
    ORDER BY COALESCE(g.wasted_bytes, 0) DESC, COALESCE(g.size, 0) DESC, g.id, e.path
  `).all(...args) as FileRow[];
  return buildStoredDuplicatePlan(
    rows.map(mapFile),
    rows,
    job.libraryId ?? "",
    input.quarantineDir,
  );
}

export function applyDuplicateKeepStrategy(
  db: DatabaseSync,
  input: { jobId: string; keepStrategy: KeepStrategy; preferredDirectory?: string },
): DuplicateKeepUpdateResult {
  const job = requireCompletedDuplicateJob(db, input.jobId);
  const rows = duplicateRowsForStrategy(db, job.libraryId ?? "", input.jobId);
  const byGroup = new Map<string, FileRow[]>();
  for (const row of rows) {
    const bucket = byGroup.get(row.group_id) ?? [];
    bucket.push(row);
    byGroup.set(row.group_id, bucket);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const update = db.prepare(`
      UPDATE dup_members
      SET keep = CASE WHEN entry_id = ? THEN 1 ELSE 0 END
      WHERE group_id = ?
    `);
    const refreshGroup = db.prepare(`
      UPDATE dup_groups
      SET wasted_bytes = (
        SELECT COALESCE(SUM(CASE WHEN m.keep = 0 THEN e.size ELSE 0 END), 0)
        FROM dup_members m
        JOIN entries e ON e.id = m.entry_id
        WHERE m.group_id = dup_groups.id
      )
      WHERE id = ?
    `);
    for (const [groupId, groupRows] of byGroup) {
      const keeper = [...groupRows].sort((a, b) =>
        compareStoredKeepHit(a, b, input.keepStrategy, input.preferredDirectory ?? ""),
      )[0];
      if (!keeper) continue;
      update.run(keeper.entry_id, groupId);
      refreshGroup.run(groupId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return duplicateSelectionSummary(db, job.libraryId ?? "", input.jobId);
}

export function resetDuplicateGroupKeep(
  db: DatabaseSync,
  input: { jobId: string; groupId: string; keepStrategy: KeepStrategy; preferredDirectory?: string },
): DuplicateKeepUpdateResult {
  const job = requireCompletedDuplicateJob(db, input.jobId);
  const rows = db.prepare(`
    SELECT g.id AS group_id, g.status AS group_status, e.id AS entry_id,
           e.name, e.path, e.kind, e.size, e.mtime, m.keep, e.is_dir
    FROM dup_groups g
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE g.library_id = ? AND g.analysis_id = ? AND g.id = ? AND g.status = 'open'
      AND le.tombstone = 0
    ORDER BY e.path
  `).all(job.libraryId ?? "", input.jobId, input.groupId) as FileRow[];
  if (rows.length === 0) throw new Error(`duplicate group not found: ${input.groupId}`);

  const keeper = [...rows].sort((a, b) =>
    compareStoredKeepHit(a, b, input.keepStrategy, input.preferredDirectory ?? ""),
  )[0]!;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE dup_members
      SET keep = CASE WHEN entry_id = ? THEN 1 ELSE 0 END
      WHERE group_id = ?
    `).run(keeper.entry_id, input.groupId);
    db.prepare(`
      UPDATE dup_groups
      SET wasted_bytes = (
        SELECT COALESCE(SUM(CASE WHEN m.keep = 0 THEN e.size ELSE 0 END), 0)
        FROM dup_members m
        JOIN entries e ON e.id = m.entry_id
        WHERE m.group_id = dup_groups.id
      )
      WHERE id = ?
    `).run(input.groupId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return duplicateSelectionSummary(db, job.libraryId ?? "", input.jobId);
}

export function setDuplicateMemberKeep(
  db: DatabaseSync,
  input: { jobId: string; groupId: string; entryId: string; keep: boolean },
): DuplicateKeepUpdateResult {
  const job = requireCompletedDuplicateJob(db, input.jobId);
  db.exec("BEGIN IMMEDIATE");
  try {
    const member = db.prepare(`
      SELECT m.entry_id, m.keep
      FROM dup_members m
      JOIN dup_groups g ON g.id = m.group_id
      WHERE g.analysis_id = ? AND m.group_id = ? AND m.entry_id = ?
    `).get(input.jobId, input.groupId, input.entryId) as { entry_id: string; keep: number } | undefined;
    if (!member) throw new Error(`duplicate member not found: ${input.entryId}`);
    const keepers = Number((db.prepare(`
      SELECT COUNT(*) AS keepers FROM dup_members WHERE group_id = ? AND keep = 1
    `).get(input.groupId) as { keepers: number }).keepers);
    if (!input.keep && member.keep === 1 && keepers <= 1) {
      throw new Error("每组重复文件至少需要保留一份");
    }
    if (input.keep) {
      db.prepare(`UPDATE dup_members SET keep = 0 WHERE group_id = ?`).run(input.groupId);
      db.prepare(`UPDATE dup_members SET keep = 1 WHERE group_id = ? AND entry_id = ?`)
        .run(input.groupId, input.entryId);
    } else {
      db.prepare(`UPDATE dup_members SET keep = 0 WHERE group_id = ? AND entry_id = ?`)
        .run(input.groupId, input.entryId);
    }
    db.prepare(`
      UPDATE dup_groups
      SET wasted_bytes = (
        SELECT COALESCE(SUM(CASE WHEN m.keep = 0 THEN e.size ELSE 0 END), 0)
        FROM dup_members m
        JOIN entries e ON e.id = m.entry_id
        WHERE m.group_id = dup_groups.id
      )
      WHERE id = ?
    `).run(input.groupId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return duplicateSelectionSummary(db, job.libraryId ?? "", input.jobId);
}

function requireCompletedDuplicateJob(db: DatabaseSync, jobId: string) {
  const job = getJobById(db, jobId);
  if (!job || job.kind !== "duplicates") throw new Error(`duplicate job not found: ${jobId}`);
  if (job.status !== "completed") throw new Error(`duplicate job is ${job.status}`);
  return job;
}

function mapFile(row: FileRow): RuntimeDuplicateHit & { groupId: string } {
  return {
    groupId: row.group_id,
    entryId: row.entry_id,
    name: row.name,
    path: row.path,
    kind: row.kind,
    size: row.size,
    mtime: row.mtime ?? 0,
    keep: row.keep === 1,
  };
}

function buildStoredDuplicatePlan(
  files: Array<RuntimeDuplicateHit & { groupId: string }>,
  rows: FileRow[],
  libraryId: string,
  quarantineDir: string,
): ChangePlan {
  const plannedGroups = new Set(
    rows.filter((row) => row.group_status === "open").map((row) => row.group_id),
  );
  const entries = new Map(rows.map((row) => [row.entry_id, row as unknown as Entry]));
  const losers = files
    .filter((file) => plannedGroups.has(file.groupId) && !file.keep)
    .flatMap((file) => {
      const entry = entries.get(file.entryId);
      return entry ? [entry] : [];
    });
  const occupied = new Set(losers.map((entry) => entry.path));
  const ops: PlanOp[] = losers.map((entry) => ({
    op: "quarantine" as const,
    from: entry.path,
    to: null,
    entryId: entry.id,
    ruleId: asRuleId("duplicate-cleanup"),
    reason: "重复文件，按策略保留另一份",
    risk: "none" as const,
    confidence: 0.99,
    selected: true,
  }));
  const loserByPath = new Map(losers.map((entry) => [entry.path, entry]));
  for (const op of ops) {
    const entry = loserByPath.get(op.from);
    if (!entry) continue;
    const resolved = resolveCollision(
      join(quarantineDir, entry.name),
      { has: (path) => occupied.has(path) },
      "suffix",
      entry.isDir,
    );
    op.to = resolved.path;
    if (resolved.path) occupied.add(resolved.path);
  }

  return {
    id: asPlanId(`duplicate-${randomUUID()}`),
    libraryId: asLibraryId(libraryId),
    createdAt: Date.now(),
    status: "draft",
    dryRun: true,
    collision: "suffix",
    summary: {
      selected: ops.length,
      rename: 0,
      move: 0,
      mkdir: 0,
      quarantine: ops.length,
      delete: 0,
      flatten: 0,
      conflicts: 0,
    },
    ops,
  };
}

function duplicateRowsForStrategy(db: DatabaseSync, libraryId: string, jobId: string): FileRow[] {
  return db.prepare(`
    SELECT g.id AS group_id, g.status AS group_status, e.id AS entry_id,
           e.name, e.path, e.kind, e.size, e.mtime, m.keep, e.is_dir
    FROM dup_groups g
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE g.library_id = ? AND g.analysis_id = ? AND g.status IN ('open', 'candidate') AND le.tombstone = 0
    ORDER BY g.id, e.path
  `).all(libraryId, jobId) as FileRow[];
}

function duplicateSelectionSummary(
  db: DatabaseSync,
  libraryId: string,
  jobId: string,
): DuplicateKeepUpdateResult {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN m.keep = 0 THEN 1 ELSE 0 END), 0) AS selected,
           COALESCE(SUM(CASE WHEN m.keep = 0 THEN e.size ELSE 0 END), 0) AS selected_bytes
    FROM dup_groups g
    JOIN dup_members m ON m.group_id = g.id
    JOIN entries e ON e.id = m.entry_id
    JOIN library_entries le ON le.entry_id = e.id AND le.library_id = g.library_id
    WHERE g.library_id = ? AND g.analysis_id = ? AND g.status IN ('open', 'candidate')
      AND m.keep = 0 AND le.tombstone = 0
  `).get(libraryId, jobId) as FileSelectionRow;
  return {
    selectedCount: Number(row.selected ?? 0),
    selectedBytes: Number(row.selected_bytes ?? 0),
  };
}

function compareStoredKeepHit(
  a: FileRow,
  b: FileRow,
  strategy: KeepStrategy,
  preferredDirectory: string,
): number {
  switch (strategy) {
    case "newest":
      return (b.mtime ?? 0) - (a.mtime ?? 0) || a.path.localeCompare(b.path);
    case "oldest":
      return (a.mtime ?? 0) - (b.mtime ?? 0) || a.path.localeCompare(b.path);
    case "shortest_path":
      return a.path.length - b.path.length || a.path.localeCompare(b.path);
    case "longest_path":
      return b.path.length - a.path.length || a.path.localeCompare(b.path);
    case "shortest_name":
      return a.name.length - b.name.length || a.path.localeCompare(b.path);
    case "longest_name":
      return b.name.length - a.name.length || a.path.localeCompare(b.path);
    case "name_quality":
      return storedNameQuality(a) - storedNameQuality(b) || a.path.localeCompare(b.path);
    case "preferred_dir":
      return (
        Number(!isWithinStoredDirectory(a.path, preferredDirectory))
          - Number(!isWithinStoredDirectory(b.path, preferredDirectory))
        || (b.mtime ?? 0) - (a.mtime ?? 0)
        || a.path.localeCompare(b.path)
      );
    default:
      return 0;
  }
}

function storedNameQuality(row: FileRow): number {
  const name = row.name.toLowerCase();
  let score = 0;
  if (/\bcopy\b|\b副本\b|\(?\d+\)?(?:\.\w+)?$/.test(name)) score += 40;
  if (/\[[^\]]+\]|\([^)]*\)|【[^】]*】/.test(name)) score += 20;
  if (/[-_.\s]{2,}/.test(name)) score += 10;
  if (/^\d+(?:\.\w+)?$/.test(name)) score += 20;
  if (name.length < 3) score += 10;
  return score;
}

function isWithinStoredDirectory(path: string, directory: string): boolean {
  if (!directory) return false;
  const normalize = (value: string) =>
    value.replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
  const candidate = normalize(path);
  const base = normalize(directory);
  return candidate === base || candidate.startsWith(`${base}\\`);
}

function normalizeKind(kind: string | undefined): string | null {
  return kind && kind !== "all" ? kind : null;
}

function normalizeOffset(value: number | undefined): number {
  return value != null && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function normalizeLimit(value: number | undefined, fallback: number, min: number): number {
  return value != null && Number.isFinite(value)
    ? Math.min(500, Math.max(min, Math.trunc(value)))
    : fallback;
}
