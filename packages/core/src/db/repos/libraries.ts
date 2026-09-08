import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
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

export function deleteLibrary(db: DatabaseSync, id: string): void {
  // Keep shared canonical entries alive under another library before the cascade.
  runOrm(
    db,
    orm()
      .update(entries)
      .set({
        libraryId: sql`COALESCE((
          SELECT membership.library_id
          FROM library_entries membership
          WHERE membership.entry_id = ${entries.id}
            AND membership.library_id <> ${id}
            AND membership.tombstone = 0
          ORDER BY membership.library_id
          LIMIT 1
        ), ${entries.libraryId})`,
      })
      .where(
        and(
          eq(entries.libraryId, id),
          sql`EXISTS (
            SELECT 1 FROM library_entries other_membership
            WHERE other_membership.entry_id = ${entries.id}
              AND other_membership.library_id <> ${id}
              AND other_membership.tombstone = 0
          )`,
        ),
      ),
  );
  runOrm(db, orm().delete(libraries).where(eq(libraries.id, id)));
}
