import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cancelSearch, directoryChildren, search, type HostContext } from './handlers.ts'

function createState() {
  let cancelled = 0
  const calls: Array<Record<string, unknown>> = []
  const state = {
    runtime: {},
    queryWorker: {
      cancel: () => { cancelled += 1 },
      hasPending: () => false,
    },
    searchRequestSeqByClient: new Map<string, number>(),
    query: () => ({
      search: async (options: Record<string, unknown>) => {
        calls.push(options)
        return {
          hits: [],
          total: 0,
          fileCount: 0,
          directoryCount: 0,
          kindCounts: {},
          hasMore: false,
          elapsedMs: 0,
        }
      },
    }),
  }
  return { state: state as unknown as HostContext, calls, getCancelled: () => cancelled }
}

test('search request sequences are isolated by renderer client', async () => {
  const { state, calls } = createState()

  await search(state, {
    libraryId: 'all',
    text: 'main query',
    searchClientId: 'main',
    requestSeq: 10,
    limit: 1,
  })
  await search(state, {
    libraryId: 'all',
    text: 'spotlight query',
    searchClientId: 'spotlight',
    requestSeq: 1,
    limit: 1,
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((call) => call.text), ['main query', 'spotlight query'])
})

test('a stale cancel does not invalidate a newer request from the same client', async () => {
  const { state, getCancelled } = createState()

  await search(state, {
    libraryId: 'all',
    text: 'newer',
    searchClientId: 'spotlight',
    requestSeq: 2,
    limit: 1,
  })
  const cancelled = cancelSearch(state, {
    searchClientId: 'spotlight',
    requestSeq: 1,
  })

  assert.equal(cancelled.cancelled, false)
  assert.equal(getCancelled(), 0)
})

test('a newer directory query replaces a pending directory query', async () => {
  const cancelledKinds: string[] = []
  const calls: Array<{ libraryId: string; directory: string }> = []
  const state = {
    runtime: {},
    queryWorker: {
      cancel: (kind: string) => cancelledKinds.push(kind),
      hasPending: (kind: string) => kind === 'directory',
    },
    searchRequestSeqByClient: new Map<string, number>(),
    query: () => ({
      directory: async (libraryId: string, directory: string) => {
        calls.push({ libraryId, directory })
        return { hits: [], total: 0, hasMore: false, elapsedMs: 0 }
      },
    }),
  }

  await directoryChildren(state as unknown as HostContext, {
    libraryId: 'library',
    directory: 'D:\\media',
  })

  assert.deepEqual(cancelledKinds, ['directory'])
  assert.deepEqual(calls, [{ libraryId: 'library', directory: 'D:\\media' }])
})
