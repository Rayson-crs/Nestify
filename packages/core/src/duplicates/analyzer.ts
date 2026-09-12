import { createHash, randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { ChangePlan, Entry } from "@nestify/shared";
import { asEntryId, asPlanId, asRuleId } from "@nestify/shared";
import { planRuleset } from "../plan/planner.ts";
import { resolveCollision } from "../plan/collision.ts";
import type { CollisionStrategy, RuleSet } from "@nestify/rules";
import type { HashStrategy, KeepStrategy, OrganizeScope } from "../modules/types.ts";

export interface RuntimeDuplicateHit {
  entryId: string;
  name: string;
  path: string;
  size: number;
  mtime: number;
  keep: boolean;
}

export interface RuntimeDuplicateGroup {
  id: string;
  status: "candidate" | "confirmed";
  hash: string;
  size: number;
  wastedBytes: number;
  files: RuntimeDuplicateHit[];
}

export interface RuntimeDuplicateAnalyzeResult {
  groups: RuntimeDuplicateGroup[];
  plan: ChangePlan;
  hashStrategy: HashStrategy;
}

export interface DuplicateAnalyzeOptions {
  entries: readonly Entry[];
  quarantineDir: string;
  scope?: OrganizeScope;
  entryIds?: readonly string[];
  directory?: string;
  keepStrategy: KeepStrategy;
  hashStrategy?: HashStrategy;
  /** 处置方式：默认隔离（quarantine），delete 为直接删除（由宿主注入回收站处置）。 */
  dispose?: "quarantine" | "delete";
}

export async function analyzeDuplicates(options: DuplicateAnalyzeOptions): Promise<RuntimeDuplicateAnalyzeResult> {
  const scope = options.scope ?? "library";
  if (scope === "selection" && (options.entryIds?.length ?? 0) === 0) {
    throw new Error("selection scope requires at least one entryId");
  }
  if (scope === "directory" && !options.directory?.trim()) {
    throw new Error("directory scope requires a directory");
  }
  if (options.keepStrategy === "preferred_dir" && !options.directory?.trim()) {
    throw new Error("preferred_dir strategy requires a directory");
  }

  const hashStrategy = options.hashStrategy ?? "duplicate-candidate-only";
  const selectedIds = options.entryIds ? new Set(options.entryIds.map(asEntryId)) : null;
  const selectedDirectories: string[] = [];
  if (scope === "selection") {
    const entriesById = new Map(options.entries.map((entry) => [entry.id, entry]));
    for (const entryId of selectedIds ?? []) {
      const entry = entriesById.get(entryId);
      if (!entry) throw new Error(`selection entry not found: ${entryId}`);
      if (entry.isDir) selectedDirectories.push(entry.path);
    }
  }
  const directory = normalizeDirectory(options.directory);
  const indexedFiles = options.entries.filter((entry) => {
    if (entry.isDir || entry.tombstone) return false;
    if (scope === "selection") {
      return (
        (selectedIds?.has(entry.id) ?? false) ||
        selectedDirectories.some((selectedDirectory) =>
          isWithinDirectory(entry.path, normalizeDirectory(selectedDirectory)),
        )
      );
    }
    if (scope === "directory") return isWithinDirectory(entry.path, directory);
    return true;
  });
  const files = (await Promise.all(indexedFiles.map(withDiskSize))).filter(
    (file): file is HashedFile => file !== null,
  );
  const bySize = new Map<number, HashedFile[]>();
  for (const file of files) {
    const bucket = bySize.get(file.size) ?? [];
    bucket.push(file);
    bySize.set(file.size, bucket);
  }

  const candidates = [...bySize.values()].filter((bucket) => bucket.length > 1);

  if (hashStrategy === "off") {
    return {
      hashStrategy,
      groups: candidates.map((bucket) => ({
        id: `dup-candidate-${randomUUID()}`,
        status: "candidate",
        hash: "",
        size: bucket[0]!.size,
        wastedBytes: 0,
        files: bucket.map((file) => ({
          entryId: file.entry.id,
          name: file.entry.name,
          path: file.entry.path,
          size: file.size,
          mtime: file.entry.mtime,
          keep: false,
        })),
      })),
      plan: buildQuarantinePlan(options.entries, [], options.quarantineDir, options.dispose),
    };
  }

  const byQuick = new Map<string, HashedFile[]>();
  const confirmed: Array<{ hash: string; size: number; entries: Entry[] }> = [];

  if (hashStrategy === "all") {
    const physicalFiles = dedupeHashedInodes(files);
    const hashes = await hashFiles(physicalFiles, (file) => fullHash(file.entry.path));
    groupByHash(physicalFiles, hashes, confirmed);
  } else {
    for (const bucket of candidates) {
      for (const file of dedupeHashedInodes(bucket)) {
        const hash = await quickHash(file).catch(() => null);
        if (hash === null) continue; // 文件已消失（如 Office ~$ 锁文件被释放）——跳过，不炸整个分析
        const group = byQuick.get(hash) ?? [];
        group.push(file);
        byQuick.set(hash, group);
      }
    }

    for (const [, bucket] of byQuick) {
      if (bucket.length < 2) continue;
      const hashes = await hashFiles(bucket, (file) => fullHash(file.entry.path));
      groupByHash(bucket, hashes, confirmed);
    }
  }

  const groups: RuntimeDuplicateGroup[] = [];
  const losers: Entry[] = [];
  confirmed.forEach((group) => {
    const sorted = [...group.entries].sort((a, b) =>
      compareKeep(a, b, options.keepStrategy, normalizeDirectory(options.directory)),
    );
    const keeper = sorted[0]!;
    const redundant = sorted.slice(1);
    losers.push(...redundant);
    groups.push({
      id: `dup-${randomUUID()}`,
      status: "confirmed",
      hash: group.hash,
      size: group.size,
      wastedBytes: group.size * redundant.length,
      files: sorted.map((entry) => ({
        entryId: entry.id,
        name: entry.name,
        path: entry.path,
        size: group.size,
        mtime: entry.mtime,
        keep: entry.id === keeper.id,
      })),
    });
  });

  return {
    groups,
    plan: buildQuarantinePlan(options.entries, losers, options.quarantineDir, options.dispose),
    hashStrategy,
  };
}

interface HashedFile {
  entry: Entry;
  size: number;
}

async function withDiskSize(entry: Entry): Promise<HashedFile | null> {
  try {
    const info = await stat(entry.path);
    if (!info.isFile() || info.size === 0) return null;
    return { entry, size: info.size };
  } catch {
    return null;
  }
}

function dedupeHashedInodes(files: readonly HashedFile[]): HashedFile[] {
  const unique = new Map<string, HashedFile>();
  for (const file of files) {
    const entry = file.entry;
    const key = entry.ino && entry.dev ? `${entry.dev}:${entry.ino}` : `${entry.libraryId}:${entry.id}`;
    if (!unique.has(key)) unique.set(key, file);
  }
  return [...unique.values()];
}

function groupByHash(
  files: readonly HashedFile[],
  hashes: readonly (string | null)[],
  output: Array<{ hash: string; size: number; entries: Entry[] }>,
): void {
  const byKey = new Map<string, { hash: string; size: number; entries: Entry[] }>();
  files.forEach((file, index) => {
    const hash = hashes[index];
    if (!hash) return; // null = 文件已消失/不可读，跳过
    const key = `${file.size}:${hash}`;
    const group = byKey.get(key) ?? { hash, size: file.size, entries: [] };
    group.entries.push(file.entry);
    byKey.set(key, group);
  });
  for (const group of byKey.values()) {
    if (group.entries.length > 1) output.push(group);
  }
}

/** 逐文件哈希并对消失/不可读文件返回 null（不中断整个分析）。 */
async function hashFiles(
  files: readonly HashedFile[],
  hashFn: (file: HashedFile) => Promise<string>,
): Promise<(string | null)[]> {
  return Promise.all(files.map((file) => hashFn(file).catch(() => null)));
}

async function quickHash(file: HashedFile): Promise<string> {
  const handle = await open(file.entry.path, "r");
  try {
    const headSize = Math.min(1024 * 1024, file.size);
    const tailSize = Math.min(64 * 1024, Math.max(0, file.size - headSize));
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);
    if (headSize) await handle.read(head, 0, headSize, 0);
    if (tailSize) await handle.read(tail, 0, tailSize, file.size - tailSize);
    return createHash("sha256").update(head).update(tail).update(String(file.size)).digest("hex");
  } finally {
    await handle.close();
  }
}

