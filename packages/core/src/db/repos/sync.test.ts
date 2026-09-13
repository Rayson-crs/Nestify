import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../open.ts";
import { createLibrary } from "./libraries.ts";
import { getEntryByPath, tombstoneMissingUnderPath } from "./entries.ts";
import {
  claimChanges,
  discardReconciliations,
  enqueueChange,
  enqueueChanges,
  ensureInitialReconciliation,
  getSyncState,
  markPendingChangesDirty,
  recoverProcessingChanges,
} from "./sync.ts";
import { ChangeProcessor } from "../../sync/processor.ts";
import { normalizeScanPath } from "../../fs/path.ts";

test("change queue merges pending path events and recovers processing items", () => {
  const db = openDatabase(":memory:");
  enqueueChange(db, {
    libraryId: "lib-1",
    eventType: "create",
    path: "D:\\Media\\a.txt",
    observedAt: 10,
    generation: 1,
  });
  const [mergedId] = enqueueChanges(db, [{
    libraryId: "lib-1",
    eventType: "change",
    path: "D:/Media/a.txt",
    observedAt: 20,
    generation: 2,
  }]);
  assert.equal(mergedId, 1);
  assert.equal(claimChanges(db, 10).length, 1);
  assert.equal(recoverProcessingChanges(db), 1);
  const recovered = claimChanges(db, 10);
  assert.equal(recovered[0]?.status, "processing");
  db.close();
});

test("initial reconciliation is queued once per library", () => {
  const db = openDatabase(":memory:");
  const roots = ["D:\\Media"];
  assert.equal(ensureInitialReconciliation(db, { id: "initial-lib", roots }), 1);
  assert.equal(ensureInitialReconciliation(db, { id: "initial-lib", roots }), 0);
  const row = db.prepare(`SELECT event_type, path FROM change_queue WHERE library_id = ?`).get("initial-lib") as {
    event_type: string;
    path: string;
  };
  assert.equal(row.event_type, "reconcile");
  assert.equal(row.path, roots[0]);
  db.close();
});

test("explicit scans can discard queued reconciliations without touching file events", () => {
  const db = openDatabase(":memory:");
  enqueueChanges(db, [
    { libraryId: "scan-lib", eventType: "reconcile", path: "Y:\\", observedAt: 1, generation: 1 },
    { libraryId: "scan-lib", eventType: "change", path: "Y:\\readme.txt", observedAt: 2, generation: 2 },
  ]);

  assert.equal(discardReconciliations(db, "scan-lib"), 1);
  const remaining = db.prepare(
    "SELECT event_type FROM change_queue WHERE library_id = ?",
  ).all("scan-lib") as Array<{ event_type: string }>;
  assert.deepEqual(remaining.map((row) => row.event_type), ["change"]);
  db.close();
});

