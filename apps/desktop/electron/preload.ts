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

type UiEvent = 'window:close-requested' | 'spotlight:open'

const api = {
  libraryList: () => ipcRenderer.invoke('library.list'),
  libraryAdd: (input: { name: string; roots: string[] }) => ipcRenderer.invoke('library.add', input),
  libraryUpdate: (input: {
    id: string
    patch: {
      name?: string
      roots?: string[]
      excludeGlobs?: string[]
      maxDepth?: number | null
      followSymlinks?: boolean
      scanHidden?: boolean
      hashStrategy?: 'off' | 'on-demand' | 'duplicate-candidate-only' | 'all'
      mediaStrategy?: 'off' | 'standard' | 'deep'
      previewStrategy?: 'off' | 'standard' | 'on-demand' | 'visible' | 'eager'
    }
  }) => ipcRenderer.invoke('library.update', input),
  libraryRemove: (input: { id: string }) => ipcRenderer.invoke('library.remove', input),
  pickDirectory: () => ipcRenderer.invoke('dialog.pickDirectory'),
  listDriveRoots: () => ipcRenderer.invoke('system.list-drive-roots'),
  minimizeToTray: () => ipcRenderer.invoke('window.minimize-to-tray'),
  quitApp: () => ipcRenderer.invoke('window.quit'),
  settingsGet: () => ipcRenderer.invoke('settings.get'),
  settingsUpdate: (input: Record<string, unknown>) => ipcRenderer.invoke('settings.update', input),
  openSpotlight: () => ipcRenderer.invoke('window.open-spotlight'),
  closeSpotlight: () => ipcRenderer.invoke('window.close-spotlight'),
  resizeSpotlight: (input: { height: number }) => ipcRenderer.invoke('window.resize-spotlight', input),
  onUiEvent: (listener: (event: UiEvent) => void) => {
    const closeListener = () => listener('window:close-requested')
    const spotlightListener = () => listener('spotlight:open')
    ipcRenderer.on('window:close-requested', closeListener)
    ipcRenderer.on('ui:spotlight-open', spotlightListener)
    return () => {
      ipcRenderer.off('window:close-requested', closeListener)
      ipcRenderer.off('ui:spotlight-open', spotlightListener)
    }
  },
  scanStart: (input: { libraryId: string }) => ipcRenderer.invoke('scan.start', input),
  scanProgress: () => ipcRenderer.invoke('scan.progress'),
  scanPause: (input: { jobId: string }) => ipcRenderer.invoke('scan.pause', input),
  scanResume: (input: { jobId: string }) => ipcRenderer.invoke('scan.resume', input),
  scanCancel: (input: { jobId: string }) => ipcRenderer.invoke('scan.cancel', input),
  searchCancel: () => ipcRenderer.invoke('search.cancel'),
  searchQuery: (input: {
    libraryId: string
    text: string
    textMode?: 'full-text' | 'substring'
    limit?: number
    offset?: number
    cursor?: string
    resultMode?: 'hits-only' | 'hits-and-approximate-count' | 'hits-and-exact-stats'
    kinds?: string[]
    scope?: 'library' | 'directory' | 'selection'
    directory?: string
    directChildren?: boolean
    entryIds?: string[]
    sort?: {
      field: 'relevance' | 'mtime' | 'size' | 'path' | 'name' | 'path_mtime'
      direction?: 'asc' | 'desc'
    }
  }) => ipcRenderer.invoke('search.query', input),
  directoryChildren: (input: {
    libraryId: string
    directory: string
    limit?: number
    offset?: number
    sort?: {
      field: 'relevance' | 'mtime' | 'size' | 'path' | 'name' | 'path_mtime'
      direction?: 'asc' | 'desc'
    }
  }) => ipcRenderer.invoke('directory.children', input),
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
  clipboardWriteText: (input: { text: string }) => ipcRenderer.invoke('clipboard.writeText', input),
  fileRename: (input: { libraryId: string; path: string; name: string }) => ipcRenderer.invoke('file.rename', input),
  fileMove: (input: { libraryId: string; path: string; directory: string }) => ipcRenderer.invoke('file.move', input),
  fileDelete: (input: { libraryId: string; path: string }) => ipcRenderer.invoke('file.delete', input),
  logEvent: (event: string, details?: unknown) => ipcRenderer.invoke('log.event', { event, details }),
  previewFile: (input: { path: string }) => ipcRenderer.invoke('preview.file', input),
  previewThumbnail: (
    input: {
      libraryId: string
      entryId: string
      kind?: 'image' | 'video'
      width?: number
      height?: number
      size?: number
      priority?: 'selected' | 'visible' | 'background'
    },
    options?: { signal?: AbortSignal },
  ) => {
    if (!options?.signal) return ipcRenderer.invoke('preview.thumbnail', input)

    const requestId = `thumbnail-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const request = ipcRenderer.invoke('preview.thumbnail', { ...input, requestId })
    let settled = false
    const cancel = () => {
      if (settled) return
      void ipcRenderer.invoke('preview.thumbnail.cancel', { requestId }).catch(() => undefined)
    }
    const onAbort = () => cancel()
    options.signal.addEventListener('abort', onAbort, { once: true })
    if (options.signal.aborted) cancel()

    return request.finally(() => {
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
    })
  },
}

contextBridge.exposeInMainWorld('nestify', api)
