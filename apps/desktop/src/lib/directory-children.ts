import { callNestify, type NestifyApi, type SearchHit, type SearchSort } from '@/lib/ipc'

export const DIRECTORY_CHILDREN_PAGE_SIZE = 200

export async function fetchAllDirectoryChildren(
  input: {
    libraryId: string
    directory: string
    parentId?: string
    sort?: SearchSort
  },
  options?: {
    pageSize?: number
    shouldAbort?: () => boolean
    onPage?: (hits: SearchHit[], total: number) => void
  },
): Promise<{ hits: SearchHit[]; total: number }> {
  const pageSize = options?.pageSize ?? DIRECTORY_CHILDREN_PAGE_SIZE
  const hits: SearchHit[] = []
  let offset = 0
  let total = 0

  while (true) {
    if (options?.shouldAbort?.()) return { hits, total }
    const { result } = await callNestify((api: NestifyApi) =>
      api.directoryChildren({
        libraryId: input.libraryId,
        directory: input.directory,
        parentId: input.parentId,
        sort: input.sort,
        limit: pageSize,
        offset,
      }),
    )
    if (options?.shouldAbort?.()) return { hits, total }
    hits.push(...result.hits)
    total = result.total
    options?.onPage?.(hits, total)
    if (!result.hasMore || result.hits.length === 0) break
    offset += result.hits.length
  }

  return { hits, total }
}
