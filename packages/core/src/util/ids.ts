import { createHash } from 'node:crypto'
import { asEntryId, asLibraryId, type EntryId, type LibraryId } from '@nestify/shared'

export function newLibraryId(seed?: string): LibraryId {
  const raw = seed ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return asLibraryId(createHash('sha1').update(raw).digest('hex').slice(0, 16))
}

export function entryIdFor(libraryId: string, path: string): EntryId {
  void libraryId
  return asEntryId(createHash('sha1').update(path).digest('hex'))
}
