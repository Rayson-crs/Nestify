import type { DatabaseSync } from "node:sqlite";
import type { RuntimeDuplicateAnalyzeResult } from "./analyzer.ts";

export interface DuplicateAnalysisPersistenceInput {
  libraryId: string;
  result: RuntimeDuplicateAnalyzeResult;
  analysisId?: string;
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
  const supersedeOpenGroups = db.prepare(`
    UPDATE dup_groups
    SET status = 'superseded'
    WHERE library_id = ? AND status IN ('open', 'candidate')
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    const superseded = Number(supersedeOpenGroups.run(input.libraryId).changes);
    let membersInserted = 0;
    type SqlValue = string | number | null;
    const groupRows: SqlValue[][] = [];
    const memberRows: SqlValue[][] = [];
    for (const group of input.result.groups) {
      const confirmed = group.status === "confirmed";
      groupRows.push([
        group.id,
        input.libraryId,
        input.analysisId ?? input.result.analysisId ?? null,
        confirmed ? group.hash : null,
        group.size,
        group.files.length,
        group.wastedBytes,
        confirmed ? "open" : "candidate",
        analyzedAt,
      ]);
      for (const file of group.files) {
        memberRows.push([
          group.id,
          file.entryId,
          file.keep ? 1 : 0,
          confirmed
            ? file.keep
              ? "confirmed duplicate keeper"
              : "confirmed duplicate redundant copy"
            : "size-bucket candidate",
        ]);
        membersInserted += 1;
      }
    }
    insertChunked(db, "dup_groups", ["id", "library_id", "analysis_id", "hash_full", "size", "file_count", "wasted_bytes", "status", "created_at"], groupRows);
    insertChunked(db, "dup_members", ["group_id", "entry_id", "keep", "reason"], memberRows);
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

function insertChunked(
  db: DatabaseSync,
  table: "dup_groups" | "dup_members",
  columns: string[],
  rows: Array<Array<string | number | null>>,
): void {
  const chunkSize = Math.max(1, Math.floor(900 / columns.length));
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    db.prepare(`INSERT INTO ${table}(${columns.join(", ")}) VALUES ${values}`)
      .run(...chunk.flat());
  }
}
