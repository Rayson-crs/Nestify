import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { asEntryId } from "@nestify/shared";
import { openDatabase } from "../db/open.ts";
import { getThumbnailCache } from "./thumbnail-dao.ts";
import {
  buildThumbnailCacheKey,
  ThumbnailCacheService,
  ThumbnailCancelledError,
  type ThumbnailCacheRequest,
} from "./thumbnail-service.ts";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function createWorkspace(prefix: string): { dbRoot: string; thumbnailsDir: string; sourceRoot: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  const work = {
    dbRoot: join(root, "db"),
    thumbnailsDir: join(root, "cache", "thumbnails"),
    sourceRoot: join(root, "sources"),
  };
  mkdirSync(work.dbRoot, { recursive: true });
  mkdirSync(work.sourceRoot, { recursive: true });
  return work;
}

function request(
  entryId: string,
  sourcePath: string,
  overrides: Partial<ThumbnailCacheRequest> = {},
): ThumbnailCacheRequest {
  return {
    entryId: asEntryId(entryId),
    sizeBytes: 123,
    mtime: 456,
    generatorVersion: 1,
    sourcePath,
    ...overrides,
  };
}

test("thumbnail cache key covers identity fields and changes with each field", () => {
  const base = {
    entryId: asEntryId("entry-1"),
    sizeBytes: 100,
    mtime: 200,
    generatorVersion: 1,
  };
  const key = buildThumbnailCacheKey(base);

  assert.equal(key, buildThumbnailCacheKey({ ...base }));
  assert.notEqual(key, buildThumbnailCacheKey({ ...base, entryId: asEntryId("entry-2") }));
  assert.notEqual(key, buildThumbnailCacheKey({ ...base, sizeBytes: 101 }));
  assert.notEqual(key, buildThumbnailCacheKey({ ...base, mtime: 201 }));
  assert.notEqual(key, buildThumbnailCacheKey({ ...base, generatorVersion: 2 }));
});

test("thumbnail service writes cache once, records metadata, and reuses valid files", async () => {
  const work = createWorkspace("nestify-thumbnail-hit-");
  const sourcePath = join(work.sourceRoot, "image.png");
  const webpHeader = Buffer.from("RIFF????WEBPVP8 ", "latin1");
  writeFileSync(sourcePath, webpHeader);
  const db = openDatabase(":memory:");
  const service = new ThumbnailCacheService({
    db,
    thumbnailsDir: work.thumbnailsDir,
    thumbnailSize: 96,
    format: "webp",
  });

  const first = await service.getThumbnail(request("entry-1", sourcePath, { sizeBytes: 8 }));
  const second = await service.getThumbnail(request("entry-1", sourcePath, { sizeBytes: 8 }));
  const record = getThumbnailCache(db, "entry-1");

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.cachePath, first.cachePath);
  assert.equal(first.mime, "image/webp");
  assert.equal(first.width, 96);
  assert.equal(first.height, 96);
  assert.ok(record);
  assert.equal(record?.cacheKey, first.cacheKey);
  assert.equal(record?.path, first.cachePath);
  assert.equal(record?.width, 96);
  assert.equal(record?.height, 96);
  db.close();
});

