import type { DatabaseSync } from "node:sqlite";
import type { OrganizeRuleInput } from "@nestify/shared";
import { getLibrary, listEntries } from "../db/repos/index.ts";
import { createOrganizeSnapshot } from "../organize/snapshot.ts";
import { previewOrganize } from "../organize/preview.ts";
import type { OrganizePreview, OrganizeSnapshot } from "../organize/types.ts";
import type { OrganizeScope } from "../modules/types.ts";
import type { CollisionStrategy } from "@nestify/rules";

export class RuntimeOrganizeCoordinator {
  private readonly db: DatabaseSync;
  private readonly snapshots = new Map<string, OrganizeSnapshot>();

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  createSnapshot(input: {
    libraryId: string;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    now?: number;
  }): OrganizeSnapshot {
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error(`library not found: ${input.libraryId}`);
    const snapshot = createOrganizeSnapshot({
      ...input,
      entries: listEntries(this.db, input.libraryId),
    });
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  getSnapshot(snapshotId: string): OrganizeSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  preview(input: {
    libraryId: string;
    quarantineDir: string;
    rules?: OrganizeRuleInput[];
    /** @deprecated old ruleset callers only */
    ruleSetId?: string;
    snapshotId?: string;
    snapshot?: OrganizeSnapshot;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
    filter?: string;
    now?: number;
  }): OrganizePreview {
    const snapshot = input.snapshot ?? (input.snapshotId
      ? this.snapshots.get(input.snapshotId)
      : this.createSnapshot({
        libraryId: input.libraryId,
        scope: input.scope,
        entryIds: input.entryIds,
        directory: input.directory,
        now: input.now,
      }));
    if (!snapshot) throw new Error(`organize snapshot not found: ${input.snapshotId}`);
    const library = getLibrary(this.db, input.libraryId);
    if (!library) throw new Error("library not found for organize preview");
    return previewOrganize(
      this.db,
      input.quarantineDir,
      {
        ...input,
        profileId: input.ruleSetId,
        rules: input.rules,
        snapshot,
      },
      snapshot.entries,
      library.roots[0] ?? "",
    );
  }
}
