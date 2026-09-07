import { notImplemented, type ModuleContext, type ModuleDefinition, type OrganizeRequest } from './types.ts'

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
  profileId: string
  dryRun: boolean
  rows: OrganizePlanRow[]
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
