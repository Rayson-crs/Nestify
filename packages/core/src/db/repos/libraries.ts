import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { and, asc, eq, sql } from "drizzle-orm";
import { asLibraryId, type Library, type LibraryCreateInput, type LibraryPatch } from "@nestify/shared";
import { allOrm, getOrm, orm, runOrm } from "../orm.ts";
import { entries, libraries } from "../schema.ts";
import { mapLibraryRow, sqlBool, type LibraryRow } from "./map.ts";

function libraryById(db: DatabaseSync, id: string): Library | undefined {
  const row = getOrm<LibraryRow>(
    db,
    orm()
      .select()
      .from(libraries)
      .where(eq(libraries.id, id)),
  );
  return row ? mapLibraryRow(row) : undefined;
}

export function createLibrary(
  db: DatabaseSync,
  input: LibraryCreateInput & { id?: string },
): Library {
  const now = Date.now();
  const id = asLibraryId(input.id ?? randomUUID());
  runOrm(
    db,
    orm().insert(libraries).values({
      id,
      name: input.name,
      rootsJson: JSON.stringify(input.roots),
      excludeGlobsJson: JSON.stringify(input.excludeGlobs ?? []),
      maxDepth: input.maxDepth ?? null,
      followSymlinks: sqlBool(input.followSymlinks, false),
      scanHidden: sqlBool(input.scanHidden, false),
      hashStrategy: input.hashStrategy ?? "duplicate-candidate-only",
      mediaStrategy: input.mediaStrategy ?? "off",
      previewStrategy: input.previewStrategy ?? "standard",
      createdAt: now,
      updatedAt: now,
    }),
  );
  const created = libraryById(db, id);
  if (!created) {
    throw new Error(`Failed to create library: ${id}`);
  }
  return created;
}

export function listLibraries(db: DatabaseSync): Library[] {
  const rows = allOrm<LibraryRow>(
    db,
    orm()
      .select()
      .from(libraries)
      .orderBy(asc(libraries.createdAt), asc(libraries.name)),
  );
  return rows.map(mapLibraryRow);
}

export function getLibrary(db: DatabaseSync, id: string): Library | undefined {
  return libraryById(db, id);
}

export function updateLibrary(db: DatabaseSync, id: string, patch: LibraryPatch): Library {
  const current = libraryById(db, id);
  if (!current) {
    throw new Error(`Library not found: ${id}`);
  }
  const next: Library = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  };
  runOrm(
    db,
    orm()
      .update(libraries)
      .set({
        name: next.name,
        rootsJson: JSON.stringify(next.roots),
        excludeGlobsJson: JSON.stringify(next.excludeGlobs),
        maxDepth: next.maxDepth,
        followSymlinks: sqlBool(next.followSymlinks),
        scanHidden: sqlBool(next.scanHidden),
        hashStrategy: next.hashStrategy,
        mediaStrategy: next.mediaStrategy,
        previewStrategy: next.previewStrategy,
        updatedAt: next.updatedAt,
      })
      .where(eq(libraries.id, id)),
  );
  const updated = libraryById(db, id);
  if (!updated) {
    throw new Error(`Library not found: ${id}`);
  }
  return updated;
}

export interface LibraryRemovalDatabaseProgress {
  stage: string;
  current: number;
  total: number;
}

/**
 * Removes a library's index without touching any source files.
 *
 * This deliberately uses small DELETE batches. A single DELETE can invoke the
 * entries FTS trigger once per row and can monopolize SQLite for a long time,
 * which is especially noticeable when this function is accidentally called
 * from an Electron process.
 */
