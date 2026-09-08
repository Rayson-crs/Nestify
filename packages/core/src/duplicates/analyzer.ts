import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import type { ChangePlan, Entry } from "@nestify/shared";
import { asEntryId, asPlanId, asRuleId } from "@nestify/shared";
import { planRuleset } from "../plan/planner.ts";
import { resolveCollision } from "../plan/collision.ts";
import type { CollisionStrategy, RuleSet } from "@nestify/rules";
import type { HashStrategy, KeepStrategy, OrganizeScope } from "../modules/types.ts";

export interface RuntimeDuplicateHit {
  entryId: string;
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
  const files = options.entries.filter((entry) => {
    if (entry.isDir || entry.size === 0 || entry.tombstone) return false;
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
  const bySize = new Map<number, Entry[]>();
  for (const file of files) {
    const bucket = bySize.get(file.size) ?? [];
    bucket.push(file);
    bySize.set(file.size, bucket);
  }

  const candidates = [...bySize.values()].filter((bucket) => bucket.length > 1);

  if (hashStrategy === "off") {
    return {
      hashStrategy,
      groups: candidates.map((bucket, index) => ({
        id: `dup-candidate-${randomUUID()}`,
        status: "candidate",
        hash: "",
        size: bucket[0]!.size,
        wastedBytes: 0,
        files: bucket.map((entry) => ({
          entryId: entry.id,
          path: entry.path,
          size: entry.size,
          mtime: entry.mtime,
          keep: false,
        })),
      })),
      plan: buildQuarantinePlan(options.entries, [], options.quarantineDir),
    };
  }

  const byQuick = new Map<string, Entry[]>();
  const confirmed: Array<{ hash: string; entries: Entry[] }> = [];

  if (hashStrategy === "all") {
    const physicalEntries = dedupeInodes(files);
    const hashes = await Promise.all(physicalEntries.map(fullHash));
    groupByHash(physicalEntries, hashes, confirmed);
  } else {
    for (const bucket of candidates) {
      for (const entry of dedupeInodes(bucket)) {
        const hash = await quickHash(entry);
        const group = byQuick.get(hash) ?? [];
        group.push(entry);
        byQuick.set(hash, group);
      }
    }

    for (const [, bucket] of byQuick) {
      if (bucket.length < 2) continue;
      const hashes = await Promise.all(bucket.map(fullHash));
      groupByHash(bucket, hashes, confirmed);
    }
  }

  const groups: RuntimeDuplicateGroup[] = [];
  const losers: Entry[] = [];
  confirmed.forEach((group, index) => {
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
      size: keeper.size,
      wastedBytes: keeper.size * redundant.length,
      files: sorted.map((entry) => ({
        entryId: entry.id,
        path: entry.path,
        size: entry.size,
        mtime: entry.mtime,
        keep: entry.id === keeper.id,
      })),
    });
  });

  return { groups, plan: buildQuarantinePlan(options.entries, losers, options.quarantineDir), hashStrategy };
}

function dedupeInodes(entries: readonly Entry[]): Entry[] {
  const unique = new Map<string, Entry>();
  for (const entry of entries) {
    const key = entry.ino && entry.dev ? `${entry.dev}:${entry.ino}` : `${entry.libraryId}:${entry.id}`;
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function groupByHash(
  entries: readonly Entry[],
  hashes: readonly string[],
  output: Array<{ hash: string; entries: Entry[] }>,
): void {
  const byHash = new Map<string, Entry[]>();
  entries.forEach((entry, index) => {
    const hash = hashes[index]!;
    const group = byHash.get(hash) ?? [];
    group.push(entry);
    byHash.set(hash, group);
  });
  for (const [hash, group] of byHash) {
    if (group.length > 1) output.push({ hash, entries: group });
  }
}

async function quickHash(entry: Entry): Promise<string> {
  const handle = await open(entry.path, "r");
  try {
    const headSize = Math.min(1024 * 1024, entry.size);
    const tailSize = Math.min(64 * 1024, Math.max(0, entry.size - headSize));
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);
    if (headSize) await handle.read(head, 0, headSize, 0);
    if (tailSize) await handle.read(tail, 0, tailSize, entry.size - tailSize);
    return createHash("sha256").update(head).update(tail).update(String(entry.size)).digest("hex");
  } finally {
    await handle.close();
  }
}

async function fullHash(entry: Entry): Promise<string> {
  const handle = await open(entry.path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position < entry.size) {
      const bytes = Math.min(buffer.length, entry.size - position);
      const result = await handle.read(buffer, 0, bytes, position);
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

function buildQuarantinePlan(entries: readonly Entry[], losers: readonly Entry[], quarantineDir: string): ChangePlan {
  const ruleSet: RuleSet = {
    id: "duplicate-cleanup",
    name: "重复文件隔离",
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
