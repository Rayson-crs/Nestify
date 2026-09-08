import type { NestifyRuntime } from '../app/runtime.ts'
import { notImplemented, type ModuleContext, type ModuleDefinition, type SearchRequest } from './types.ts'

export interface SearchHit {
  entryId: string
  name: string
  path: string
  ext?: string
  parent?: string
  kind?: string
  size?: number
  mtime?: number
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  elapsedMs: number
}

export interface SearchController {
  execute(request: SearchRequest, ctx: ModuleContext): Promise<SearchResult>
}

export const searchModule: ModuleDefinition<SearchController> = {
  id: 'search',
  createController() {
    return {
      execute(_request, _ctx) {
        return notImplemented('search.execute')
      },
    }
  },
}

export function createRuntimeSearchController(runtime: NestifyRuntime): SearchController {
  return {
    async execute(request, ctx) {
      const result = runtime.search(ctx.libraryId, request.query, {
        limit: request.limit,
        offset: request.offset,
        kinds: request.kinds,
      })
      return {
        ...result,
        hits: result.hits.map((hit) => ({
          ...hit,
          ext: hit.ext ?? undefined,
          parent: hit.parent ?? undefined,
          kind: hit.kind ?? undefined,
          size: hit.size ?? undefined,
          mtime: hit.mtime ?? undefined,
        })),
      }
    },
  }
}
