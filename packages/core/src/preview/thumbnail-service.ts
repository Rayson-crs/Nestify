import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { PreviewCacheKey, PreviewFormat } from "@nestify/shared";
import {
  deleteThumbnailCache,
  getThumbnailCache,
  saveThumbnailCache,
  type ThumbnailCacheRecord,
} from "./thumbnail-dao.ts";

export const THUMBNAIL_GENERATOR_VERSION = 1;

export const THUMBNAIL_FORMAT_MIME_TYPES = {
  webp: "image/webp",
  jpeg: "image/jpeg",
} as const satisfies Record<PreviewFormat, string>;

export type ThumbnailMime = (typeof THUMBNAIL_FORMAT_MIME_TYPES)[PreviewFormat];
type SourceImageMime = ThumbnailMime | "image/png";

export interface ThumbnailCacheRequest extends PreviewCacheKey {
  sourcePath: string;
}

export interface ThumbnailGenerateInput {
  sourcePath: string;
  cacheKey: string;
  width: number;
  height: number;
  format: PreviewFormat;
  signal: AbortSignal;
}

export interface GeneratedThumbnail {
  data: Uint8Array;
  mime: ThumbnailMime;
  width?: number;
  height?: number;
}

export type ThumbnailGenerator = (input: ThumbnailGenerateInput) => Promise<GeneratedThumbnail>;

export interface ThumbnailCacheResult {
  entryId: string;
  cacheKey: string;
  cachePath: string;
  mime: ThumbnailMime;
  width: number;
  height: number;
  cacheHit: boolean;
}

export class ThumbnailCancelledError extends Error {
  readonly code = "ABORT_ERR";

  constructor(message = "thumbnail generation cancelled") {
    super(message);
    this.name = "AbortError";
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface Consumer {
  deferred: Deferred<ThumbnailCacheResult>;
  cleanup: () => void;
}

interface ThumbnailJob {
  id: number;
  entryId: string;
  request: ThumbnailCacheRequest;
  priority: number;
  queued: boolean;
  controller: AbortController;
  consumers: Set<Consumer>;
}

const MIME_EXTENSIONS: Record<ThumbnailMime, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

const FORMAT_EXTENSIONS: Record<PreviewFormat, string> = {
  webp: "webp",
  jpeg: "jpg",
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const relativePath = relative(resolve(directory), candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function assertPositiveDimension(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function detectImageMime(bytes: Uint8Array): SourceImageMime | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === "PNG") {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

/**
 * Standard-library fallback. It validates an image container and persists its bytes
 * without decoding; desktop can replace this with nativeImage once the service is wired.
 */
export async function nativeImageThumbnailGenerator(
  input: ThumbnailGenerateInput,
): Promise<GeneratedThumbnail> {
  const data = await readFile(input.sourcePath, { signal: input.signal });
  const mime = detectImageMime(data);
  const expectedMime = THUMBNAIL_FORMAT_MIME_TYPES[input.format];
  if (mime !== expectedMime) {
    throw new Error(
      `native image thumbnail generator requires ${expectedMime} input for ${input.format} output; PNG requires a transcoding generator`,
    );
  }
  return { data, mime, width: input.width, height: input.height };
}

export function buildThumbnailCacheKey(key: PreviewCacheKey): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        entryId: key.entryId,
        sizeBytes: key.sizeBytes,
        mtime: key.mtime,
        generatorVersion: key.generatorVersion,
      }),
    )
    .digest("hex");
}

export interface ThumbnailCacheServiceOptions {
  db: DatabaseSync;
  thumbnailsDir: string;
  concurrency?: number;
  generator?: ThumbnailGenerator;
  generatorVersion?: number;
  thumbnailSize?: number;
  format?: PreviewFormat;
  now?: () => number;
}

export interface ThumbnailRequestOptions {
  priority?: number;
  signal?: AbortSignal;
}

export class ThumbnailCacheService {
  readonly #db: DatabaseSync;
  readonly #thumbnailsDir: string;
  readonly #concurrency: number;
  readonly #generator: ThumbnailGenerator;
  readonly #generatorVersion: number;
  readonly #thumbnailSize: number;
  readonly #format: PreviewFormat;
  readonly #now: () => number;
  readonly #jobs = new Map<string, ThumbnailJob>();
  readonly #active = new Set<string>();
  readonly #queue: ThumbnailJob[] = [];
  #nextJobId = 1;

