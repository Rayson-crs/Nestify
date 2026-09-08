import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ChangePlan, PlanOp } from "@nestify/shared";
import { asEntryId, asLibraryId, asPlanId, type Entry } from "@nestify/shared";
import { createLibrary, upsertEntry } from "../db/repos/index.ts";
import { openDatabase } from "../db/open.ts";
import { executePlan, rollbackPlan } from "./executor.ts";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function op(partial: Partial<PlanOp> & Pick<PlanOp, "op" | "from">): PlanOp {
  return {
    to: null,
    ruleId: null,
    reason: "test",
    risk: "none",
    confidence: 1,
    selected: true,
    ...partial,
  };
}

function plan(ops: PlanOp[]): ChangePlan {
  return {
    id: asPlanId("plan1"),
    libraryId: asLibraryId("lib1"),
    createdAt: 1,
    status: "draft",
    collision: "suffix",
    dryRun: false,
    ops,
    summary: {
      selected: ops.length,
      rename: 0,
      move: 0,
      mkdir: 0,
      quarantine: 0,
      delete: 0,
      flatten: 0,
      conflicts: 0,
    },
  };
}

function indexedEntry(id: string, path: string, name: string): Entry {
  return {
    id: asEntryId(id),
    libraryId: asLibraryId("lib1"),
    parentId: null,
    name,
    stem: name,
    ext: ".txt",
    isDir: false,
    size: 8,
    mtime: 1,
    ctime: 1,
    atime: 1,
    ino: null,
    dev: null,
    depth: 1,
    kind: "file",
    protocol: "local",
    mime: null,
    path,
    parentPath: null,
    relPath: name,
    hashQuick: null,
    hashFull: null,
    childCount: 0,
    fileCount: 0,
    dirCount: 0,
    tombstone: false,
    seenAt: 1,
    indexedAt: 1,
  };
}

test("execute updates the index and rollback restores path and file", async () => {
  const root = tempDir("nestify-executor-");
  const quarantine = join(root, ".quarantine");
  const from = join(root, "a.txt");
  const to = join(root, "b.txt");
  writeFileSync(from, "payload");

  const db = openDatabase(":memory:");
  const library = createLibrary(db, { id: "lib1", name: "Test", roots: [root] });
  upsertEntry(db, indexedEntry("file1", from, "a.txt"));

  const result = await executePlan({
    db,
    plan: plan([op({ op: "rename", from, to, entryId: asEntryId("file1") })]),
    library: { id: library.id, roots: [root] },
    quarantineDir: quarantine,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.ok, 1);
  const entry = db.prepare(`SELECT path, name FROM entries WHERE id = ?`).get("file1") as {
    path: string;
    name: string;
  };
  assert.equal(entry.path, to);
  assert.equal(entry.name, "b.txt");

  const rollback = await rollbackPlan(db, result.jobId);
  assert.equal(rollback.status, "completed");
  assert.equal(rollback.ok, 1);
  const restored = db.prepare(`SELECT path, name FROM entries WHERE id = ?`).get("file1") as {
    path: string;
    name: string;
  };
  assert.equal(restored.path, from);
  assert.equal(restored.name, "a.txt");
  db.close();
});

test("executor rejects delete and selected illegal operations before writing", async () => {
  const root = tempDir("nestify-executor-safety-");
  const quarantine = join(root, ".quarantine");
  const doomed = join(root, "doomed.txt");
  const illegal = join(root, "safe.txt");
  writeFileSync(doomed, "keep me");
  writeFileSync(illegal, "keep me too");

  const db = openDatabase(":memory:");
  const library = createLibrary(db, { id: "lib1", name: "Test", roots: [root] });
  upsertEntry(db, indexedEntry("doomed", doomed, "doomed.txt"));
  upsertEntry(db, indexedEntry("illegal", illegal, "safe.txt"));

  const result = await executePlan({
    db,
    plan: plan([
      op({
        op: "delete",
        from: doomed,
        entryId: asEntryId("doomed"),
      }),
      op({
        op: "rename",
        from: illegal,
        to: `${illegal}<`,
        entryId: asEntryId("illegal"),
        risk: "illegal_name",
      }),
    ]),
    library: { id: library.id, roots: [root] },
    quarantineDir: quarantine,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.ok, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 2);
  assert.match(result.errors[0] ?? "", /delete is disabled/);
  const failedOps = db
    .prepare(`SELECT COUNT(*) AS n FROM job_ops WHERE status = 'failed'`)
    .get() as { n: number };
  assert.equal(failedOps.n, 0);
  db.close();
});

test("executor validates the whole plan before writing any operation", async () => {
  const root = tempDir("nestify-executor-prevalidate-");
  const outsideRoot = tempDir("nestify-executor-outside-");
  const quarantine = join(root, ".quarantine");
  const from = join(root, "safe.txt");
  const to = join(root, "renamed.txt");
  const outside = join(outsideRoot, "outside.txt");
  writeFileSync(from, "safe payload");
  writeFileSync(outside, "outside payload");

  const db = openDatabase(":memory:");
  const library = createLibrary(db, { id: "lib1", name: "Test", roots: [root] });
  upsertEntry(db, indexedEntry("safe", from, "safe.txt"));

  const result = await executePlan({
    db,
    plan: plan([
      op({ op: "rename", from, to, entryId: asEntryId("safe") }),
      op({ op: "rename", from: outside, to: join(outsideRoot, "moved.txt") }),
    ]),
    library: { id: library.id, roots: library.roots },
    quarantineDir: quarantine,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.ok, 0);
  assert.match(result.errors.join("\n"), /source is outside library/);
  assert.equal(existsSync(from), true);
  assert.equal(existsSync(to), false);
  assert.equal(existsSync(outside), true);
  db.close();
});

test("executor accepts operations under any declared library root", async () => {
  const firstRoot = tempDir("nestify-executor-root1-");
  const secondRoot = tempDir("nestify-executor-root2-");
  const quarantine = join(firstRoot, ".quarantine");
  const from = join(secondRoot, "a.txt");
  const to = join(secondRoot, "nested", "b.txt");
  writeFileSync(from, "payload");

  const db = openDatabase(":memory:");
  const library = createLibrary(db, {
    id: "lib1",
    name: "Multi-root",
    roots: [firstRoot, secondRoot],
  });
  upsertEntry(db, indexedEntry("file1", from, "a.txt"));

  const result = await executePlan({
    db,
    plan: plan([op({ op: "move", from, to, entryId: asEntryId("file1") })]),
    library: { id: library.id, roots: library.roots },
    quarantineDir: quarantine,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.ok, 1);
  assert.equal(existsSync(to), true);
  db.close();
});

test("executor refuses operations that touch a protected path", async () => {
  const root = tempDir("nestify-executor-protected-");
  const quarantine = join(root, ".quarantine");
  const protectedDir = join(root, "system");
  const target = join(protectedDir, "nested");

  const db = openDatabase(":memory:");
  const library = createLibrary(db, { id: "lib1", name: "Test", roots: [root] });

  const result = await executePlan({
    db,
    plan: plan([op({ op: "mkdir", from: target })]),
    library: { id: library.id, roots: library.roots },
    quarantineDir: quarantine,
    protectedPaths: [protectedDir],
  });

  assert.equal(result.status, "failed");
  assert.match(result.errors[0] ?? "", /protected path/);
  assert.equal(existsSync(protectedDir), false);
  db.close();
});
