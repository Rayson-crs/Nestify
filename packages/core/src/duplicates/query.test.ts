import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { asEntryId, asJobId, asLibraryId, type Entry } from "@nestify/shared";
import { createJob, createLibrary, updateJobStatus, upsertEntry } from "../db/repos/index.ts";
import { openDatabase } from "../db/open.ts";
import { analyzeDuplicates } from "./analyzer.ts";
import { persistDuplicateAnalysis } from "./persistence.ts";
import {
  applyDuplicateKeepStrategy,
  listDuplicateExecutionPlan,
  listDuplicateFilesPage,
  listDuplicateResultPage,
  setDuplicateMemberKeep,
} from "./query.ts";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nestify-duplicate-query-"));
  tempDirs.push(dir);
  return dir;
}

function entry(id: string, path: string, bytes: string, mtime: number, kind: Entry["kind"] = "file"): Entry {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, bytes);
  return {
    id: asEntryId(id),
    libraryId: asLibraryId("lib-query"),
    parentId: null,
    name: basename(path),
    stem: basename(path),
    ext: ".txt",
    isDir: false,
    size: Buffer.byteLength(bytes),
    mtime,
    ctime: mtime,
    atime: mtime,
    ino: id,
    dev: "dev-query",
    depth: 1,
    kind,
    protocol: "local",
    mime: null,
    path,
    parentPath: null,
    relPath: `${id}.txt`,
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: mtime,
    indexedAt: mtime,
  };
}

test("stored duplicate results are paged and keep selection is persistent", async () => {
  const root = tempDir();
  const quarantine = join(root, ".quarantine");
  const jobId = "duplicate-query-job";
  const contents = ["alpha", "bravo", "charlie"];
  const entries: Entry[] = [];
  contents.forEach((content, groupIndex) => {
    for (let index = 0; index < 2; index += 1) {
      entries.push(entry(
        `entry-${groupIndex}-${index}`,
        join(root, `group-${groupIndex}`, `file-${index}.txt`),
        content.repeat(groupIndex + 1),
        100 + groupIndex * 10 + index,
      ));
    }
  });
  const db = openDatabase(":memory:");
  createLibrary(db, { id: "lib-query", name: "Query", roots: [root] });
  entries.forEach((item) => upsertEntry(db, item));
  createJob(db, {
    id: asJobId(jobId),
    libraryId: asLibraryId("lib-query"),
    kind: "duplicates",
    status: "running",
    startedAt: 1,
  });
  const result = await analyzeDuplicates({
    entries,
    quarantineDir: quarantine,
    keepStrategy: "newest",
    analysisId: jobId,
  });
  persistDuplicateAnalysis(db, { libraryId: "lib-query", result, analysisId: jobId, analyzedAt: 2 });
  updateJobStatus(db, asJobId(jobId), "completed", { finishedAt: 3 });

  const firstPage = listDuplicateResultPage(db, { jobId, offset: 0, limit: 2 });
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.groups.length, 2);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.fileCount, 6);
  assert.equal(firstPage.selectedCount, 3);
  assert.ok(firstPage.groups.every((group) => group.files.length === 0 && group.representativeName.length > 0));

  const secondPage = listDuplicateResultPage(db, { jobId, offset: 2, limit: 2 });
  assert.equal(secondPage.groups.length, 1);
  assert.equal(secondPage.hasMore, false);

  const files = listDuplicateFilesPage(db, { jobId, quarantineDir: quarantine, offset: 2, limit: 2 });
  assert.equal(files.total, 6);
  assert.equal(files.files.length, 2);
  assert.equal(files.offset, 2);
  assert.equal(files.hasMore, true);
  assert.ok(files.plan.ops.length <= 2);

  const groupId = firstPage.groups[0]!.id;
  const groupFiles = listDuplicateFilesPage(db, { jobId, quarantineDir: quarantine, groupId });
  assert.equal(groupFiles.total, 2);

  db.prepare(`UPDATE entries SET kind = 'image' WHERE id = ?`).run(entries[0]!.id);
  const imagePage = listDuplicateResultPage(db, { jobId, kind: "image" });
  assert.equal(imagePage.total, 1);
  assert.equal(imagePage.fileCount, 1);

  const target = groupFiles.files[0]!;
  const manual = setDuplicateMemberKeep(db, {
    jobId,
    groupId,
    entryId: target.entryId,
    keep: true,
  });
  assert.equal(manual.selectedCount, 3);
  assert.throws(
    () => setDuplicateMemberKeep(db, {
      jobId,
      groupId,
      entryId: target.entryId,
      keep: false,
    }),
    /至少需要保留一份/,
  );

  const strategy = applyDuplicateKeepStrategy(db, { jobId, keepStrategy: "oldest" });
  assert.equal(strategy.selectedCount, 3);
  const executionPlan = listDuplicateExecutionPlan(db, { jobId, quarantineDir: quarantine });
  assert.equal(executionPlan.ops.length, 3);
  assert.equal(new Set(executionPlan.ops.map((op) => op.to)).size, 3);
  db.close();
});