  constructor(options: ThumbnailCacheServiceOptions) {
    this.#db = options.db;
    this.#thumbnailsDir = resolve(options.thumbnailsDir);
    this.#concurrency = options.concurrency ?? 4;
    this.#generator = options.generator ?? nativeImageThumbnailGenerator;
    this.#generatorVersion = options.generatorVersion ?? THUMBNAIL_GENERATOR_VERSION;
    this.#thumbnailSize = options.thumbnailSize ?? 128;
    this.#format = options.format ?? "webp";
    this.#now = options.now ?? Date.now;

    if (!Number.isInteger(this.#concurrency) || this.#concurrency <= 0) {
      throw new Error("concurrency must be a positive integer");
    }
    if (!Number.isInteger(this.#generatorVersion) || this.#generatorVersion <= 0) {
      throw new Error("generatorVersion must be a positive integer");
    }
    assertPositiveDimension(this.#thumbnailSize, "thumbnailSize");
    if (!FORMAT_EXTENSIONS[this.#format]) {
      throw new Error(`unsupported thumbnail format: ${this.#format}`);
    }
  }

  get queueState(): { active: number; queued: number } {
    return { active: this.#active.size, queued: this.#queue.length };
  }

  async getThumbnail(
    request: ThumbnailCacheRequest,
    options: ThumbnailRequestOptions = {},
  ): Promise<ThumbnailCacheResult> {
    if (options.signal?.aborted) throw new ThumbnailCancelledError();

    const identity: PreviewCacheKey = {
      entryId: request.entryId,
      sizeBytes: request.sizeBytes,
      mtime: request.mtime,
      generatorVersion: request.generatorVersion || this.#generatorVersion,
    };
    const cacheKey = buildThumbnailCacheKey(identity);
    const hit = await this.#readValidCache(identity, cacheKey);
    if (hit) return hit;

    const existing = this.#jobs.get(request.entryId);
    if (
      existing &&
      existing.request.sizeBytes === request.sizeBytes &&
      existing.request.mtime === request.mtime &&
      existing.request.generatorVersion === identity.generatorVersion
    ) {
      return this.#attachConsumer(existing, options.signal);
    }
    if (existing) await this.cancel(request.entryId);

    const controller = new AbortController();
    const job: ThumbnailJob = {
      id: this.#nextJobId++,
      entryId: request.entryId,
      request: { ...request, generatorVersion: identity.generatorVersion },
      priority: options.priority ?? 0,
      queued: true,
      controller,
      consumers: new Set(),
    };
    this.#jobs.set(job.entryId, job);
    this.#enqueue(job);

    const consumer = this.#createConsumer(job, options.signal);
    job.consumers.add(consumer);
    this.#pump();
    return consumer.deferred.promise;
  }

  async cancel(entryId: string): Promise<boolean> {
    const job = this.#jobs.get(entryId);
    if (!job) return false;
    this.#cancelJob(job, new ThumbnailCancelledError());
    return true;
  }

  async #readValidCache(
    identity: PreviewCacheKey,
    cacheKey: string,
  ): Promise<ThumbnailCacheResult | undefined> {
    const record = getThumbnailCache(this.#db, identity.entryId);
    if (!record) return undefined;

    let info: Stats | undefined;
    try {
      info = await stat(record.path);
    } catch {
      info = undefined;
    }

    const mime = this.#mimeFromPath(record.path);
    const dimensionsValid =
      Number.isInteger(record.width) &&
      record.width > 0 &&
      Number.isInteger(record.height) &&
      record.height > 0;
    const valid =
      record.cacheKey === cacheKey &&
      dimensionsValid &&
      mime === THUMBNAIL_FORMAT_MIME_TYPES[this.#format] &&
      isInsideDirectory(this.#thumbnailsDir, record.path) &&
      info?.isFile() === true;

    if (valid) {
      return {
        entryId: record.entryId,
        cacheKey: record.cacheKey,
        cachePath: record.path,
        mime,
        width: record.width,
        height: record.height,
        cacheHit: true,
      };
    }

    if (
      info?.isFile() === true &&
      isInsideDirectory(this.#thumbnailsDir, record.path) &&
      record.path !== this.#targetPath(cacheKey)
    ) {
      await rm(record.path, { force: true });
    }
    deleteThumbnailCache(this.#db, identity.entryId);
    return undefined;
  }

  #mimeFromPath(path: string): ThumbnailMime | undefined {
    if (path.endsWith(".webp")) return "image/webp";
    if (path.endsWith(".jpg")) return "image/jpeg";
    if (path.endsWith(".jpeg")) return "image/jpeg";
    return undefined;
  }

  #targetPath(cacheKey: string): string {
    return resolve(this.#thumbnailsDir, `${cacheKey}.${FORMAT_EXTENSIONS[this.#format]}`);
  }

  #enqueue(job: ThumbnailJob): void {
    let index = this.#queue.length;
    while (index > 0) {
      const previous = this.#queue[index - 1];
      if (previous && previous.priority >= job.priority) break;
      index -= 1;
    }
    this.#queue.splice(index, 0, job);
  }

  #pump(): void {
    while (this.#active.size < this.#concurrency && this.#queue.length > 0) {
      const job = this.#queue.shift();
      if (!job) break;
      job.queued = false;
      this.#active.add(job.entryId);
      void this.#run(job);
    }
  }

  #createConsumer(job: ThumbnailJob, signal?: AbortSignal): Consumer {
    const result = deferred<ThumbnailCacheResult>();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    let consumer!: Consumer;
    const onAbort = () => {
      job.consumers.delete(consumer);
      cleanup();
      result.reject(new ThumbnailCancelledError());
      if (job.consumers.size === 0) this.#cancelJob(job, new ThumbnailCancelledError());
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    consumer = { deferred: result, cleanup };
    return consumer;
  }

  #attachConsumer(job: ThumbnailJob, signal?: AbortSignal): Promise<ThumbnailCacheResult> {
    const consumer = this.#createConsumer(job, signal);
    job.consumers.add(consumer);
    return consumer.deferred.promise;
  }

  #cancelJob(job: ThumbnailJob, error: unknown): void {
    this.#jobs.delete(job.entryId);
    job.controller.abort();
    if (job.queued) {
      const index = this.#queue.indexOf(job);
      if (index >= 0) this.#queue.splice(index, 1);
    }
    for (const consumer of job.consumers) {
      consumer.cleanup();
      consumer.deferred.reject(error);
    }
    job.consumers.clear();
  }

  async #run(job: ThumbnailJob): Promise<void> {
    try {
      if (job.controller.signal.aborted) throw new ThumbnailCancelledError();
      const result = await this.#generate(job);
      this.#jobs.delete(job.entryId);
      for (const consumer of job.consumers) {
        consumer.cleanup();
        consumer.deferred.resolve(result);
      }
      job.consumers.clear();
    } catch (error) {
      if (this.#jobs.get(job.entryId) === job) {
        this.#cancelJob(job, error);
      } else {
        for (const consumer of job.consumers) {
          consumer.cleanup();
          consumer.deferred.reject(error);
        }
        job.consumers.clear();
      }
    } finally {
      this.#active.delete(job.entryId);
      this.#pump();
    }
  }

  async #generate(job: ThumbnailJob): Promise<ThumbnailCacheResult> {
    const identity: PreviewCacheKey = {
      entryId: job.request.entryId,
      sizeBytes: job.request.sizeBytes,
      mtime: job.request.mtime,
      generatorVersion: job.request.generatorVersion,
    };
    const cacheKey = buildThumbnailCacheKey(identity);
    const generated = await this.#generator({
      sourcePath: job.request.sourcePath,
      cacheKey,
      width: this.#thumbnailSize,
      height: this.#thumbnailSize,
      format: this.#format,
      signal: job.controller.signal,
    });

    const expectedMime = THUMBNAIL_FORMAT_MIME_TYPES[this.#format];
    if (generated.mime !== expectedMime) {
      throw new Error(
        `generator returned ${generated.mime} for ${this.#format} thumbnail; expected ${expectedMime}`,
      );
    }
    const width = generated.width ?? this.#thumbnailSize;
    const height = generated.height ?? this.#thumbnailSize;
    assertPositiveDimension(width, "generated.width");
    assertPositiveDimension(height, "generated.height");
    if (generated.data.byteLength === 0) throw new Error("generator returned empty thumbnail");
    if (job.controller.signal.aborted) throw new ThumbnailCancelledError();

    await mkdir(this.#thumbnailsDir, { recursive: true });
    const target = resolve(this.#thumbnailsDir, `${cacheKey}.${MIME_EXTENSIONS[generated.mime]}`);
    const temporary = resolve(
      dirname(target),
      `.${cacheKey}.${job.id}.${this.#now()}.tmp`,
    );

    try {
      await writeFile(temporary, generated.data, { signal: job.controller.signal });
      if (job.controller.signal.aborted) throw new ThumbnailCancelledError();
      await rm(target, { force: true });
      await rename(temporary, target);

      const record: ThumbnailCacheRecord = {
        entryId: job.request.entryId,
        cacheKey,
        path: target,
        width,
        height,
        generatedAt: this.#now(),
      };
      try {
        saveThumbnailCache(this.#db, record);
      } catch (error) {
        await rm(target, { force: true });
        throw error;
      }

      return {
        entryId: record.entryId,
        cacheKey,
        cachePath: target,
        mime: generated.mime,
        width,
        height,
        cacheHit: false,
      };
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