test("change processor applies create, modify, delete, and rename incrementally", async () => {
  const base = mkdtempSync(join(tmpdir(), "nestify-sync-"));
  const root = join(base, "library");
  mkdirSync(join(root, "nested"), { recursive: true });
  const original = join(root, "nested", "before.txt");
  const renamed = join(root, "nested", "after.txt");
  const originalPath = normalizeScanPath(original);
  const renamedPath = normalizeScanPath(renamed);
  writeFileSync(original, "one");
  const db = openDatabase(":memory:");
  const library = createLibrary(db, { id: "sync-lib", name: "Sync", roots: [root] });
  const processor = new ChangeProcessor(db, { library, batchSize: 10 });
  try {
    enqueueChange(db, {
      libraryId: library.id,
      eventType: "create",
      path: originalPath,
      observedAt: Date.now(),
      generation: 1,
    });
    assert.equal(await processor.process(), 1);
    const created = getEntryByPath(db, library.id, originalPath);
    assert.ok(created);
    assert.equal(created.name, "before.txt");
    assert.equal(created.relPath, "nested/before.txt");
    assert.equal(created.depth, 1);

    writeFileSync(original, "one-two");
    enqueueChange(db, {
      libraryId: library.id,
      eventType: "change",
      path: originalPath,
      observedAt: Date.now(),
      generation: 2,
    });
    assert.equal(await processor.process(), 1);
    assert.equal(getEntryByPath(db, library.id, originalPath)?.size, 7);

    renameSync(original, renamed);
    enqueueChange(db, {
      libraryId: library.id,
      eventType: "rename",
      path: renamedPath,
      oldPath: originalPath,
      observedAt: Date.now(),
      generation: 3,
    });
    assert.equal(await processor.process(), 1);
    const moved = getEntryByPath(db, library.id, renamedPath);
    assert.ok(moved);
    assert.equal(moved.id, created.id);
    assert.equal(moved.name, "after.txt");
    assert.equal(getEntryByPath(db, library.id, originalPath), undefined);

    unlinkSync(renamed);
    enqueueChange(db, {
      libraryId: library.id,
      eventType: "delete",
      path: renamedPath,
      observedAt: Date.now(),
      generation: 4,
    });
    assert.equal(await processor.process(), 1);
    assert.equal(getEntryByPath(db, library.id, renamedPath)?.tombstone, true);
    assert.equal(getSyncState(db, library.id).lastEventId, 4);
  } finally {
    processor.stop();
    db.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("dirty reconciliation restores filesystem state after missed events", async () => {
  const base = mkdtempSync(join(tmpdir(), "nestify-reconcile-"));
  const root = join(base, "library");
  const nested = join(root, "nested");
  mkdirSync(nested, { recursive: true });
  const retained = join(nested, "retained.txt");
  const removed = join(nested, "removed.txt");
  const added = join(nested, "added.txt");
  writeFileSync(retained, "retained");
  writeFileSync(removed, "removed");
  const db = openDatabase(":memory:");
  const library = createLibrary(db, { id: "reconcile-lib", name: "Reconcile", roots: [root] });
  const processor = new ChangeProcessor(db, { library, batchSize: 10 });
  try {
    markPendingChangesDirty(db, library.id, root);
    assert.equal(await processor.process(), 1);
    assert.equal(getSyncState(db, library.id).dirty, false);
    assert.ok(getEntryByPath(db, library.id, normalizeScanPath(retained)));
    assert.ok(getEntryByPath(db, library.id, normalizeScanPath(removed)));

    unlinkSync(removed);
    writeFileSync(added, "added");
    markPendingChangesDirty(db, library.id, nested);
    assert.equal(await processor.process(), 1);

    assert.equal(getEntryByPath(db, library.id, normalizeScanPath(removed))?.tombstone, true);
    assert.equal(getEntryByPath(db, library.id, normalizeScanPath(added))?.tombstone, false);
    assert.equal(getSyncState(db, library.id).dirty, false);
    assert.ok(getSyncState(db, library.id).lastReconcileAt);
  } finally {
    processor.stop();
    db.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("directory rename updates every descendant and preserves membership", async () => {
  const base = mkdtempSync(join(tmpdir(), "nestify-rename-tree-"));
  const root = join(base, "library");
  const oldDirectory = join(root, "old");
  const newDirectory = join(root, "new");
  const childDirectory = join(oldDirectory, "child");
  const file = join(childDirectory, "item.txt");
  mkdirSync(childDirectory, { recursive: true });
  writeFileSync(file, "item");
  const db = openDatabase(":memory:");
  const library = createLibrary(db, { id: "rename-tree-lib", name: "Rename", roots: [root] });
  const processor = new ChangeProcessor(db, { library, batchSize: 10 });
  try {
    markPendingChangesDirty(db, library.id, root);
    await processor.process();
    const oldEntry = getEntryByPath(db, library.id, normalizeScanPath(oldDirectory));
    const oldChild = getEntryByPath(db, library.id, normalizeScanPath(childDirectory));
    const oldFile = getEntryByPath(db, library.id, normalizeScanPath(file));
    assert.ok(oldEntry && oldChild && oldFile);
    assert.equal(oldEntry.depth, 1);

    renameSync(oldDirectory, newDirectory);
    enqueueChange(db, {
      libraryId: library.id,
      eventType: "rename",
      path: normalizeScanPath(newDirectory),
      oldPath: normalizeScanPath(oldDirectory),
      observedAt: Date.now(),
      generation: 2,
    });
    assert.equal(await processor.process(), 1);

    const movedDirectory = getEntryByPath(db, library.id, normalizeScanPath(newDirectory));
    const movedChild = getEntryByPath(db, library.id, normalizeScanPath(join(newDirectory, "child")));
    const movedFile = getEntryByPath(db, library.id, normalizeScanPath(join(newDirectory, "child", "item.txt")));
    assert.equal(movedDirectory?.id, oldEntry.id);
    assert.equal(movedChild?.id, oldChild.id);
    assert.equal(movedFile?.id, oldFile.id);
    assert.equal(movedChild?.parentId, movedDirectory?.id);
    assert.equal(movedFile?.parentId, movedChild?.id);
    assert.equal(movedDirectory?.depth, 1);
    assert.equal(movedChild?.depth, 2);
    assert.equal(movedFile?.depth, 3);
    assert.equal(movedFile?.relPath, "new/child/item.txt");
    assert.equal(getEntryByPath(db, library.id, normalizeScanPath(oldDirectory)), undefined);
    assert.equal(getEntryByPath(db, library.id, normalizeScanPath(join(oldDirectory, "child", "item.txt"))), undefined);
  } finally {
    processor.stop();
    db.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("tombstoneMissingUnderPath respects path boundaries", () => {
  const db = openDatabase(":memory:");
  const timestamp = Date.now();
  const root = "D:\\tmp\\root";
  const root2 = "D:\\tmp\\root2";
  db.prepare(`INSERT INTO libraries(id, name, roots_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run("path-lib", "Paths", JSON.stringify(["D:\\tmp"]), timestamp, timestamp);
  const insert = db.prepare(`INSERT INTO entries(id, library_id, name, stem, ext, is_dir, kind, path, rel_path, seen_at) VALUES (?, ?, ?, ?, '', 0, 'file', ?, ?, ?)`);
  const membership = db.prepare(`INSERT INTO library_entries(entry_id, library_id, rel_path, seen_at) VALUES (?, ?, ?, ?)`);
  insert.run("root-file", "path-lib", "root.txt", "root", `${root}\\root.txt`, "root.txt", 1);
  insert.run("root2-file", "path-lib", "root2.txt", "root2", `${root2}\\root2.txt`, "root2.txt", 1);
  membership.run("root-file", "path-lib", "root/root.txt", 1);
  membership.run("root2-file", "path-lib", "root2/root2.txt", 1);

  assert.equal(tombstoneMissingUnderPath(db, "path-lib", root, 2), 1);
  const rootRow = db.prepare(`SELECT tombstone FROM library_entries WHERE entry_id = ?`).get("root-file") as { tombstone: number };
  const root2Row = db.prepare(`SELECT tombstone FROM library_entries WHERE entry_id = ?`).get("root2-file") as { tombstone: number };
  assert.equal(rootRow.tombstone, 1);
  assert.equal(root2Row.tombstone, 0);
  db.close();
});
