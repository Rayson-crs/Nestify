import fs from 'node:fs'

function write(path, content) {
  fs.writeFileSync(path, content.replaceAll('\r\n', '\n'))
}

write('packages/core/src/app/runtime-rules.ts', `import {
  getBuiltinProfile,
  listBuiltinProfiles,
  type CollisionStrategy,
  type MatchTree,
} from "@nestify/rules";
import type { ChangePlan } from "@nestify/shared";
import type { DatabaseSync } from "node:sqlite";
import {
  createRuleSetRecord,
  deleteRuleSetRecord,
  getRuleSetRecord,
  listEntries,
  listRuleSetRecords,
  parseRuleSetYaml,
  serializeRuleSet,
  setRuleSetEnabled,
  setRuleSetPriority,
  updateRuleSetRecord,
  type RuleSetCreateInput,
  type RuleSetPatch,
  type RuleSetRecord,
} from "../db/repos/index.ts";
import { getLibrary } from "../db/repos/index.ts";
import type { OrganizeScope } from "../modules/types.ts";
import { planRename, planRuleset } from "../plan/planner.ts";
import { previewCandidateEntries, toBuiltinRecord, toRuleSetProfile } from "./runtime-helpers.ts";

export function listRuntimeRuleSets(db: DatabaseSync): RuleSetRecord[] {
  return [...listBuiltinProfiles().map((profile, index) => toBuiltinRecord(profile, index)), ...listRuleSetRecords(db)].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
  );
}

export function getRuntimeRuleSet(db: DatabaseSync, id: string): RuleSetRecord | undefined {
  const stored = getRuleSetRecord(db, id);
  if (stored) return stored;
  const builtin = getBuiltinProfile(id);
  if (!builtin) return undefined;
  const priority = listBuiltinProfiles().findIndex((profile) => profile.id === builtin.id);
  return {
    ...builtin,
    builtin: true,
    enabled: true,
    priority: priority >= 0 ? priority : Number.MAX_SAFE_INTEGER,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function createRuntimeRuleSet(db: DatabaseSync, input: RuleSetCreateInput): RuleSetRecord {
  if (input.id && getBuiltinProfile(input.id)) {
    throw new Error(\`builtin ruleset id is reserved: \${input.id}\`);
  }
  return createRuleSetRecord(db, input);
}

export function assertCustomRuleSet(db: DatabaseSync, id: string): void {
  if (getBuiltinProfile(id)) throw new Error(\`builtin ruleset is readonly: \${id}\`);
  if (!getRuleSetRecord(db, id)) throw new Error(\`ruleset not found: \${id}\`);
}

export function updateRuntimeRuleSet(db: DatabaseSync, id: string, patch: RuleSetPatch): RuleSetRecord {
  assertCustomRuleSet(db, id);
  return updateRuleSetRecord(db, id, patch);
}

export function deleteRuntimeRuleSet(db: DatabaseSync, id: string): void {
  assertCustomRuleSet(db, id);
  deleteRuleSetRecord(db, id);
}

export function enableRuntimeRuleSet(db: DatabaseSync, id: string, enabled: boolean): RuleSetRecord {
  assertCustomRuleSet(db, id);
  return setRuleSetEnabled(db, id, enabled);
}

export function prioritizeRuntimeRuleSet(db: DatabaseSync, id: string, priority: number): RuleSetRecord {
  assertCustomRuleSet(db, id);
  return setRuleSetPriority(db, id, priority);
}

export function cloneRuntimeRuleSet(
  db: DatabaseSync,
  sourceId: string,
  options: { name?: string; priority?: number; enabled?: boolean } = {},
): RuleSetRecord {
  const source = getRuntimeRuleSet(db, sourceId);
  if (!source) throw new Error(\`ruleset not found: \${sourceId}\`);
  return createRuleSetRecord(db, {
    ...toRuleSetProfile(source),
    id: undefined,
    name: options.name ?? \`\${source.name} Copy\`,
    priority: options.priority ?? source.priority,
    enabled: options.enabled ?? true,
  });
}

export function exportRuntimeRuleSet(db: DatabaseSync, id: string): string {
  const source = getRuntimeRuleSet(db, id);
  if (!source) throw new Error(\`ruleset not found: \${id}\`);
  return serializeRuleSet(toRuleSetProfile(source));
}

export function importRuntimeRuleSet(db: DatabaseSync, yaml: string): RuleSetRecord {
  const profile = parseRuleSetYaml(yaml);
  const requestedId = getRuleSetRecord(db, profile.id) || getBuiltinProfile(profile.id) ? undefined : profile.id;
  return createRuleSetRecord(db, {
    ...profile,
    id: requestedId,
  });
}

export function previewRuntimeRules(
  db: DatabaseSync,
  quarantineDir: string,
  input: {
    libraryId: string;
    ruleSetId: string;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
  },
): ChangePlan {
  const library = getLibrary(db, input.libraryId);
  if (!library) throw new Error(\`library not found: \${input.libraryId}\`);
  const profile = getRuntimeRuleSet(db, input.ruleSetId);
  if (!profile) throw new Error(\`ruleset not found: \${input.ruleSetId}\`);
  if (!profile.enabled) throw new Error(\`ruleset is disabled: \${input.ruleSetId}\`);
  const entries = listEntries(db, input.libraryId);
  const candidateEntryIds = previewCandidateEntries(entries, input).map((entry) => entry.id);
  return planRuleset({
    libraryId: input.libraryId,
    entries,
    candidateEntryIds,
    ruleSet: profile,
    collision: input.collision,
    libraryRoot: library.roots[0],
    quarantineDir,
  });
}

export function previewRuntimeRename(
  db: DatabaseSync,
  input: {
    libraryId: string;
    template: string;
    match?: MatchTree;
    scope?: OrganizeScope;
    entryIds?: string[];
    directory?: string;
    collision?: CollisionStrategy;
  },
): ChangePlan {
  const library = getLibrary(db, input.libraryId);
  if (!library) throw new Error(\`library not found: \${input.libraryId}\`);
  const entries = listEntries(db, input.libraryId);
  const candidateEntryIds = previewCandidateEntries(entries, input).map((entry) => entry.id);
  return planRename({
    libraryId: input.libraryId,
    entries,
    candidateEntryIds,
    template: input.template,
    match: input.match,
    collision: input.collision,
    libraryRoot: library.roots[0],
  });
}
`)

console.log('wrote runtime-rules')