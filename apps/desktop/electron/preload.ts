import { contextBridge, ipcRenderer } from 'electron'

const api = {
  libraryList: () => ipcRenderer.invoke('library.list'),
  libraryAdd: (input: { name: string; roots: string[] }) => ipcRenderer.invoke('library.add', input),
  libraryRemove: (input: { id: string }) => ipcRenderer.invoke('library.remove', input),
  pickDirectory: () => ipcRenderer.invoke('dialog.pickDirectory'),
  scanStart: (input: { libraryId: string }) => ipcRenderer.invoke('scan.start', input),
  scanProgress: (input?: { jobId?: string }) => ipcRenderer.invoke('scan.progress', input),
  searchQuery: (input: { libraryId: string; text: string; limit?: number }) =>
    ipcRenderer.invoke('search.query', input),
  rulesList: () => ipcRenderer.invoke('rules.list'),
  rulesPreview: (input: {
    libraryId: string
    ruleSetId: string
    collision?: 'suffix' | 'skip' | 'overwrite'
  }) => ipcRenderer.invoke('rules.preview', input),
  renamePreview: (input: {
    libraryId: string
    template: string
    collision?: 'suffix' | 'skip' | 'overwrite'
  }) => ipcRenderer.invoke('rename.preview', input),
  planExecute: (input: { libraryId: string; plan: unknown; selectedOps?: number[] }) =>
    ipcRenderer.invoke('plan.execute', input),
  planRollback: (input: { jobId: string }) => ipcRenderer.invoke('plan.rollback', input),
  jobsList: (input?: { libraryId?: string; limit?: number }) => ipcRenderer.invoke('jobs.list', input),
  jobOps: (input: { jobId: string }) => ipcRenderer.invoke('job.ops', input),
  duplicatesAnalyze: (input: {
    libraryId: string
    keepStrategy?: 'newest' | 'oldest' | 'shortest_path'
  }) => ipcRenderer.invoke('duplicates.analyze', input),
  shellReveal: (input: { path: string }) => ipcRenderer.invoke('shell.reveal', input),
  shellOpen: (input: { path: string }) => ipcRenderer.invoke('shell.open', input),
  previewFile: (input: { path: string }) => ipcRenderer.invoke('preview.file', input),
}

contextBridge.exposeInMainWorld('nestify', api)
