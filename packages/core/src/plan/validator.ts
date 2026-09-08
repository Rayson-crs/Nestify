import { lstat, readdir } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import type { ChangePlan, PlanOp } from "@nestify/shared";
import { fileNameOf, isAbsolutePath, isIllegalName, normalizeKey, replacePrefix } from "./paths.ts";
import {
  isProtectedPath,
  isUnder,
  isUnderAny,
  protectedPathsFor,
} from "./validation.ts";

export type PlanValidationCode =
  | "invalid_selection"
  | "invalid_plan_library"
  | "invalid_library_root"
  | "invalid_quarantine"
  | "invalid_path"
  | "missing_entry_id"
  | "unknown_entry"
  | "tombstoned_entry"
  | "entry_path_mismatch"
  | "protected_path"
  | "source_outside_library"
  | "destination_outside_library"
  | "destination_outside_quarantine"
  | "source_missing"
  | "target_exists"
  | "case_conflict"
  | "planned_target_conflict"
  | "directory_cycle"
  | "delete_disabled"
  | "overwrite_requires_confirmation"
  | "illegal_operation";

export interface PlanValidationIssue {
  opIndex?: number;
  code: PlanValidationCode;
  path?: string;
  message: string;
}

export interface PlanValidationInput {
  db: DatabaseSync;
  plan: ChangePlan;
  library: { id: string; roots: string[] };
  selectedOps?: number[];
  quarantineDir: string;
  protectedPaths?: string[];
}

export interface SelectedPlanOp {
  op: PlanOp;
  index: number;
}

interface EntryRow {
  id: string;
  library_id: string;
  path: string;
  is_dir: number;
  tombstone: number;
}

const RELOCATE_OPS = new Set<PlanOp["op"]>(["rename", "move", "quarantine"]);
const ENTRY_OPS = new Set<PlanOp["op"]>([
  "rename",
  "move",
  "quarantine",
  "delete",
  "flatten",
]);

export function selectPlanOps(plan: ChangePlan, selectedOps?: readonly number[]): SelectedPlanOp[] {
  if (!selectedOps) {
    return plan.ops
      .map((op, index) => ({ op, index }))
      .filter(({ op }) => op.selected);
  }

  const selection = new Set(selectedOps);
  return plan.ops
    .map((op, index) => ({ op, index }))
    .filter(({ index }) => selection.has(index));
}

