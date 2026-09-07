import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { asLibraryId, type Library, type LibraryCreateInput, type LibraryPatch } from "@nestify/shared";
import { mapLibraryRow, sqlBool, type LibraryRow } from "./map.ts";

function libraryById(db: DatabaseSync, id: string): Library | undefined {
  const row = db.prepare(`SELECT * FROM libraries WHERE id = ?`).get(id) as LibraryRow | undefined;
  return row ? mapLibraryRow(row) : undefined;
}

export function createLibrary(
  db: DatabaseSync,
  input: LibraryCreateInput & { id?: string },
): Library {
  const now = Date.now();
  const id = asLibraryId(input.id ?? randomUUID());
  db.prepare(
    `INSERT INTO libraries(
      id, name, roots_json, exclude_globs_json, max_depth, follow_symlinks, scan_hidden,
      hash_strategy, media_strategy, preview_strategy, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    JSON.stringify(input.roots),
    JSON.stringify(input.excludeGlobs ?? []),
    input.maxDepth ?? null,
    sqlBool(input.followSymlinks, false),
    sqlBool(input.scanHidden, false),
    input.hashStrategy ?? "duplicate-candidate-only",
    input.mediaStrategy ?? "off",
    input.previewStrategy ?? "standard",
    now,
    now,
  );
  const created = libraryById(db, id);
  if (!created) {
    throw new Error(`Failed to create library: ${id}`);
  }
  return created;
}

export function listLibraries(db: DatabaseSync): Library[] {
  const rows = db
    .prepare(`SELECT * FROM libraries ORDER BY created_at ASC, name ASC`)
    .all() as LibraryRow[];
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
  db.prepare(
    `UPDATE libraries SET
      name = ?,
      roots_json = ?,
      exclude_globs_json = ?,
      max_depth = ?,
      follow_symlinks = ?,
      scan_hidden = ?,
      hash_strategy = ?,
      media_strategy = ?,
      preview_strategy = ?,
      updated_at = ?
    WHERE id = ?`,
  ).run(
    next.name,
    JSON.stringify(next.roots),
    JSON.stringify(next.excludeGlobs),
    next.maxDepth,
    sqlBool(next.followSymlinks),
    sqlBool(next.scanHidden),
    next.hashStrategy,
    next.mediaStrategy,
    next.previewStrategy,
    next.updatedAt,
    id,
  );
  const updated = libraryById(db, id);
  if (!updated) {
    throw new Error(`Library not found: ${id}`);
  }
  return updated;
}

export function deleteLibrary(db: DatabaseSync, id: string): void {
  db.prepare(`DELETE FROM libraries WHERE id = ?`).run(id);
}