async function fullHash(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, position);
      if (!result.bytesRead) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

function compareKeep(
  a: Entry,
  b: Entry,
  strategy: KeepStrategy,
  preferredDirectory: string | null,
): number {
  if (strategy === "oldest") return a.mtime - b.mtime || a.path.localeCompare(b.path);
  if (strategy === "shortest_path") return a.path.length - b.path.length || a.path.localeCompare(b.path);
  if (strategy === "name_quality") return nameQualityScore(a) - nameQualityScore(b) || a.path.localeCompare(b.path);
  if (strategy === "preferred_dir") {
    return (
      Number(!isWithinDirectory(a.path, preferredDirectory)) - Number(!isWithinDirectory(b.path, preferredDirectory)) ||
      b.mtime - a.mtime ||
      a.path.localeCompare(b.path)
    );
  }
  return b.mtime - a.mtime || a.path.localeCompare(b.path);
}

function nameQualityScore(entry: Entry): number {
  const name = entry.name.toLowerCase();
  let score = 0;
  if (/\bcopy\b|\b副本\b|\(?\d+\)?(?:\.\w+)?$/.test(name)) score += 40;
  if (/\[[^\]]+\]|\([^)]*\)|【[^】]*】/.test(name)) score += 20;
  if (/[-_.\s]{2,}/.test(name)) score += 10;
  if (/^\d+$/.test(entry.stem)) score += 20;
  if (entry.stem.length < 3) score += 10;
  return score;
}

