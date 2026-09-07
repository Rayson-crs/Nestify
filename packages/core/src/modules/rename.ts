import {
  notImplemented,
  type ModuleContext,
  type ModuleDefinition,
  type RenamePreviewRequest,
} from './types.ts'

export interface RenamePlanRow {
  entryId: string
  from: string
  to: string
  reason?: string
  selected: boolean
}

export interface RenamePlan {
  rows: RenamePlanRow[]
  collisions: number
}

export interface RenameExecuteRequest extends RenamePreviewRequest {
  dryRun?: boolean
  selectedEntryIds?: string[]
}

export interface RenameController {
  preview(request: RenamePreviewRequest, ctx: ModuleContext): Promise<RenamePlan>
  execute(request: RenameExecuteRequest, ctx: ModuleContext): Promise<never>
}

export const renameModule: ModuleDefinition<RenameController> = {
  id: 'rename',
  createController() {
    return {
      preview(_request, _ctx) {
        return notImplemented('rename.preview')
      },
      execute(_request, _ctx) {
        return notImplemented('rename.execute')
      },
    }
  },
}
