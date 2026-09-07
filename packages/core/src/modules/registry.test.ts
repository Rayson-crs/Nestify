import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MODULE_CATALOG, ModuleRegistry, listModules } from './registry.ts'
import { MODULE_IDS } from './types.ts'

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
})
