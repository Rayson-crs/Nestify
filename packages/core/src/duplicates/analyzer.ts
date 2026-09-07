import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { ChangePlan, Entry } from "@nestify/shared";
import { asPlanId, asRuleId } from "@nestify/shared";
import { planRuleset } from "../plan/planner.ts";
import { resolveCollision } from "../plan/collision.ts";
import type { CollisionStrategy, RuleSet } from "@nestify/rules";

export interface RuntimeDuplicateHit {
  entryId: string;
  path: string;
  size: number;
  mtime: number;
  keep: boolean;
}

export interface RuntimeDuplicateGroup {
  id: string;
  hash: string;
  size: number;
  wastedBytes: number;
  files: RuntimeDuplicateHit[];
}

export interface RuntimeDuplicateAnalyzeResult {
  groups: RuntimeDuplicateGroup[];
  plan: ChangePlan;
}

export interface DuplicateAnalyzeOptions {
  entries: readonly Entry[];
  quarantineDir: string;
  keepStrategy: "newest" | "oldest" | "shortest_path";
}

export async function analyzeDuplicates(options: DuplicateAnalyzeOptions): Promise<RuntimeDuplicateAnalyzeResult> {
  const files = options.entries.filter((entry) => !entry.isDir && entry.size > 0 && !entry.tombstone);
  const bySize = new Map<number, Entry[]>();
  for (const file of files) {
    const bucket = bySize.get(file.size) ?? [];
    bucket.push(file);
    bySize.set(file.size, bucket);
  }

  const candidates = [...bySize.values()].filter((bucket) => bucket.length > 1);
  const byQuick = new Map<string, Entry[]>();
  for (const bucket of candidates) {
    for (const entry of bucket) {
      const hash = await quickHash(entry);
      const group = byQuick.get(hash) ?? [];
      group.push(entry);
      byQuick.set(hash, group);
    }
  }

  const confirmed: Array<{ hash: string; entries: Entry[] }> = [];
  for (const [hash, bucket] of byQuick) {
    const uniqueInodes = new Map<string, Entry>();
    for (const entry of bucket) {
      const key = entry.ino && entry.dev ? `${entry.dev}:${entry.ino}` : `${entry.libraryId}:${entry.id}`;
      if (!uniqueInodes.has(key)) uniqueInodes.set(key, entry);
    }
    if (uniqueInodes.size < 2) continue;
    const physicalEntries = [...uniqueInodes.values()];
    const hashes = await Promise.all(physicalEntries.map(fullHash));
    const byFull = new Map<string, Entry[]>();
    physicalEntries.forEach((entry, index) => {
      const group = byFull.get(hashes[index]!) ?? [];
      group.push(entry);
      byFull.set(hashes[index]!, group);
    });
    for (const [fullHash, entries] of byFull) {
      if (entries.length > 1) confirmed.push({ hash: fullHash, entries });
    }
    void hash;
  }

  const groups: RuntimeDuplicateGroup[] = [];
  const losers: Entry[] = [];
  confirmed.forEach((group, index) => {
    const sorted = [...group.entries].sort((a, b) => compareKeep(a, b, options.keepStrategy));
    const keeper = sorted[0]!;
    const redundant = sorted.slice(1);
    losers.push(...redundant);
    groups.push({
      id: `dup-${index + 1}`,
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

  return { groups, plan: buildQuarantinePlan(options.entries, losers, options.quarantineDir) };
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

function compareKeep(a: Entry, b: Entry, strategy: "newest" | "oldest" | "shortest_path"): number {
  if (strategy === "oldest") return a.mtime - b.mtime || a.path.localeCompare(b.path);
  if (strategy === "shortest_path") return a.path.length - b.path.length || a.path.localeCompare(b.path);
  return b.mtime - a.mtime || a.path.localeCompare(b.path);
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
