import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";
import type { CollisionStrategy, RuleDefinition, RuleSet } from "@nestify/rules";
import { fromSqlBool, sqlBool } from "./map.ts";

export const RULESET_COLLISIONS: readonly CollisionStrategy[] = ["suffix", "skip", "overwrite"];
export const RULESET_ACTIONS: readonly RuleDefinition["action"][] = [
  "rename_dir",
  "flatten_dir",
  "rename_file",
  "move",
  "delete_to_quarantine",
];

export type RuleSetRecord = RuleSet & {
  builtin: boolean;
  enabled: boolean;
  priority: number;
  createdAt: number;
  updatedAt: number;
};

export type RuleSetCreateInput = Omit<RuleSet, "id"> & {
  id?: string;
  enabled?: boolean;
  priority?: number;
};

export type RuleSetPatch = Partial<Omit<RuleSet, "id">>;

export type RuleSetRow = {
  id: string;
  name: string;
  description: string | null;
  yaml: string;
  builtin: number;
  enabled: number;
  priority: number;
  created_at: number;
  updated_at: number;
};

export function serializeRuleSet(profile: RuleSet): string {
  return stringify({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    dryRunDefault: profile.dryRunDefault,
    collision: profile.collision,
    rules: profile.rules,
  });
}

export function parseRuleSetYaml(text: string): RuleSet {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new Error(`invalid ruleset YAML: ${(error as Error).message}`);
  }
  return validateRuleSet(parsed);
}

export function listRuleSetRecords(db: DatabaseSync): RuleSetRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM rulesets
       WHERE builtin = 0
       ORDER BY priority ASC, name COLLATE NOCASE ASC, created_at ASC`,
    )
    .all() as RuleSetRow[];
  return rows.map(mapRuleSetRow);
}

export function getRuleSetRecord(db: DatabaseSync, id: string): RuleSetRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM rulesets WHERE id = ? AND builtin = 0`)
    .get(id) as RuleSetRow | undefined;
  return row ? mapRuleSetRow(row) : undefined;
}

