import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { retrySqliteBusy } from "./busy-retry.ts";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function databases(): { writer: DatabaseSync; contender: DatabaseSync } {
  const dir = mkdtempSync(join(tmpdir(), "nestify-busy-retry-"));
  tempDirs.push(dir);
  const path = join(dir, "nestify.db");
  const writer = new DatabaseSync(path);
  writer.exec("PRAGMA journal_mode = WAL; CREATE TABLE progress(value INTEGER NOT NULL); INSERT INTO progress VALUES (0)");
  const contender = new DatabaseSync(path);
  contender.exec("PRAGMA journal_mode = WAL");
  return { writer, contender };
}

test("retrySqliteBusy retries a locked write and succeeds after the lock is released", async () => {
  const { writer, contender } = databases();
  writer.exec("BEGIN IMMEDIATE; UPDATE progress SET value = 1");
  let attempts = 0;
  const release = setTimeout(() => writer.exec("COMMIT"), 35);
  try {
    await retrySqliteBusy(contender, () => {
      attempts += 1;
      contender.exec("UPDATE progress SET value = 2");
    }, { attempts: 5, delayMs: 10, busyTimeoutMs: 1 });
    assert.ok(attempts > 1);
    const row = contender.prepare("SELECT value FROM progress").get() as { value: number };
    assert.equal(row.value, 2);
  } finally {
    clearTimeout(release);
    if (writer.isTransaction) writer.exec("ROLLBACK");
    contender.close();
    writer.close();
  }
});

test("retrySqliteBusy stops after the configured number of attempts", async () => {
  const { writer, contender } = databases();
  writer.exec("BEGIN IMMEDIATE; UPDATE progress SET value = 1");
  let attempts = 0;
  try {
    await assert.rejects(
      retrySqliteBusy(contender, () => {
        attempts += 1;
        contender.exec("UPDATE progress SET value = 2");
      }, { attempts: 3, delayMs: 1, busyTimeoutMs: 1 }),
      /locked|SQLITE_BUSY/i,
    );
    assert.equal(attempts, 3);
  } finally {
    writer.exec("ROLLBACK");
    contender.close();
    writer.close();
  }
});