function normalizeDirectory(path: string | undefined): string | null {
  const trimmed = path?.trim();
  return trimmed ? trimmed.replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase() : null;
}

function isWithinDirectory(path: string, directory: string | null): boolean {
  if (!directory) return false;
  const normalized = normalizeDirectory(path);
  if (!normalized) return false;
  return normalized === directory || normalized.startsWith(`${directory}\\`);
}

function buildQuarantinePlan(
  entries: readonly Entry[],
  losers: readonly Entry[],
  quarantineDir: string,
  dispose?: "quarantine" | "delete",
): ChangePlan {
  const ruleSet: RuleSet = {
    id: "duplicate-cleanup",
    name: "重复文件清理",
    dryRunDefault: true,
    collision: "suffix" satisfies CollisionStrategy,
    rules: [],
  };
  const plan = planRuleset({
    libraryId: entries[0]?.libraryId ?? "",
    entries: [],
    ruleSet,
    quarantineDir,
  });
  if (dispose === "delete") {
    // 直接删除模式：loser 生成 delete op（宿主注入回收站处置），无需碰撞解析。
    const ops = losers.map((entry) => ({
      op: "delete" as const,
      from: entry.path,
      to: null,
      entryId: entry.id,
      ruleId: asRuleId("duplicate-cleanup"),
      reason: "重复文件，按策略保留另一份",
      risk: "none" as const,
      confidence: 0.99,
      selected: true,
    }));
    return {
      ...plan,
      ops,
      summary: {
        selected: ops.length,
        rename: 0,
        move: 0,
        mkdir: 0,
        quarantine: 0,
        delete: ops.length,
        flatten: 0,
        conflicts: 0,
      },
    };
  }
  const occupied = new Set(losers.map((entry) => entry.path));
  const ops = losers.map((entry) => {
    const desired = joinQuarantine(quarantineDir, entry.name);
    const resolved = resolveCollision(
      desired,
      { has: (path) => occupied.has(path) },
      "suffix",
      entry.isDir,
    );
    if (resolved.path) occupied.add(resolved.path);
    return {
      op: "quarantine" as const,
      from: entry.path,
      to: resolved.path,
      entryId: entry.id,
      ruleId: asRuleId("duplicate-cleanup"),
      reason: resolved.reason ?? "重复文件，按策略保留另一份",
      risk: resolved.risk,
      confidence: resolved.selected ? 0.99 : 0.4,
      selected: resolved.selected,
    };
  });
  return {
    ...plan,
    ops,
    summary: {
      selected: ops.length,
      rename: 0,
      move: 0,
      mkdir: 0,
      quarantine: ops.length,
      delete: 0,
      flatten: 0,
      conflicts: 0,
    },
  };
}

function joinQuarantine(base: string, name: string): string {
  return `${base.replace(/[\\/]+$/, "")}\\${name}`;
}
