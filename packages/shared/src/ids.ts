declare const brand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type LibraryId = Branded<string, 'LibraryId'>;
export type EntryId = Branded<string, 'EntryId'>;
export type RuleId = Branded<string, 'RuleId'>;
export type RuleSetId = Branded<string, 'RuleSetId'>;
export type JobId = Branded<string, 'JobId'>;
export type PlanId = Branded<string, 'PlanId'>;
export type DupGroupId = Branded<string, 'DupGroupId'>;

export type AnyId =
  | LibraryId
  | EntryId
  | RuleId
  | RuleSetId
  | JobId
  | PlanId
  | DupGroupId;

export const asLibraryId = (value: string): LibraryId => value as LibraryId;
export const asEntryId = (value: string): EntryId => value as EntryId;
export const asRuleId = (value: string): RuleId => value as RuleId;
export const asRuleSetId = (value: string): RuleSetId => value as RuleSetId;
export const asJobId = (value: string): JobId => value as JobId;
export const asPlanId = (value: string): PlanId => value as PlanId;
export const asDupGroupId = (value: string): DupGroupId => value as DupGroupId;