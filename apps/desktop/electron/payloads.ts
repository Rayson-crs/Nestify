import type { NestifyRuntime } from '@nestify/core'

type RuntimeLibrary = ReturnType<NestifyRuntime['listLibraries']>[number]
type RuntimeRuleSet = ReturnType<NestifyRuntime['listRuleSets']>[number]

export type RuntimeLibraryPatch = Partial<Omit<RuntimeLibrary, 'id' | 'createdAt' | 'updatedAt'>>
export type RuntimeRuleSetCreate = Parameters<NestifyRuntime['createRuleSet']>[0]
export type RuntimeRuleSetPatch = Partial<
  Omit<RuntimeRuleSet, 'id' | 'builtin' | 'enabled' | 'priority' | 'createdAt' | 'updatedAt'>
>
export type RuntimeSearchOptions = Parameters<NestifyRuntime['search']>[2]
export type PlanPreviewScope = 'library' | 'directory' | 'selection'
export type PlanScopeInput = {
  scope?: PlanPreviewScope
  entryIds?: string[]
  directory?: string
}

export function toLibraryPayload(library: RuntimeLibrary) {
  return {
    id: library.id,
    name: library.name,
    roots: library.roots,
    excludeGlobs: library.excludeGlobs,
    maxDepth: library.maxDepth,
    followSymlinks: library.followSymlinks,
    scanHidden: library.scanHidden,
    hashStrategy: library.hashStrategy,
    mediaStrategy: library.mediaStrategy,
    previewStrategy: library.previewStrategy,
    updatedAt: library.updatedAt,
  }
}

export function toRuleSetPayload(set: RuntimeRuleSet) {
  return {
    id: set.id,
    name: set.name,
    description: set.description,
    dryRunDefault: set.dryRunDefault,
    collision: set.collision,
    builtin: set.builtin,
    enabled: set.enabled,
    priority: set.priority,
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
    rules: set.rules.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      priority: rule.priority,
      action: rule.action,
      match: rule.match,
      template: rule.template,
      extract: rule.extract,
      reason: rule.reason,
    })),
  }
}