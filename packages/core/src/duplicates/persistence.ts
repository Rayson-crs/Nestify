import type { DatabaseSync } from "node:sqlite";
import type { RuntimeDuplicateAnalyzeResult } from "./analyzer.ts";

export interface DuplicateAnalysisPersistenceInput {
  libraryId: string;
  result: RuntimeDuplicateAnalyzeResult;
  analyzedAt?: number;
}

export interface DuplicateAnalysisPersistenceSummary {
  groupsInserted: number;
  membersInserted: number;
  groupsSuperseded: number;
}

export function persistDuplicateAnalysis(
  db: DatabaseSync,
  input: DuplicateAnalysisPersistenceInput,
): DuplicateAnalysisPersistenceSummary {
  const analyzedAt = input.analyzedAt ?? Date.now();
  const supersede = db.prepare(
    `UPDATE dup_groups
     SET status = 'superseded'
     WHERE library_id = ? AND status IN ('open', 'candidate')`,
  );
  const insertGroup = db.prepare(
    `INSERT INTO dup_groups(
      id, library_id, hash_full, hash_quick, size, file_count, wasted_bytes, status, created_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  const insertMember = db.prepare(
    `INSERT INTO dup_members(group_id, entry_id, keep, reason)
     VALUES (?, ?, ?, ?)`,
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    const superseded = Number(supersede.run(input.libraryId).changes);
    let membersInserted = 0;
    for (const group of input.result.groups) {
      insertGroup.run(
        group.id,
        input.libraryId,
        group.status === "confirmed" ? group.hash : null,
        group.size,
        group.files.length,
        group.wastedBytes,
        group.status === "confirmed" ? "open" : "candidate",
        analyzedAt,
      );
      for (const file of group.files) {
        insertMember.run(
          group.id,
          file.entryId,
          file.keep ? 1 : 0,
          group.status === "confirmed"
            ? file.keep
              ? "confirmed duplicate keeper"
              : "confirmed duplicate redundant copy"
            : "size-bucket candidate",
        );
        membersInserted += 1;
      }
    }
    db.exec("COMMIT");
    return {
      groupsInserted: input.result.groups.length,
      membersInserted,
      groupsSuperseded: superseded,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
