import type { DatabaseSync } from "node:sqlite";
import type { PreviewFormat } from "@nestify/shared";
import { ALL_LIBRARIES_ID } from "../search/index.ts";
import { getEntryById, getLibrary, membershipLibraryIdFor } from "../db/repos/index.ts";
import {
  THUMBNAIL_GENERATOR_VERSION,
  ThumbnailCacheService,
} from "../preview/thumbnail-service.ts";
import type { ModuleContext, ThumbnailRequest } from "../modules/types.ts";
import { isWithinRoot, thumbnailPriority } from "./runtime-helpers.ts";

export class RuntimeThumbnailCoordinator {
  private readonly options: {
    db: DatabaseSync;
    thumbnailsDir: string;
    concurrency: number;
    thumbnailSize: number;
    format: PreviewFormat;
  };
  private service: ThumbnailCacheService | null = null;

  constructor(options: {
    db: DatabaseSync;
    thumbnailsDir: string;
    concurrency: number;
    thumbnailSize: number;
    format: PreviewFormat;
  }) {
    this.options = options;
  }

  async get(
    request: ThumbnailRequest,
    ctx: Pick<ModuleContext, "libraryId" | "abortSignal">,
  ): Promise<{
    entryId: string;
    cachePath?: string;
    mime?: string;
    fallbackIcon?: string;
  }> {
    const entry = getEntryById(this.options.db, request.entryId);
    const libraryId = membershipLibraryIdFor(
      this.options.db,
      entry?.id ?? request.entryId,
      ctx.libraryId === ALL_LIBRARIES_ID ? undefined : ctx.libraryId,
    );
    if (!entry || !libraryId || entry.tombstone) {
      throw new Error(`entry not found in library: ${request.entryId}`);
    }
    const library = getLibrary(this.options.db, libraryId);
    if (!library) throw new Error(`library not found: ${libraryId}`);
    if (!library.roots.some((root) => isWithinRoot(entry.path, root))) {
      throw new Error("entry is outside its library roots");
    }
    if (entry.kind !== "image" || (request.kind && request.kind !== entry.kind)) {
      throw new Error(`thumbnail kind is not supported: ${request.kind ?? entry.kind}`);
    }

    const result = await this.getService().getThumbnail(
      {
        entryId: entry.id,
        sourcePath: entry.path,
        sizeBytes: entry.size,
        mtime: entry.mtime,
        generatorVersion: THUMBNAIL_GENERATOR_VERSION,
      },
      {
        priority: thumbnailPriority(request.priority),
        signal: ctx.abortSignal,
      },
    );
    return {
      entryId: result.entryId,
      cachePath: result.cachePath,
      mime: result.mime,
    };
  }

  async cancel(entryId: string): Promise<boolean> {
    return this.service?.cancel(entryId) ?? false;
  }

  private getService(): ThumbnailCacheService {
    if (this.service) return this.service;
    const service = new ThumbnailCacheService({
      db: this.options.db,
      thumbnailsDir: this.options.thumbnailsDir,
      concurrency: this.options.concurrency,
      thumbnailSize: this.options.thumbnailSize,
      format: this.options.format,
    });
    this.service = service;
    return service;
  }
}
