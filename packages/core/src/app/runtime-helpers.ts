import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleSet } from "@nestify/rules";
import type { Entry, Job } from "@nestify/shared";
import type { DatabaseLogFunction } from "../db/open.ts";
import type { RuleSetRecord } from "../db/repos/index.ts";
import type { ActiveScanJobStatus, OrganizeScope, ThumbnailRequest } from "../modules/types.ts";

export function isActiveScan<T extends { status: Job["status"] }>(
  scan: T | null,
): scan is T & { status: ActiveScanJobStatus } {
  return scan?.status === "running" || scan?.status === "paused" || scan?.status === "cancelling";
}

export function previewCandidateEntries(
  entries: readonly Entry[],
  input: { scope?: OrganizeScope; entryIds?: string[]; directory?: string },
): Entry[] {
  const scope = input.scope ?? "library";
  if (scope === "selection" && (input.entryIds?.length ?? 0) === 0) {
    throw new Error("selection scope requires at least one entryId");
  }
  if (scope === "directory" && !input.directory?.trim()) {
    throw new Error("directory scope requires a directory");
  }

  const liveEntries = entries.filter((entry) => !entry.tombstone);
  if (scope === "library") return liveEntries;
  if (scope === "directory") {
    const directory = normalizePreviewPath(input.directory!);
    const inDirectory = liveEntries.filter((entry) => isWithinPreviewDirectory(entry.path, directory));
    if ((input.entryIds?.length ?? 0) === 0) return inDirectory;
    const selectedIds = new Set(input.entryIds);
    return inDirectory.filter((entry) => selectedIds.has(entry.id));
  }

  const selectedIds = new Set(input.entryIds);
  const selectedDirectories = liveEntries
    .filter((entry) => selectedIds.has(entry.id) && entry.isDir)
    .map((entry) => normalizePreviewPath(entry.path));
  return liveEntries.filter(
    (entry) =>
      selectedIds.has(entry.id) ||
      selectedDirectories.some((directory) => isWithinPreviewDirectory(entry.path, directory)),
  );
}

export function normalizePreviewPath(path: string): string {
  const normalized = path.trim().replaceAll(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  return /^[a-z]:$/.test(normalized) ? `${normalized}/` : normalized;
}

export function isWithinPreviewDirectory(path: string, directory: string): boolean {
  const normalized = normalizePreviewPath(path);
  const prefix = directory.endsWith("/") ? directory : `${directory}/`;
  return normalized === directory || normalized.startsWith(prefix);
}

export function isWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(resolve(root), resolve(path));
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

export function thumbnailPriority(priority: ThumbnailRequest["priority"]): number {
  if (priority === "selected") return 3;
  if (priority === "visible") return 2;
  return 1;
}

export function toBuiltinRecord(profile: RuleSet, priority: number): RuleSetRecord {
  return {
    ...profile,
    builtin: true,
    enabled: true,
    priority,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function toRuleSetProfile(record: RuleSetRecord): RuleSet {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    dryRunDefault: record.dryRunDefault,
    collision: record.collision,
    rules: record.rules,
  };
}

export class RuntimePauseGate {
  private paused = false;
  private waiters = new Set<() => void>();

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.wake();
  }

  cancel(): void {
    this.paused = false;
    this.wake();
  }

  isPaused(): boolean {
    return this.paused;
  }

  async waitWhilePaused(signal?: AbortSignal): Promise<void> {
    if (!this.paused || signal?.aborted) return;
    await new Promise<void>((resolve) => {
      const wake = () => {
        signal?.removeEventListener("abort", wake);
        this.waiters.delete(wake);
        resolve();
      };
      this.waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
    });
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }
}

export function defaultAppDataRoot(): string {
  if (process.env.NESTIFY_APPDATA) return process.env.NESTIFY_APPDATA;
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Nestify");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Nestify");
  }
  return join(homedir(), ".config", "Nestify");
}

export function runStartupStep<T>(
  log: DatabaseLogFunction | undefined,
  event: string,
  step: () => T,
  details?: Record<string, unknown>,
): T {
  const startedAt = Date.now();
  log?.(`${event}.start`, details);
  try {
    const result = step();
    log?.(`${event}.finished`, {
      ...details,
      elapsedMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    log?.(`${event}.failed`, {
      ...details,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

export function defaultBundledConfigDir(): string {
  if (process.env.NESTIFY_CONFIG_DIR) return process.env.NESTIFY_CONFIG_DIR;
  const seeds = [
    join(process.cwd(), "config"),
    join(process.cwd(), "..", "config"),
    join(process.cwd(), "..", "..", "config"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "config"),
  ];
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) seeds.unshift(join(resources, "config"));
  for (const dir of seeds) {
    if (existsSync(join(dir, "app.default.yaml"))) return dir;
  }
  return join(process.cwd(), "config");
}
