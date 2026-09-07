import type { ConflictStrategy, PlanRisk } from "@nestify/shared";
import { fileNameOf, isIllegalName, joinPath, parentPathOf, withNumericSuffix } from "./paths.ts";

export interface OccupiedLookup {
  has(path: string): boolean;
}

export interface CollisionResolution {
  path: string | null;
  risk: PlanRisk;
  selected: boolean;
  reason?: string;
}

export function resolveCollision(
  desired: string,
  occupied: OccupiedLookup,
  strategy: ConflictStrategy,
  isDir: boolean,
): CollisionResolution {
  const name = fileNameOf(desired);
  if (isIllegalName(name)) {
    return { path: null, risk: "illegal_name", selected: false, reason: "illegal destination name" };
  }
  if (!occupied.has(desired)) {
    return { path: desired, risk: "none", selected: true };
  }

  if (strategy === "skip") {
    return { path: null, risk: "occupied", selected: false, reason: "target exists, skipped" };
  }
  if (strategy === "overwrite") {
    return { path: desired, risk: "overwrite", selected: false, reason: "target exists, overwrite requires confirm" };
  }
  if (strategy === "abort") {
    return { path: null, risk: "occupied", selected: false, reason: "target exists, aborted" };
  }

  const parent = parentPathOf(desired);
  for (let n = 1; n <= 9999; n += 1) {
    const candidate = joinPath(parent, withNumericSuffix(name, isDir, n));
    if (!occupied.has(candidate)) {
      return { path: candidate, risk: "none", selected: true, reason: "suffixed to avoid collision" };
    }
  }
  return { path: null, risk: "occupied", selected: false, reason: "exhausted numeric suffixes" };
}
