import { notImplemented, type ModuleContext, type ModuleDefinition, type ThumbnailRequest } from './types.ts'

export interface ThumbnailResult {
  entryId: string
  cachePath?: string
  mime?: string
  fallbackIcon?: string
}

export interface PreviewController {
  execute(request: ThumbnailRequest, ctx: ModuleContext): Promise<ThumbnailResult>
  cancel(entryId: string): Promise<void>
}

export const previewModule: ModuleDefinition<PreviewController> = {
  id: 'preview',
  createController() {
    return {
      execute(_request, _ctx) {
        return notImplemented('preview.execute')
      },
      cancel(_entryId) {
        return notImplemented('preview.cancel')
      },
    }
  },
}
