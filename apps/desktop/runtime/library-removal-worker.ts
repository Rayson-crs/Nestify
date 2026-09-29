import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { unlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { removeLibraryData } from '@nestify/core'

const port = parentPort
if (!port) throw new Error('library-removal-worker requires a worker parent port')

const dbPath = workerData?.dbPath
const libraryId = workerData?.libraryId
const preserveJobId = workerData?.preserveJobId
const thumbnailsDir = workerData?.thumbnailsDir
if (
  typeof dbPath !== 'string' || dbPath.length === 0 ||
  typeof libraryId !== 'string' || libraryId.length === 0 ||
  typeof preserveJobId !== 'string' || preserveJobId.length === 0 ||
  typeof thumbnailsDir !== 'string' || thumbnailsDir.length === 0
) {
  throw new Error('library-removal-worker received invalid worker data')
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000; PRAGMA synchronous = NORMAL;')

function isInsideDirectory(directory: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const relativePath = relative(resolve(directory), resolve(candidate))
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

async function removeCacheFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    if (!isInsideDirectory(thumbnailsDir, path)) continue
    await unlink(path).catch(() => undefined)
  }

  const orphanRows = db.prepare(
    `SELECT t.path
     FROM thumbnails t
     LEFT JOIN entries e ON e.id = t.entry_id
     WHERE e.id IS NULL`,
  ).all() as Array<{ path: string }>
  for (const row of orphanRows) {
    if (!isInsideDirectory(thumbnailsDir, row.path)) continue
    await unlink(row.path).catch(() => undefined)
  }

  while (true) {
    const changes = Number(
      db.prepare(
        `DELETE FROM thumbnails
         WHERE rowid IN (
           SELECT rowid
           FROM thumbnails
           WHERE entry_id NOT IN (SELECT id FROM entries)
           LIMIT 500
         )`,
      ).run().changes,
    )
    if (changes === 0) break
  }
}

try {
  const cacheRows = db.prepare(
    `SELECT t.path
     FROM thumbnails t
     JOIN entries e ON e.id = t.entry_id
     WHERE e.library_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM library_entries other_membership
         WHERE other_membership.entry_id = e.id
           AND other_membership.library_id <> ?
           AND other_membership.tombstone = 0
       )`,
  ).all(libraryId, libraryId) as Array<{ path: string }>
  removeLibraryData(db, libraryId, {
    preserveJobId,
    onProgress: ({ stage, current, total }) => {
      const ratio = total > 0 ? Math.min(1, current / total) : 1
      port.postMessage({
        type: 'progress',
        stage,
        current: 3 + Math.min(96, Math.floor(ratio * 96)),
        total: 100,
      })
    },
  })
  port.postMessage({ type: 'progress', stage: '清理孤立缩略图缓存', current: 99, total: 100 })
  await removeCacheFiles(cacheRows.map((row) => row.path))
  port.postMessage({ type: 'completed' })
} catch (error) {
  port.postMessage({
    type: 'failed',
    error: error instanceof Error ? error.message : String(error),
  })
} finally {
  db.close()
  port.close()
}
