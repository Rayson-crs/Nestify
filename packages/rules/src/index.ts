export type {
  CollisionStrategy,
  MatchAtom,
  MatchTree,
  RuleChainCall,
  RuleValueExpression,
  RuleDefinition,
  RuleSet,
  // —— 步骤链（v2） ——
  RuleStep,
  RuleStepTrace,
  FilterStep,
  IfElseStep,
  ForEachStep,
  TransformStep,
  ActionStep,
  StepTarget,
  Extractor,
  RuleAction,
} from "./types.ts";
export {
  isFilterStep,
  isIfElseStep,
  isForEachStep,
  isTransformStep,
  isActionStep,
  normalizeStep,
} from "./types.ts";
export { BUILTIN_RULESETS } from "./builtin.ts";
export { listBuiltinProfiles, getBuiltinProfile } from "./load.ts";
export { legacyRuleToSteps, flattenSteps, flattenStepTree, findTopAction } from "./compat.ts";
export type { FlatStepNode } from "./compat.ts";