test("thumbnail service rejects generator output that does not match its configured format", async () => {
  const work = createWorkspace("nestify-thumbnail-format-");
  const sourcePath = join(work.sourceRoot, "image.png");
  writeFileSync(
    sourcePath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const db = openDatabase(":memory:");
  const service = new ThumbnailCacheService({
    db,
    thumbnailsDir: work.thumbnailsDir,
    format: "jpeg",
    async generator() {
      return {
        data: new TextEncoder().encode("not-a-jpeg"),
        mime: "image/webp",
        width: 32,
        height: 32,
      };
    },
  });

  await assert.rejects(
    service.getThumbnail(request("entry-1", sourcePath)),
    /generator returned image\/webp for jpeg thumbnail; expected image\/jpeg/,
  );
  assert.equal(getThumbnailCache(db, "entry-1"), undefined);
  db.close();
});

test("thumbnail service invalidates a cache row when its file disappears", async () => {
  const work = createWorkspace("nestify-thumbnail-miss-");
  const sourcePath = join(work.sourceRoot, "image.png");
  writeFileSync(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const db = openDatabase(":memory:");
  let generated = 0;
  const service = new ThumbnailCacheService({
    db,
    thumbnailsDir: work.thumbnailsDir,
    async generator() {
      generated += 1;
      return {
        data: new TextEncoder().encode(`thumbnail-${generated}`),
        mime: "image/webp",
        width: 64,
        height: 64,
      };
    },
  });

  const first = await service.getThumbnail(request("entry-1", sourcePath));
  rmSync(first.cachePath, { force: true });
  const second = await service.getThumbnail(request("entry-1", sourcePath));

  assert.equal(generated, 2);
  assert.equal(second.cacheHit, false);
  assert.equal(second.cachePath, first.cachePath);
  db.close();
});

test("thumbnail service rejects cache paths outside the configured directory", async () => {
  const work = createWorkspace("nestify-thumbnail-path-");
  const sourcePath = join(work.sourceRoot, "image.png");
  const outsidePath = join(work.dbRoot, "outside.webp");
  writeFileSync(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const db = openDatabase(":memory:");
  const service = new ThumbnailCacheService({
    db,
    thumbnailsDir: work.thumbnailsDir,
    async generator() {
      return { data: new TextEncoder().encode("safe"), mime: "image/webp" };
    },
  });

  db.prepare(
    `INSERT INTO thumbnails(entry_id, cache_key, path, width, height, generated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("entry-1", "stale-key", outsidePath, 64, 64, Date.now());
  writeFileSync(outsidePath, "outside");

  const result = await service.getThumbnail(request("entry-1", sourcePath));
  const record = getThumbnailCache(db, "entry-1");

  assert.equal(result.cacheHit, false);
  assert.equal(result.cacheKey, buildThumbnailCacheKey(request("entry-1", sourcePath)));
  assert.equal(record?.path, result.cachePath);
  assert.notEqual(record?.path, outsidePath);
  db.close();
});

test("thumbnail queue limits concurrency, prioritizes work, and cancels jobs", async () => {
  const work = createWorkspace("nestify-thumbnail-queue-");
  const db = openDatabase(":memory:");
  const started: string[] = [];
  let active = 0;
  let maxActive = 0;
  let releaseCurrent: (() => void) | undefined;

  const service = new ThumbnailCacheService({
    db,
    thumbnailsDir: work.thumbnailsDir,
    concurrency: 1,
    async generator(input) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const name = input.sourcePath.endsWith("a.png") ? "a" : input.sourcePath.endsWith("c.png") ? "c" : "other";
      started.push(name);
      try {
        if (name === "a") {
          await new Promise<never>((_, reject) => {
            input.signal.addEventListener(
              "abort",
              () => reject(new Error("a aborted")),
              { once: true },
            );
          });
        }
        if (name === "c") {
          await new Promise<void>((resolve) => {
            releaseCurrent = resolve;
          });
        }
        return {
          data: new TextEncoder().encode(name),
          mime: "image/webp",
          width: 32,
          height: 32,
        };
      } finally {
        active -= 1;
      }
    },
  });

  const aPromise = service.getThumbnail(request("entry-a", join(work.sourceRoot, "a.png")));
  await waitFor(() => service.queueState.active === 1);
  const bPromise = service.getThumbnail(
    request("entry-b", join(work.sourceRoot, "b.png")),
    { priority: 1 },
  );
  const cPromise = service.getThumbnail(
    request("entry-c", join(work.sourceRoot, "c.png")),
    { priority: 10 },
  );
  await waitFor(() => service.queueState.queued === 2);

  assert.equal(await service.cancel("entry-a"), true);
  await assert.rejects(aPromise, ThumbnailCancelledError);
  assert.equal(await service.cancel("entry-b"), true);
  await assert.rejects(bPromise, /cancelled/);
  await waitFor(() => service.queueState.active === 1 && started.includes("c"));
  assert.deepEqual(started, ["a", "c"]);

  releaseCurrent?.();
  const cResult = await cPromise;
  assert.equal(cResult.entryId, "entry-c");
  assert.equal(maxActive, 1);
  assert.deepEqual(service.queueState, { active: 0, queued: 0 });
  assert.equal(await service.cancel("entry-c"), false);
  db.close();
});

test("concurrent requests for one entry share a generation job", async () => {
  const work = createWorkspace("nestify-thumbnail-coalesce-");
  const db = openDatabase(":memory:");
  let generated = 0;
  let release: (() => void) | undefined;
  const service = new ThumbnailCacheService({
    db,
    thumbnailsDir: work.thumbnailsDir,
    concurrency: 2,
    async generator() {
      generated += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { data: new TextEncoder().encode("one"), mime: "image/webp" };
    },
  });

  const source = request("entry-a", join(work.sourceRoot, "a.png"));
  const first = service.getThumbnail(source);
  const second = service.getThumbnail(source);
  await waitFor(() => service.queueState.active === 1);
  release?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(service.queueState, { active: 0, queued: 0 });
  assert.equal(generated, 1);
  assert.equal(firstResult.cachePath, secondResult.cachePath);
  db.close();
});

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setImmediate(resolve));
  }
}
