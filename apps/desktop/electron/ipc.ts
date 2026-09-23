import { registerFileOperationsIpc } from './file-operations-ipc'
import { registerLibraryIpc } from './library-ipc'
import { registerMediaMergeIpc } from './media-merge-ipc'
import { registerPlanIpc } from './plan-ipc'
import { registerPreviewIpc } from './preview-ipc'
import { registerRulesIpc } from './rules-ipc'
import { registerScanSearchIpc } from './scan-search-ipc'
import { registerSettingsIpc } from './settings-ipc'
import { appState } from './state'
import { registerWindowIpc } from './window-ipc'

export function registerIpc(): void {
  if (appState.ipcRegistered) return
  appState.ipcRegistered = true
  registerLibraryIpc()
  registerSettingsIpc()
  registerWindowIpc()
  registerScanSearchIpc()
  registerRulesIpc()
  registerPlanIpc()
  registerFileOperationsIpc()
  registerPreviewIpc()
  registerMediaMergeIpc()
}
