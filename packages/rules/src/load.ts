import { BUILTIN_RULESETS } from "./builtin.ts";
import type { RuleSet } from "./types.ts";

export function listBuiltinProfiles(): RuleSet[] {
  return BUILTIN_RULESETS;
}

export function getBuiltinProfile(id: string): RuleSet | undefined {
  return BUILTIN_RULESETS.find((item) => item.id === id);
}