export async function validatePlan(input: PlanValidationInput): Promise<PlanValidationIssue[]> {
  const issues: PlanValidationIssue[] = [];
  const selected = selectPlanOps(input.plan, input.selectedOps);

  for (const index of input.selectedOps ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= input.plan.ops.length) {
      issues.push({
        code: "invalid_selection",
        message: `selected op index is out of range: ${index}`,
      });
    }
  }

  if (input.plan.libraryId !== input.library.id) {
    issues.push({
      code: "invalid_plan_library",
      message: "plan does not belong to the supplied library",
    });
  }
  if (input.library.roots.length === 0 || input.library.roots.some((root) => !isAbsolutePath(root))) {
    issues.push({
      code: "invalid_library_root",
      message: "library roots must be non-empty absolute paths",
    });
  }
  if (!isAbsolutePath(input.quarantineDir)) {
    issues.push({
      code: "invalid_quarantine",
      path: input.quarantineDir,
      message: "quarantine directory must be an absolute path",
    });
  }

  const rows = input.db
    .prepare(
      `SELECT id, library_id, path, is_dir, tombstone
       FROM entries
       WHERE library_id = ?`,
    )
    .all(input.plan.libraryId) as unknown as EntryRow[];
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const currentPaths = new Map<string, string>();
  const isDirById = new Map<string, boolean>();
  const pathOwners = new Map<string, string | null>();
  const vacatedPaths = new Set<string>();

  for (const row of rows) {
    if (row.tombstone === 1) continue;
    currentPaths.set(row.id, row.path);
    isDirById.set(row.id, row.is_dir === 1);
    pathOwners.set(normalizeKey(row.path), row.id);
  }

  const protectedPaths = [
    ...protectedPathsFor(process.platform, process.env),
    ...(input.protectedPaths ?? []),
  ];
  const protectedHit = (path: string): string | undefined =>
    protectedPaths.find((protectedPath) => isProtectedPath(path, protectedPath));

  for (const { op, index } of selected) {
    const row = op.entryId ? rowsById.get(op.entryId) : undefined;
    const requiresEntry = ENTRY_OPS.has(op.op);

    if (requiresEntry && !op.entryId) {
      issues.push(issue(index, op.from, "missing_entry_id", "operation requires an entry id"));
    }
    if (op.entryId && !row) {
      issues.push(issue(index, op.from, "unknown_entry", "entry id does not exist in the plan library"));
    }
    if (row?.tombstone === 1) {
      issues.push(issue(index, op.from, "tombstoned_entry", "entry is tombstoned"));
    }

    const expectedPath = op.entryId ? currentPaths.get(op.entryId) : undefined;
    if (row && requiresEntry && expectedPath && normalizeKey(op.from) !== normalizeKey(expectedPath)) {
      issues.push(
        issue(
          index,
          op.from,
          "entry_path_mismatch",
          `operation path does not match indexed path: ${expectedPath}`,
        ),
      );
    }

    const targetName = fileNameOf(op.to ?? op.from);
    if (
      !isAbsolutePath(op.from) ||
      (op.to != null && !isAbsolutePath(op.to)) ||
      isIllegalName(targetName)
    ) {
      issues.push(issue(index, op.from, "invalid_path", "operation contains an invalid path"));
    }

    for (const path of [op.from, op.to]) {
      if (path == null) continue;
      const protectedPath = protectedHit(path);
      if (protectedPath) {
        issues.push(issue(index, path, "protected_path", `protected path: ${protectedPath}`));
      }
    }

    if (op.op === "delete") {
      issues.push(issue(index, op.from, "delete_disabled", "delete is disabled; use quarantine"));
    }
    if (op.risk === "overwrite") {
      issues.push(
        issue(index, op.to ?? op.from, "overwrite_requires_confirmation", "overwrite was not confirmed"),
      );
    }
    if (op.risk === "illegal_name") {
      issues.push(issue(index, op.from, "illegal_operation", "operation has an illegal destination name"));
    }

    if (RELOCATE_OPS.has(op.op) && op.to == null) {
      issues.push(issue(index, op.from, "invalid_path", "relocation operation requires a destination"));
    }
    if (!isUnderAny(op.from, input.library.roots)) {
      issues.push(issue(index, op.from, "source_outside_library", "source is outside library"));
    }

    if (op.to != null && op.op !== "flatten") {
      const quarantined = op.op === "quarantine" || isUnder(op.to, input.quarantineDir);
      if (op.op === "quarantine" && !isUnder(op.to, input.quarantineDir)) {
        issues.push(
          issue(index, op.to, "destination_outside_quarantine", "quarantine destination is invalid"),
        );
      } else if (!quarantined && !isUnderAny(op.to, input.library.roots)) {
        issues.push(issue(index, op.to, "destination_outside_library", "destination is outside library"));
      }
    }

    if (op.op !== "mkdir") {
      const sourceStat = await maybeLstat(op.from);
      if (!sourceStat) {
        issues.push(issue(index, op.from, "source_missing", "source path does not exist"));
      }
    }

    if (op.to != null) {
      const targetKey = normalizeKey(op.to);
      const sourceKey = normalizeKey(op.from);
      const targetStat = await maybeLstat(op.to);
      const sameSourcePath = targetKey === sourceKey;

      if (targetStat && !sameSourcePath && !isVacated(op.to, vacatedPaths)) {
        issues.push(issue(index, op.to, "target_exists", "target path already exists"));
      }
      if (!sameSourcePath) {
        const caseConflict = await findCaseConflict(op.from, op.to);
        if (caseConflict && !isVacated(caseConflict, vacatedPaths)) {
          issues.push(issue(index, op.to, "case_conflict", `target conflicts by case with ${caseConflict}`));
        }
      }

      const owner = pathOwners.get(targetKey);
      if (!sameSourcePath && owner != null && owner !== op.entryId) {
        issues.push(
          issue(
            index,
            op.to,
            targetStat || isVacated(op.to, vacatedPaths) ? "target_exists" : "planned_target_conflict",
            "target path is occupied by another planned operation",
          ),
        );
      }
    }

    if (
      row &&
      op.to != null &&
      RELOCATE_OPS.has(op.op) &&
      isDirById.get(op.entryId!) === true &&
      isUnder(op.to, expectedPath ?? op.from)
    ) {
      issues.push(
        issue(index, op.to, "directory_cycle", "cannot move a directory into itself or its descendant"),
      );
    }

    updatePlannedState({
      op,
      entryId: op.entryId,
      isDir: op.entryId ? isDirById.get(op.entryId) === true : undefined,
      currentPaths,
      pathOwners,
      vacatedPaths,
    });
  }

  return issues;
}

function issue(
  opIndex: number,
  path: string,
  code: PlanValidationCode,
  message: string,
): PlanValidationIssue {
  return { opIndex, path, code, message };
}

async function maybeLstat(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function findCaseConflict(from: string, to: string): Promise<string | null> {
  const parent = to.slice(0, Math.max(to.lastIndexOf("\\"), to.lastIndexOf("/")));
  if (!parent) return null;

  try {
    for (const item of await readdir(parent, { withFileTypes: true })) {
      const candidate = `${parent.replace(/[\\/]+$/, "")}${parent.includes("\\") ? "\\" : "/"}${item.name}`;
      if (normalizeKey(candidate) === normalizeKey(to) && normalizeKey(candidate) !== normalizeKey(from)) {
        return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isVacated(path: string, vacatedPaths: ReadonlySet<string>): boolean {
  const key = normalizeKey(path);
  for (const vacated of vacatedPaths) {
    if (key === vacated || key.startsWith(`${vacated}/`)) return true;
  }
  return false;
}

function updatePlannedState(input: {
  op: PlanOp;
  entryId?: string;
  isDir?: boolean;
  currentPaths: Map<string, string>;
  pathOwners: Map<string, string | null>;
  vacatedPaths: Set<string>;
}): void {
  const { op, entryId, isDir, currentPaths, pathOwners, vacatedPaths } = input;

  if (op.op === "mkdir" && op.to != null) {
    pathOwners.set(normalizeKey(op.to), null);
    return;
  }
  if (!entryId || op.to == null || !RELOCATE_OPS.has(op.op)) return;

  const from = currentPaths.get(entryId) ?? op.from;
  const fromKey = normalizeKey(from);
  vacatedPaths.add(fromKey);
  pathOwners.delete(fromKey);

  if (isDir) {
    for (const [id, path] of currentPaths) {
      if (id === entryId || !isUnder(path, from)) continue;
      const next = replacePrefix(path, from, op.to);
      if (next === path) continue;
      vacatedPaths.add(normalizeKey(path));
      pathOwners.delete(normalizeKey(path));
      currentPaths.set(id, next);
      pathOwners.set(normalizeKey(next), id);
    }
  }

  currentPaths.set(entryId, op.to);
  pathOwners.set(normalizeKey(op.to), entryId);
}
