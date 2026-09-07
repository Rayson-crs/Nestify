import {
  notImplemented,
  type DuplicateAnalyzeRequest,
  type KeepStrategy,
  type ModuleContext,
  type ModuleDefinition,
} from './types.ts'

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
