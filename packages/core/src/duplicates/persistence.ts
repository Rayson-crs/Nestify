import type { DatabaseSync } from "node:sqlite";
import { and, eq, inArray } from "drizzle-orm";
import { orm, runOrm } from "../db/orm.ts";
import { duplicateGroups, duplicateMembers } from "../db/schema.ts";
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

  db.exec("BEGIN IMMEDIATE");
  try {
    const superseded = Number(
      runOrm(
        db,
        orm()
          .update(duplicateGroups)
          .set({ status: "superseded" })
          .where(
            and(
              eq(duplicateGroups.libraryId, input.libraryId),
              inArray(duplicateGroups.status, ["open", "candidate"]),
            ),
          ),
      ).changes,
    );
    let membersInserted = 0;
    for (const group of input.result.groups) {
      const confirmed = group.status === "confirmed";
      runOrm(
        db,
        orm().insert(duplicateGroups).values({
          id: group.id,
          libraryId: input.libraryId,
          hashFull: confirmed ? group.hash : null,
          hashQuick: null,
          size: group.size,
          fileCount: group.files.length,
          wastedBytes: group.wastedBytes,
          status: confirmed ? "open" : "candidate",
          createdAt: analyzedAt,
        }),
      );
      for (const file of group.files) {
        runOrm(
          db,
          orm().insert(duplicateMembers).values({
            groupId: group.id,
            entryId: file.entryId,
            keep: file.keep ? 1 : 0,
            reason: confirmed
              ? file.keep
                ? "confirmed duplicate keeper"
                : "confirmed duplicate redundant copy"
              : "size-bucket candidate",
          }),
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
