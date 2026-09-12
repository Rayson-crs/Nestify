import { createHash } from "node:crypto";
import type { Entry } from "@nestify/shared";
import { previewCandidateEntries } from "../app/runtime-helpers.ts";
import type { OrganizeScope } from "../modules/types.ts";
import type { OrganizeSnapshot, OrganizeSnapshotStats } from "./types.ts";

export function createOrganizeSnapshot(input: {
  libraryId: string;
  entries: readonly Entry[];
  scope?: OrganizeScope;
  entryIds?: string[];
  directory?: string;
  now?: number;
  id?: string;
}): OrganizeSnapshot {
  const scope = input.scope ?? "library";
  const liveEntries = input.entries.filter((entry) => !entry.tombstone);
  const selected = previewCandidateEntries(liveEntries, input);
  const selectedIds = selected.map((entry) => entry.id);
  const createdAt = input.now ?? Date.now();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(liveEntries.map(snapshotEntry)))
    .digest("hex");
  const snapshotKey = createHash("sha1")
    .update(JSON.stringify({ scope, directory: input.directory?.trim() || null, entryIds: selectedIds }))
    .digest("hex")
    .slice(0, 12);
  return {
    id: input.id ?? `organize-${fingerprint.slice(0, 16)}-${snapshotKey}-${createdAt.toString(36)}`,
    version: 1,
    createdAt,
    libraryId: input.libraryId,
    scope,
    directory: input.directory?.trim() || undefined,
    entryIds: selectedIds,
    entries: structuredClone(liveEntries),
    fingerprint,
    stats: getSnapshotStats(liveEntries, selected),
  };
}

export function getSnapshotStats(entries: readonly Entry[], selected: readonly Entry[]): OrganizeSnapshotStats {
  const files = entries.filter((entry) => !entry.isDir).length;
  const directories = entries.length - files;
  const selectedFiles = selected.filter((entry) => !entry.isDir).length;
  const selectedDirectories = selected.length - selectedFiles;
  return {
    total: entries.length,
    files,
    directories,
    selected: selected.length,
    selectedFiles,
    selectedDirectories,
    maxDepth: entries.reduce((max, entry) => Math.max(max, entry.depth), 0),
  };
}

function snapshotEntry(entry: Entry): unknown {
  return {
    id: entry.id,
    parentId: entry.parentId,
    name: entry.name,
    isDir: entry.isDir,
    size: entry.size,
    mtime: entry.mtime,
    ctime: entry.ctime,
    ino: entry.ino,
    dev: entry.dev,
    path: entry.path,
    relPath: entry.relPath,
    hashQuick: entry.hashQuick,
    hashFull: entry.hashFull,
  };
}
