import {
  createRuntimeDuplicatesController,
  duplicatesModule,
  type DuplicatesController,
} from './duplicates.ts'
import {
  createRuntimeOrganizeController,
  organizeModule,
  type OrganizeController,
} from './organize.ts'
import {
  createRuntimePreviewController,
  previewModule,
  type PreviewController,
} from './preview.ts'
import {
  createRuntimeRenameController,
  renameModule,
  type RenameController,
} from './rename.ts'
import { createRuntimeScanController, scanModule, type ScanController } from './scan.ts'
import {
  createRuntimeSearchController,
  searchModule,
  type SearchController,
} from './search.ts'
import type { ModuleDefinition, ModuleId } from './types.ts'
import type { NestifyRuntime } from '../app/runtime.ts'

export { MODULE_IDS } from './types.ts'

export interface ModuleDescriptor {
  id: ModuleId
  titleZh: string
  workerName: string
}

export const MODULE_CATALOG: readonly ModuleDescriptor[] = [
  { id: 'scan', titleZh: '建巢', workerName: 'scanner' },
  { id: 'search', titleZh: '寻巢', workerName: 'query' },
  { id: 'duplicates', titleZh: '清巢', workerName: 'hasher' },
  { id: 'rename', titleZh: '精准雕琢', workerName: 'rule-vm' },
  { id: 'preview', titleZh: '透视眼', workerName: 'thumbnail' },
  { id: 'organize', titleZh: '筑巢', workerName: 'planner' },
]

export type ModuleControllers = {
  scan: ScanController
  search: SearchController
  duplicates: DuplicatesController
  rename: RenameController
  preview: PreviewController
  organize: OrganizeController
}

const definitions = {
  scan: scanModule,
  search: searchModule,
  duplicates: duplicatesModule,
  rename: renameModule,
  preview: previewModule,
  organize: organizeModule,
} satisfies { [K in ModuleId]: ModuleDefinition<ModuleControllers[K]> }

export class ModuleRegistry {
  readonly descriptors = MODULE_CATALOG
  private readonly runtime?: NestifyRuntime

  constructor(runtime?: NestifyRuntime) {
    this.runtime = runtime
  }

  list(): readonly ModuleDescriptor[] {
    return MODULE_CATALOG
  }

  get(id: ModuleId): ModuleDescriptor {
    const found = MODULE_CATALOG.find((item) => item.id === id)
    if (!found) {
      throw new Error(`unknown module: ${id}`)
    }
    return found
  }

  createController<K extends ModuleId>(id: K): ModuleControllers[K] {
    if (this.runtime) return this.createRuntimeController(id, this.runtime)
    return definitions[id].createController() as ModuleControllers[K]
  }

  createRuntimeController<K extends ModuleId>(id: K, runtime: NestifyRuntime): ModuleControllers[K] {
    switch (id) {
      case 'scan':
        return createRuntimeScanController(runtime) as ModuleControllers[K]
      case 'search':
        return createRuntimeSearchController(runtime) as ModuleControllers[K]
      case 'duplicates':
        return createRuntimeDuplicatesController(runtime) as ModuleControllers[K]
      case 'rename':
        return createRuntimeRenameController(runtime) as ModuleControllers[K]
      case 'preview':
        return createRuntimePreviewController(runtime) as ModuleControllers[K]
      case 'organize':
        return createRuntimeOrganizeController(runtime) as ModuleControllers[K]
    }
  }
}

export const moduleRegistry = new ModuleRegistry()

export function listModules(): readonly ModuleDescriptor[] {
  return moduleRegistry.list()
}

export function createRuntimeController<K extends ModuleId>(
  id: K,
  runtime: NestifyRuntime,
): ModuleControllers[K] {
  return new ModuleRegistry(runtime).createRuntimeController(id, runtime)
}
