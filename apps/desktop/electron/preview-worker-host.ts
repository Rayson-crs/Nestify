import { getRuntime } from './runtime-host'
import { resolvePreviewWorker } from './paths'
import { PreviewWorkerClient } from './preview-worker-client'
import { appState } from './state'

export function getPreviewWorker(): PreviewWorkerClient {
  if (!appState.previewWorker) {
    const runtime = getRuntime()
    appState.previewWorker = new PreviewWorkerClient(
      resolvePreviewWorker(),
      runtime.paths.dbPath,
      runtime.paths.quarantineDir,
    )
  }
  return appState.previewWorker
}
