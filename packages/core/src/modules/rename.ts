import {
  notImplemented,
  type ModuleContext,
  type ModuleDefinition,
  type RenamePreviewRequest,
} from './types.ts'
import type { ChangePlan } from '@nestify/shared'
import type { MatchTree } from '@nestify/rules'
import type { NestifyRuntime } from '../app/runtime.ts'

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

export function createRuntimeRenameController(runtime: NestifyRuntime): RenameController {
  return {
    async preview(request, ctx) {
      const plan = runtime.previewRename({
        libraryId: ctx.libraryId,
        template: request.template,
        groups: request.groups,
        match: parseMatchTree(request.match),
        scope: request.scope,
        entryIds: request.entryIds,
        directory: request.directory,
        filter: request.filter,
        collision: request.collision,
      })
      return toRenamePlan(plan)
    },
    execute(_request, _ctx) {
      return notImplemented('rename.execute')
    },
  }
}

function parseMatchTree(value: unknown): MatchTree | undefined {
  if (value === undefined) return undefined
  if (!isMatchTree(value)) throw new Error('rename match must be a MatchTree')
  return value
}

function isMatchTree(value: unknown): value is MatchTree {
  if (!value || typeof value !== 'object') return false
  const match = value as Record<string, unknown>
  if (Array.isArray(match.all)) return match.all.every(isMatchTree)
  if (Array.isArray(match.any)) return match.any.every(isMatchTree)
  if ('not' in match) return isMatchTree(match.not)
  return typeof match.field === 'string'
}

function toRenamePlan(plan: ChangePlan): RenamePlan {
  return {
    rows: plan.ops
      .filter((op) => op.op === 'rename' && op.entryId && op.to)
      .map((op) => ({
        entryId: op.entryId!,
        from: op.from,
        to: op.to!,
        reason: op.reason,
        selected: op.selected,
      })),
    collisions: plan.ops.filter((op) => op.risk !== 'none' || !op.to).length,
  }
}
