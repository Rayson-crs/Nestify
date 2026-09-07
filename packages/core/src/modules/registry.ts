import { duplicatesModule, type DuplicatesController } from './duplicates.ts'
import { organizeModule, type OrganizeController } from './organize.ts'
import { previewModule, type PreviewController } from './preview.ts'
import { renameModule, type RenameController } from './rename.ts'
import { scanModule, type ScanController } from './scan.ts'
import { searchModule, type SearchController } from './search.ts'
import type { ModuleDefinition, ModuleId } from './types.ts'

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
    return definitions[id].createController() as ModuleControllers[K]
  }
}

export const moduleRegistry = new ModuleRegistry()

export function listModules(): readonly ModuleDescriptor[] {
  return moduleRegistry.list()
}
