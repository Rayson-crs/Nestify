import { notImplemented, type ModuleContext, type ModuleDefinition, type OrganizeRequest } from './types.ts'
import type { ChangePlan } from '@nestify/shared'
import type { NestifyRuntime } from '../app/runtime.ts'
import type { OrganizePreview } from '../organize/types.ts'

export interface OrganizePlanRow {
  entryId: string
  from: string
  to?: string
  action: string
  ruleId: string
  risk: 'low' | 'conflict' | 'overwrite' | 'destructive'
  selected: boolean
}

export interface OrganizePlan {
  rules: NonNullable<OrganizeRequest['rules']>
  dryRun: boolean
  rows: OrganizePlanRow[]
  preview?: OrganizePreview
}

export interface OrganizeController {
  preview(request: OrganizeRequest, ctx: ModuleContext): Promise<OrganizePlan>
  execute(request: OrganizeRequest, ctx: ModuleContext): Promise<never>
}

export const organizeModule: ModuleDefinition<OrganizeController> = {
  id: 'organize',
  createController() {
    return {
      preview(_request, _ctx) {
        return notImplemented('organize.preview')
      },
      execute(_request, _ctx) {
        return notImplemented('organize.execute')
      },
    }
  },
}

export function createRuntimeOrganizeController(runtime: NestifyRuntime): OrganizeController {
  return {
    async preview(request, ctx) {
      const preview = runtime.previewOrganize({
        libraryId: ctx.libraryId,
        rules: request.rules,
        ruleSetId: request.profileId,
        snapshotId: request.snapshotId,
        scope: request.scope,
        entryIds: request.entryIds,
        directory: request.directory,
        collision: request.collision,
      })
      return toOrganizePlan(preview, request.rules ?? [], request.dryRun ?? true)
    },
    execute(_request, _ctx) {
      return notImplemented('organize.execute')
    },
  }
}

function toOrganizePlan(preview: OrganizePreview, rules: NonNullable<OrganizeRequest['rules']>, dryRun: boolean): OrganizePlan {
  const plan = preview.plan
  return {
    rules,
    dryRun,
    rows: plan.ops.flatMap((op) => op.entryId ? [{
      entryId: op.entryId,
      from: op.from,
      to: op.to ?? undefined,
      action: op.op,
      ruleId: op.ruleId ?? '',
      risk: organizeRisk(op.risk, op.op),
      selected: op.selected,
    }] : []),
    preview,
  }
}

function organizeRisk(risk: ChangePlan['ops'][number]['risk'], action: ChangePlan['ops'][number]['op']): OrganizePlan['rows'][number]['risk'] {
  if (action === 'quarantine' || action === 'delete') return 'destructive'
  if (risk === 'none') return 'low'
  if (risk === 'overwrite') return 'overwrite'
  return 'conflict'
}
