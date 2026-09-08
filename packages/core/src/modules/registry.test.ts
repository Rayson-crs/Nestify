import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { NestifyRuntime } from '../app/runtime.ts'
import { MODULE_CATALOG, ModuleRegistry, createRuntimeController, listModules } from './registry.ts'
import { MODULE_IDS } from './types.ts'

function createRuntimeFixture(): {
  runtime: NestifyRuntime
  root: string
  libraryId: string
  cleanup: () => void
} {
  const base = mkdtempSync(join(tmpdir(), 'nestify-module-runtime-'))
  const root = join(base, 'library')
  mkdirSync(root, { recursive: true })
  const webp = Buffer.alloc(16)
  webp.write('RIFF', 0)
  webp.writeUInt32LE(4, 4)
  webp.write('WEBP', 8)
  writeFileSync(join(root, '[4K]sample.webp'), webp)
  writeFileSync(join(root, 'same-a.txt'), 'same')
  writeFileSync(join(root, 'same-b.txt'), 'same')

  const runtime = new NestifyRuntime({ appDataRoot: join(base, 'appdata') })
  const library = runtime.addLibrary({ name: 'Modules', roots: [root] })
  return {
    runtime,
    root,
    libraryId: library.id,
    cleanup: () => {
      runtime.close()
      rmSync(base, { recursive: true, force: true })
    },
  }
}

describe('module registry', () => {
  it('lists the six modules with zh titles and worker names', () => {
    const modules = listModules()
    assert.equal(modules.length, 6)
    assert.deepEqual(
      modules.map((item) => item.id),
      [...MODULE_IDS],
    )
    assert.deepEqual(
      MODULE_CATALOG.map((item) => item.titleZh),
      ['建巢', '寻巢', '清巢', '精准雕琢', '透视眼', '筑巢'],
    )
    assert.deepEqual(
      MODULE_CATALOG.map((item) => item.workerName),
      ['scanner', 'query', 'hasher', 'rule-vm', 'thumbnail', 'planner'],
    )
  })

  it('createController execute methods reject with not_implemented', async () => {
    const registry = new ModuleRegistry()
    const scan = registry.createController('scan')
    await assert.rejects(() => scan.execute({ roots: ['D:/inbox'] }, { libraryId: 'lib-1' }), {
      message: 'not_implemented',
    })
    const organize = registry.createController('organize')
    await assert.rejects(
      () => organize.execute({ profileId: 'download-inbox' }, { libraryId: 'lib-1' }),
      { message: 'not_implemented' },
    )
  })

  it('runtime controllers delegate scan, search, plans, duplicates, and thumbnails', async () => {
    const context = createRuntimeFixture()
    try {
      const ctx = { libraryId: context.libraryId }
      const scan = createRuntimeController('scan', context.runtime)
      const scanResult = await scan.execute(
        { roots: [context.root], incremental: true, hashStrategy: 'duplicate-candidate-only' },
        ctx,
      )
      assert.equal(scanResult.filesScanned, 3)
      assert.equal((await scan.progress()).filesScanned, 3)

      const registrySearch = new ModuleRegistry(context.runtime).createController('search')
      const search = await registrySearch.execute(
        { query: 'sample', kinds: ['image'] },
        ctx,
      )
      assert.equal(search.total, 1)
      assert.equal(search.hits[0]?.name, '[4K]sample.webp')
      const imageEntryId = search.hits[0]!.entryId

      const organize = createRuntimeController('organize', context.runtime)
      const organizePlan = await organize.preview({ profileId: 'download-inbox' }, ctx)
      assert.equal(organizePlan.dryRun, true)
      assert.deepEqual(
        organizePlan.rows.map((row) => row.entryId),
        [imageEntryId],
      )
      assert.equal(organizePlan.rows[0]?.action, 'rename')

      const rename = createRuntimeController('rename', context.runtime)
      const renamePlan = await rename.preview(
        {
          template: '{stem}-renamed{ext}',
          match: { field: 'name', contains: 'sample' },
        },
        ctx,
      )
      assert.equal(renamePlan.rows.length, 1)
      assert.equal(renamePlan.rows[0]?.entryId, imageEntryId)
      assert.match(renamePlan.rows[0]?.to ?? '', /sample-renamed\.webp$/)

      const duplicates = createRuntimeController('duplicates', context.runtime)
      const duplicateResult = await duplicates.analyze({ keepStrategy: 'newest' }, ctx)
      assert.equal(duplicateResult.keepStrategy, 'newest')
      assert.equal(duplicateResult.groups.length, 1)
      assert.equal(duplicateResult.groups[0]?.entryIds.length, 2)

      const preview = createRuntimeController('preview', context.runtime)
      const thumbnail = await preview.execute(
        { entryId: imageEntryId, kind: 'image', priority: 'selected' },
        ctx,
      )
      assert.equal(thumbnail.entryId, imageEntryId)
      assert.equal(thumbnail.mime, 'image/webp')
      assert.ok(thumbnail.cachePath)
      assert.equal(existsSync(thumbnail.cachePath), true)

      await assert.rejects(() => duplicates.execute({ dryRun: true }, ctx), {
        message: 'not_implemented',
      })
    } finally {
      context.cleanup()
    }
  })
})
