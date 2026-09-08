import { contextBridge, ipcRenderer } from 'electron'

type RuleDefinitionPayload = {
  id: string
  enabled: boolean
  priority: number
  action:
    | 'rename_dir'
    | 'flatten_dir'
    | 'rename_file'
    | 'move'
    | 'delete_to_quarantine'
  match?: unknown
  template?: string
  extract?: Record<string, { from: string }>
  reason?: string
}

type RuleSetPayload = {
  name: string
  description?: string
  dryRunDefault: boolean
  collision: 'suffix' | 'skip' | 'overwrite'
  rules: RuleDefinitionPayload[]
  id?: string
  enabled?: boolean
  priority?: number
}

const api = {
  libraryList: () => ipcRenderer.invoke('library.list'),
  libraryAdd: (input: { name: string; roots: string[] }) => ipcRenderer.invoke('library.add', input),
  libraryRemove: (input: { id: string }) => ipcRenderer.invoke('library.remove', input),
  pickDirectory: () => ipcRenderer.invoke('dialog.pickDirectory'),
  scanStart: (input: { libraryId: string }) => ipcRenderer.invoke('scan.start', input),
  scanProgress: (input?: { jobId?: string }) => ipcRenderer.invoke('scan.progress', input),
  scanPause: (input: { jobId: string }) => ipcRenderer.invoke('scan.pause', input),
  scanResume: (input: { jobId: string }) => ipcRenderer.invoke('scan.resume', input),
  scanCancel: (input: { jobId: string }) => ipcRenderer.invoke('scan.cancel', input),
  searchQuery: (input: {
    libraryId: string
    text: string
    limit?: number
    offset?: number
    kinds?: string[]
    scope?: 'library' | 'directory' | 'selection'
    directory?: string
    entryIds?: string[]
    sort?: { field: 'relevance' | 'mtime' | 'size' | 'path' | 'name'; direction?: 'asc' | 'desc' }
  }) => ipcRenderer.invoke('search.query', input),
  rulesList: () => ipcRenderer.invoke('rules.list'),
  rulesGet: (input: { id: string }) => ipcRenderer.invoke('rules.get', input),
  rulesCreate: (input: RuleSetPayload) => ipcRenderer.invoke('rules.create', input),
  rulesUpdate: (input: {
    id: string
    patch: Partial<Omit<RuleSetPayload, 'id' | 'enabled' | 'priority'>>
  }) => ipcRenderer.invoke('rules.update', input),
  rulesDelete: (input: { id: string }) => ipcRenderer.invoke('rules.delete', input),
  rulesEnable: (input: { id: string; enabled: boolean }) =>
    ipcRenderer.invoke('rules.enable', input),
  rulesPriority: (input: { id: string; priority: number }) =>
    ipcRenderer.invoke('rules.priority', input),
  rulesClone: (input: {
    sourceId: string
    name?: string
    priority?: number
    enabled?: boolean
  }) => ipcRenderer.invoke('rules.clone', input),
  rulesExport: (input: { id: string }) => ipcRenderer.invoke('rules.export', input),
  rulesImport: () => ipcRenderer.invoke('rules.import'),
  rulesPreview: (input: {
    libraryId: string
    ruleSetId: string
    scope?: 'library' | 'directory' | 'selection'
    entryIds?: string[]
    directory?: string
    collision?: 'suffix' | 'skip' | 'overwrite'
  }) => ipcRenderer.invoke('rules.preview', input),
  renamePreview: (input: {
    libraryId: string
    template: string
    scope?: 'library' | 'directory' | 'selection'
    entryIds?: string[]
    directory?: string
    collision?: 'suffix' | 'skip' | 'overwrite'
  }) => ipcRenderer.invoke('rename.preview', input),
  planExecute: (input: { libraryId: string; plan: unknown; selectedOps?: number[] }) =>
    ipcRenderer.invoke('plan.execute', input),
  planRollback: (input: { jobId: string }) => ipcRenderer.invoke('plan.rollback', input),
  jobsList: (input?: { libraryId?: string; limit?: number }) => ipcRenderer.invoke('jobs.list', input),
  jobOps: (input: { jobId: string }) => ipcRenderer.invoke('job.ops', input),
  duplicatesAnalyze: (input: {
    libraryId: string
    scope?: 'library' | 'directory' | 'selection'
    entryIds?: string[]
    directory?: string
    hashStrategy?: 'on-demand' | 'duplicate-candidate-only' | 'all'
    keepStrategy?: 'newest' | 'oldest' | 'shortest_path' | 'name_quality' | 'preferred_dir'
  }) => ipcRenderer.invoke('duplicates.analyze', input),
  shellReveal: (input: { path: string }) => ipcRenderer.invoke('shell.reveal', input),
  shellOpen: (input: { path: string }) => ipcRenderer.invoke('shell.open', input),
  previewFile: (input: { path: string }) => ipcRenderer.invoke('preview.file', input),
  previewThumbnail: (input: {
    libraryId: string
    entryId: string
    kind?: 'image' | 'video'
    width?: number
    height?: number
    size?: number
    priority?: 'selected' | 'visible' | 'background'
  }) => ipcRenderer.invoke('preview.thumbnail', input),
}

contextBridge.exposeInMainWorld('nestify', api)