export function createRuleSetRecord(
  db: DatabaseSync,
  input: RuleSetCreateInput,
): RuleSetRecord {
  const id = input.id?.trim() || randomUUID();
  const profile = validateRuleSet({ ...input, id });
  const safeProfile = forceDryRunForDestructiveRules(profile);
  const now = Date.now();
  const priority = validatePriority(input.priority ?? 100);

  db.prepare(
    `INSERT INTO rulesets(
      id, name, description, yaml, builtin, enabled, priority, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(
    safeProfile.id,
    safeProfile.name,
    safeProfile.description ?? null,
    serializeRuleSet(safeProfile),
    sqlBool(input.enabled ?? true),
    priority,
    now,
    now,
  );

  const created = getRuleSetRecord(db, safeProfile.id);
  if (!created) throw new Error(`failed to create ruleset: ${safeProfile.id}`);
  return created;
}

export function updateRuleSetRecord(
  db: DatabaseSync,
  id: string,
  patch: RuleSetPatch,
): RuleSetRecord {
  const current = getRuleSetRecord(db, id);
  if (!current) throw new Error(`ruleset not found: ${id}`);

  const profile = validateRuleSet({
    id: current.id,
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    dryRunDefault: patch.dryRunDefault ?? current.dryRunDefault,
    collision: patch.collision ?? current.collision,
    rules: patch.rules ?? current.rules,
  });
  const safeProfile = forceDryRunForDestructiveRules(profile);

  db.prepare(
    `UPDATE rulesets
     SET name = ?, description = ?, yaml = ?, updated_at = ?
     WHERE id = ? AND builtin = 0`,
  ).run(
    safeProfile.name,
    safeProfile.description ?? null,
    serializeRuleSet(safeProfile),
    Date.now(),
    id,
  );

  const updated = getRuleSetRecord(db, id);
  if (!updated) throw new Error(`ruleset not found: ${id}`);
  return updated;
}

export function setRuleSetEnabled(db: DatabaseSync, id: string, enabled: boolean): RuleSetRecord {
  return mutateMetadata(db, id, { enabled });
}

export function setRuleSetPriority(db: DatabaseSync, id: string, priority: number): RuleSetRecord {
  return mutateMetadata(db, id, { priority: validatePriority(priority) });
}

export function deleteRuleSetRecord(db: DatabaseSync, id: string): void {
  const result = db.prepare(`DELETE FROM rulesets WHERE id = ? AND builtin = 0`).run(id);
  if (result.changes === 0) throw new Error(`ruleset not found or readonly: ${id}`);
}

function mutateMetadata(
  db: DatabaseSync,
  id: string,
  values: { enabled?: boolean; priority?: number },
): RuleSetRecord {
  const current = getRuleSetRecord(db, id);
  if (!current) throw new Error(`ruleset not found or readonly: ${id}`);
  db.prepare(
    `UPDATE rulesets SET enabled = ?, priority = ?, updated_at = ? WHERE id = ? AND builtin = 0`,
  ).run(
    sqlBool(values.enabled ?? current.enabled),
    values.priority ?? current.priority,
    Date.now(),
    id,
  );
  const updated = getRuleSetRecord(db, id);
  if (!updated) throw new Error(`ruleset not found or readonly: ${id}`);
  return updated;
}

function mapRuleSetRow(row: RuleSetRow): RuleSetRecord {
  const profile = validateRuleSet(parse(row.yaml));
  return {
    ...profile,
    builtin: false,
    enabled: fromSqlBool(row.enabled),
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateRuleSet(value: unknown): RuleSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("ruleset must be a mapping");
  }
  const input = value as Record<string, unknown>;
  const id = requiredString(input.id, "ruleset.id");
  const name = requiredString(input.name, "ruleset.name");
  const description = optionalString(input.description, "ruleset.description");
  const dryRunDefault = input.dryRunDefault;
  const collision = input.collision;
  const rules = input.rules;

  if (typeof dryRunDefault !== "boolean") {
    throw new Error("ruleset.dryRunDefault must be boolean");
  }
  if (typeof collision !== "string" || !RULESET_COLLISIONS.includes(collision as CollisionStrategy)) {
    throw new Error("ruleset.collision must be suffix, skip, or overwrite");
  }
  if (!Array.isArray(rules)) throw new Error("ruleset.rules must be an array");

  const ruleIds = new Set<string>();
  const validatedRules = rules.map((ruleValue) => {
    const rule = validateRule(ruleValue);
    if (ruleIds.has(rule.id)) throw new Error(`duplicate rule id: ${rule.id}`);
    ruleIds.add(rule.id);
    return rule;
  });

  return {
    id,
    name,
    description,
    dryRunDefault,
    collision: collision as CollisionStrategy,
    rules: validatedRules,
  };
}

function validateRule(value: unknown): RuleDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("rule must be a mapping");
  }
  const input = value as Record<string, unknown>;
  const id = requiredString(input.id, "rule.id");
  const enabled = input.enabled;
  const priority = input.priority;
  const action = input.action;
  if (typeof enabled !== "boolean") throw new Error(`rule ${id}: enabled must be boolean`);
  if (typeof priority !== "number" || !Number.isSafeInteger(priority)) {
    throw new Error(`rule ${id}: priority must be an integer`);
  }
  if (typeof action !== "string" || !RULESET_ACTIONS.includes(action as RuleDefinition["action"])) {
    throw new Error(`rule ${id}: unsupported action`);
  }
  if (input.match !== undefined && (typeof input.match !== "object" || input.match === null)) {
    throw new Error(`rule ${id}: match must be a mapping`);
  }
  if (input.template !== undefined && typeof input.template !== "string") {
    throw new Error(`rule ${id}: template must be a string`);
  }
  if (
    input.extract !== undefined &&
    (typeof input.extract !== "object" || input.extract === null)
  ) {
    throw new Error(`rule ${id}: extract must be a mapping`);
  }
  if (input.reason !== undefined && typeof input.reason !== "string") {
    throw new Error(`rule ${id}: reason must be a string`);
  }

  return {
    id,
    enabled,
    priority,
    action: action as RuleDefinition["action"],
    match: input.match as RuleDefinition["match"],
    template: input.template as RuleDefinition["template"],
    extract: input.extract as RuleDefinition["extract"],
    reason: input.reason as RuleDefinition["reason"],
  };
}

function forceDryRunForDestructiveRules(profile: RuleSet): RuleSet {
  return profile.rules.some((rule) => rule.action === "delete_to_quarantine") && !profile.dryRunDefault
    ? { ...profile, dryRunDefault: true }
    : profile;
}

function validatePriority(value: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("ruleset priority must be an integer");
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}
