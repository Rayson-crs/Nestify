import {
  notImplemented,
  type DuplicateAnalyzeRequest,
  type KeepStrategy,
  type ModuleContext,
  type ModuleDefinition,
} from './types.ts'
import type { NestifyRuntime } from '../app/runtime.ts'

export interface DuplicateGroup {
  id: string
  size: number
  hashQuick?: string
  hashFull?: string
  wastedBytes: number
  entryIds: string[]
}

export interface DuplicateAnalyzeResult {
  groups: DuplicateGroup[]
  keepStrategy: KeepStrategy
}

export interface DuplicateExecuteRequest extends DuplicateAnalyzeRequest {
  groupIds?: string[]
  dryRun?: boolean
}

export interface DuplicatesController {
  analyze(request: DuplicateAnalyzeRequest, ctx: ModuleContext): Promise<DuplicateAnalyzeResult>
  execute(request: DuplicateExecuteRequest, ctx: ModuleContext): Promise<never>
}

export const duplicatesModule: ModuleDefinition<DuplicatesController> = {
  id: 'duplicates',
  createController() {
    return {
      analyze(_request, _ctx) {
        return notImplemented('duplicates.analyze')
      },
      execute(_request, _ctx) {
        return notImplemented('duplicates.execute')
      },
    }
  },
}

export function createRuntimeDuplicatesController(runtime: NestifyRuntime): DuplicatesController {
  return {
    async analyze(request, ctx) {
      const result = await runtime.analyzeDuplicates({
        libraryId: ctx.libraryId,
        scope: request.scope,
        entryIds: request.entryIds,
        directory: request.directory,
        hashStrategy: request.hashStrategy,
        keepStrategy: request.keepStrategy,
      })
      return {
        keepStrategy: request.keepStrategy ?? 'newest',
        groups: result.groups.map((group) => ({
          id: group.id,
          size: group.size,
          hashFull: group.hash || undefined,
          wastedBytes: group.wastedBytes,
          entryIds: group.files.map((file) => file.entryId),
        })),
      }
    },
    execute(_request, _ctx) {
      return notImplemented('duplicates.execute')
    },
  }
}