export function removeLibraryData(
  db: DatabaseSync,
  id: string,
  options: {
    preserveJobId?: string;
    batchSize?: number;
    onProgress?: (progress: LibraryRemovalDatabaseProgress) => void;
  } = {},
): void {
  const batchSize = Math.max(100, Math.min(5000, Math.trunc(options.batchSize ?? 500)));
  const report = (stage: string, current: number, total: number) => {
    options.onProgress?.({ stage, current: Math.min(current, total), total: Math.max(total, 1) });
  };

  const count = (query: string, ...params: SQLInputValue[]): number =>
    Number((db.prepare(query).get(...params) as { count: number }).count);

  const deleteInBatches = (
    query: string,
    params: SQLInputValue[],
    stage: string,
    total: number,
    completedRef: { value: number },
  ): void => {
    while (true) {
      const changes = Number(db.prepare(query).run(...params, batchSize).changes);
      if (changes === 0) break;
      completedRef.value += changes;
      report(stage, completedRef.value, total);
    }
  };

  db.exec("DROP TABLE IF EXISTS temp._nestify_remove_entries");
  db.exec("DROP TABLE IF EXISTS temp._nestify_remove_groups");
  db.exec("DROP TABLE IF EXISTS temp._nestify_remove_candidates");
  db.exec("CREATE TEMP TABLE _nestify_remove_candidates (entry_id TEXT PRIMARY KEY)");
  db.exec("CREATE TEMP TABLE _nestify_remove_entries (entry_id TEXT PRIMARY KEY)");
  db.exec("CREATE TEMP TABLE _nestify_remove_groups (group_id TEXT PRIMARY KEY)");

  try {
    db.prepare(
      "INSERT INTO temp._nestify_remove_candidates(entry_id) SELECT id FROM entries WHERE library_id = ?",
    ).run(id);

    const targetEntries = count("SELECT COUNT(*) AS count FROM temp._nestify_remove_candidates");
    const targetMemberships = count("SELECT COUNT(*) AS count FROM library_entries WHERE library_id = ?", id);
    const targetStaleMemberships = count(
      `SELECT COUNT(*) AS count
       FROM library_entries
       WHERE entry_id IN (SELECT entry_id FROM temp._nestify_remove_candidates)
         AND library_id <> ?`,
      id,
    );
    const targetGroups = count("SELECT COUNT(*) AS count FROM dup_groups WHERE library_id = ?", id);
    const targetJobs = count(
      "SELECT COUNT(*) AS count FROM jobs WHERE library_id = ? AND id <> coalesce(?, '')",
      id,
      options.preserveJobId ?? null,
    );
    const targetDuplicateMembers = count(
      `SELECT COUNT(*) AS count
       FROM dup_members
       WHERE group_id IN (SELECT id FROM dup_groups WHERE library_id = ?)
          OR entry_id IN (SELECT entry_id FROM temp._nestify_remove_candidates)`,
      id,
    );
    const targetSignals = count(
      "SELECT COUNT(*) AS count FROM signals WHERE entry_id IN (SELECT entry_id FROM temp._nestify_remove_candidates)",
    );
    const targetTrigrams = count(
      "SELECT COUNT(*) AS count FROM name_trigrams WHERE entry_id IN (SELECT entry_id FROM temp._nestify_remove_candidates)",
    );
    const targetThumbnails = count(
      "SELECT COUNT(*) AS count FROM thumbnails WHERE entry_id IN (SELECT entry_id FROM temp._nestify_remove_candidates)",
    );
    const targetJobOps = count(
      `SELECT COUNT(*) AS count
       FROM job_ops
       WHERE job_id IN (
         SELECT id FROM jobs WHERE library_id = ? AND id <> coalesce(?, '')
       )`,
      id,
      options.preserveJobId ?? null,
    );
    const total = Math.max(
      targetEntries + targetMemberships + targetStaleMemberships + targetGroups + targetJobs + targetDuplicateMembers +
        targetSignals + targetTrigrams + targetThumbnails + targetJobOps,
      1,
    );
    const completedRef = { value: 0 };
    report("准备移除资料库索引", completedRef.value, total);

    // Keep shared canonical entries alive under another library before deleting
    // the target membership. The candidate table was captured before this
    // update so the final ownership decision remains explicit.
    db.prepare(
      `UPDATE entries
       SET library_id = COALESCE((
         SELECT membership.library_id
         FROM library_entries membership
         WHERE membership.entry_id = entries.id
           AND membership.library_id <> ?
           AND membership.tombstone = 0
         ORDER BY membership.library_id
         LIMIT 1
       ), library_id)
       WHERE library_id = ?
         AND EXISTS (
           SELECT 1 FROM library_entries other_membership
           WHERE other_membership.entry_id = entries.id
             AND other_membership.library_id <> ?
             AND other_membership.tombstone = 0
         )`,
    ).run(id, id, id);
    deleteInBatches(
      `DELETE FROM library_entries
       WHERE rowid IN (
         SELECT rowid FROM library_entries WHERE library_id = ? LIMIT ?
       )`,
      [id],
      "移除资料库关联记录",
      total,
      completedRef,
    );

    // Tombstones are not active ownership. Remove historical memberships only
    // when no active membership remains, while preserving every active link in
    // another library.
    deleteInBatches(
      `DELETE FROM library_entries
       WHERE rowid IN (
         SELECT rowid
         FROM library_entries membership
         WHERE membership.entry_id IN (SELECT entry_id FROM temp._nestify_remove_candidates)
           AND NOT EXISTS (
             SELECT 1
             FROM library_entries active_membership
             WHERE active_membership.entry_id = membership.entry_id
               AND active_membership.tombstone = 0
           )
         LIMIT ?
       )`,
      [],
      "清理残留资料库关联",
      total,
      completedRef,
    );
    db.prepare(
      `INSERT INTO temp._nestify_remove_entries(entry_id)
       SELECT candidate.entry_id
       FROM temp._nestify_remove_candidates candidate
       WHERE NOT EXISTS (
         SELECT 1 FROM library_entries membership
         WHERE membership.entry_id = candidate.entry_id
       )`,
    ).run();

    for (const statement of [
      "DELETE FROM sync_state WHERE library_id = ?",
      "DELETE FROM scan_cursors WHERE library_id = ?",
      "DELETE FROM change_queue WHERE library_id = ?",
    ]) {
      db.prepare(statement).run(id);
    }
    report("清理扫描和同步状态", completedRef.value, total);

    db.prepare("INSERT INTO temp._nestify_remove_groups(group_id) SELECT id FROM dup_groups WHERE library_id = ?").run(id);
    deleteInBatches(
      `DELETE FROM dup_members
       WHERE rowid IN (
         SELECT rowid
         FROM dup_members
         WHERE group_id IN (SELECT group_id FROM temp._nestify_remove_groups)
            OR entry_id IN (SELECT entry_id FROM temp._nestify_remove_entries)
         LIMIT ?
       )`,
      [],
      "清理重复分析记录",
      total,
      completedRef,
    );
    deleteInBatches(
      `DELETE FROM dup_groups
       WHERE rowid IN (
         SELECT rowid
         FROM dup_groups
         WHERE id IN (SELECT group_id FROM temp._nestify_remove_groups)
         LIMIT ?
       )`,
      [],
      "清理重复分析记录",
      total,
      completedRef,
    );

    for (const table of ["signals", "name_trigrams", "thumbnails"]) {
      deleteInBatches(
        `DELETE FROM ${table}
         WHERE rowid IN (
           SELECT rowid
           FROM ${table}
           WHERE entry_id IN (SELECT entry_id FROM temp._nestify_remove_entries)
           LIMIT ?
         )`,
        [],
        "清理搜索和预览索引",
        total,
        completedRef,
      );
    }

    // A surviving shared entry may still point at a directory that belongs
    // only to the removed library. Detach it before deleting that directory;
    // otherwise the self-referencing FK would cascade into the survivor.
    db.prepare(
      `UPDATE entries
       SET parent_id = NULL
       WHERE id NOT IN (SELECT entry_id FROM temp._nestify_remove_entries)
         AND parent_id IN (SELECT entry_id FROM temp._nestify_remove_entries)`,
    ).run();

    deleteInBatches(
      `DELETE FROM entries
       WHERE rowid IN (
         SELECT rowid
         FROM entries
         WHERE id IN (SELECT entry_id FROM temp._nestify_remove_entries)
         LIMIT ?
       )`,
      [],
      "删除资料库索引条目",
      total,
      completedRef,
    );

    db.prepare(
      `DELETE FROM job_ops
       WHERE job_id IN (
         SELECT id FROM jobs
         WHERE library_id = ? AND id <> coalesce(?, '')
       )`,
    ).run(id, options.preserveJobId ?? null);
    db.prepare(
      `DELETE FROM jobs
       WHERE library_id = ? AND id <> coalesce(?, '')`,
    ).run(id, options.preserveJobId ?? null);
    completedRef.value += targetJobs;
    report("清理历史任务记录", completedRef.value, total);

    db.prepare("DELETE FROM libraries WHERE id = ?").run(id);
    report("资料库索引删除完成", total, total);
  } finally {
    db.exec("DROP TABLE IF EXISTS temp._nestify_remove_groups");
    db.exec("DROP TABLE IF EXISTS temp._nestify_remove_entries");
    db.exec("DROP TABLE IF EXISTS temp._nestify_remove_candidates");
  }
}

export function deleteLibrary(db: DatabaseSync, id: string): void {
  removeLibraryData(db, id);
}
