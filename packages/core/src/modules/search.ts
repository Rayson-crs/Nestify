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
