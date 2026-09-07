import { notImplemented, type ModuleContext, type ModuleDefinition, type ScanProgress, type ScanRequest, type ScanResult } from './types.ts'

export type { ScanResult }

export interface ScanController {
  execute(request: ScanRequest, ctx: ModuleContext): Promise<ScanResult>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(): Promise<void>
  progress(): Promise<ScanProgress>
}

export const scanModule: ModuleDefinition<ScanController> = {
  id: 'scan',
  createController() {
    return {
      execute(_request, _ctx) {
        return notImplemented('scan.execute')
      },
      pause() {
        return notImplemented('scan.pause')
      },
      resume() {
        return notImplemented('scan.resume')
      },
      cancel() {
        return notImplemented('scan.cancel')
      },
      progress() {
        return notImplemented('scan.progress')
      },
    }
  },
}
