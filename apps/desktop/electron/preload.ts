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

type MediaMergePlan = import('@nestify/shared').MediaMergePlan
type MediaMergePlanInput = import('@nestify/shared').MediaMergePlanInput
type MediaMergeProgress = import('@nestify/shared').MediaMergeProgress
type MediaMergeSelectedFile = import('@nestify/shared').MediaMergeSelectedFile
type MediaMergeTimeline = import('@nestify/shared').MediaMergeTimeline
type MediaMergeWaveform = import('@nestify/shared').MediaMergeWaveform
type MediaMergeDuration = import('@nestify/shared').MediaMergeDuration
type MediaMergePreviewProxy = import('@nestify/shared').MediaMergePreviewProxy
type MediaMergeImageSettings = import('@nestify/shared').MediaMergeImageSettings
type MediaMergeItem = import('@nestify/shared').MediaMergeItem

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
  appInfo: () => ipcRenderer.invoke('app.info'),
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
  /** 订阅索引同步事件：文件系统变更被 watcher 处理进 DB 后触发。 */
  onSyncUpdated: (listener: (payload: { libraryId: string; count: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { libraryId: string; count: number }) => listener(payload)
    ipcRenderer.on('sync.updated', handler)
    return () => {
      ipcRenderer.off('sync.updated', handler)
    }
  },
  scanStart: (input: { libraryId: string }) => ipcRenderer.invoke('scan.start', input),
  scanProgress: () => ipcRenderer.invoke('scan.progress'),
  scanPause: (input: { jobId: string }) => ipcRenderer.invoke('scan.pause', input),
  scanResume: (input: { jobId: string }) => ipcRenderer.invoke('scan.resume', input),
  scanCancel: (input: { jobId: string }) => ipcRenderer.invoke('scan.cancel', input),
  onPlanExecutionProgress: (listener: (progress: { module: 'rules' | 'organize' | 'rename' | 'duplicates'; status: 'running' | 'completed' | 'failed'; current: number; total: number; ok: number; skipped: number; failed: number; path: string | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
    ipcRenderer.on('plan.execution-progress', handler)
    return () => ipcRenderer.off('plan.execution-progress', handler)
  },
  onLibraryRemovalProgress: (listener: (progress: { jobId: string; libraryId: string; libraryName: string; status: 'queued' | 'running' | 'completed' | 'failed'; current: number; total: number; stage: string; error: string | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
    ipcRenderer.on('library.removal-progress', handler)
    return () => ipcRenderer.off('library.removal-progress', handler)
  },
  onDuplicateAnalysisProgress: (listener: (progress: { status: 'running' | 'completed' | 'failed'; phase: 'collecting' | 'quick-hash' | 'full-hash' | 'finalizing'; phaseCurrent: number; phaseTotal: number; percent: number; path: string | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
    ipcRenderer.on('duplicates.analysis-progress', handler)
    return () => ipcRenderer.off('duplicates.analysis-progress', handler)
  },
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
    parentId?: string
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
    groups?: Array<{ filter?: string; template: string }>
    scope?: 'library' | 'directory' | 'selection'
    entryIds?: string[]
    directory?: string
    filter?: string
    collision?: 'suffix' | 'skip' | 'overwrite'
  }) => ipcRenderer.invoke('rename.preview', input),
  planExecute: (input: { libraryId: string; plan: unknown; selectedOps?: number[] }) =>
    ipcRenderer.invoke('plan.execute', input),
  planRollback: (input: { jobId: string }) => ipcRenderer.invoke('plan.rollback', input),
  organizeSnapshot: (input: { libraryId: string; scope?: 'library' | 'directory' | 'selection'; entryIds?: string[]; directory?: string }) =>
    ipcRenderer.invoke('organize.snapshot', input),
  organizePreview: (input: { libraryId: string; rules: unknown[]; snapshotId?: string; scope?: 'library' | 'directory' | 'selection'; entryIds?: string[]; directory?: string; filter?: string; collision?: 'suffix' | 'skip' | 'overwrite' }) =>
    ipcRenderer.invoke('organize.preview', input),
  jobsList: (input?: { libraryId?: string; limit?: number }) => ipcRenderer.invoke('jobs.list', input),
  jobOps: (input: { jobId: string; offset?: number; limit?: number }) =>
    ipcRenderer.invoke('job.ops', input),
  duplicatesAnalyze: (input: {
    libraryId: string
    scope?: 'library' | 'directory' | 'selection'
    entryIds?: string[]
    directory?: string
    filter?: string
    hashStrategy?: 'on-demand' | 'duplicate-candidate-only' | 'all'
    keepStrategy?:
      | 'newest'
      | 'oldest'
      | 'shortest_path'
      | 'longest_path'
      | 'shortest_name'
      | 'longest_name'
      | 'name_quality'
      | 'preferred_dir'
  }) => ipcRenderer.invoke('duplicates.analyze', input),
  shellReveal: (input: { path: string }) => ipcRenderer.invoke('shell.reveal', input),
  shellOpen: (input: { path: string }) => ipcRenderer.invoke('shell.open', input),
  shellOpenExternal: (input: { url: string }) => ipcRenderer.invoke('shell.openExternal', input),
  clipboardWriteText: (input: { text: string }) => ipcRenderer.invoke('clipboard.writeText', input),
  fileRename: (input: { libraryId: string; path: string; name: string }) => ipcRenderer.invoke('file.rename', input),
  fileMove: (input: { libraryId: string; path: string; directory: string }) => ipcRenderer.invoke('file.move', input),
  fileDelete: (input: { libraryId: string; path: string }) => ipcRenderer.invoke('file.delete', input),
  logEvent: (event: string, details?: unknown) => ipcRenderer.invoke('log.event', { event, details }),
  previewFile: (input: { path: string }) => ipcRenderer.invoke('preview.file', input),
  mediaMergeSelectFiles: () => ipcRenderer.invoke('mediaMerge.selectFiles') as Promise<{ files: MediaMergeSelectedFile[] }>,
  mediaMergeBuildPlan: (input: MediaMergePlanInput) => ipcRenderer.invoke('mediaMerge.buildPlan', input),
  mediaMergeStart: (input: { plan: MediaMergePlan }) => ipcRenderer.invoke('mediaMerge.start', input),
  mediaMergeCancel: (input: { jobId: string }) => ipcRenderer.invoke('mediaMerge.cancel', input),
  mediaMergeResume: (input: { jobId: string }) => ipcRenderer.invoke('mediaMerge.resume', input),
  mediaMergeProgress: (input: { jobId: string }) => ipcRenderer.invoke('mediaMerge.progress', input),
  onMediaMergeProgress: (listener: (progress: MediaMergeProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: MediaMergeProgress) => listener(progress)
    ipcRenderer.on('mediaMerge.progress', handler)
    return () => ipcRenderer.off('mediaMerge.progress', handler)
  },
  mediaMergePreview: (input: { path: string; selectedPaths: string[] }) =>
    ipcRenderer.invoke('mediaMerge.preview', input),
  mediaMergeTimeline: (input: { path: string; selectedPaths: string[] }) =>
    ipcRenderer.invoke('mediaMerge.timeline', input) as Promise<MediaMergeTimeline>,
  mediaMergeWaveform: (input: { path: string; selectedPaths: string[] }) =>
    ipcRenderer.invoke('mediaMerge.waveform', input) as Promise<MediaMergeWaveform>,
  mediaMergeDuration: (input: { path: string; selectedPaths: string[] }) =>
    ipcRenderer.invoke('mediaMerge.duration', input) as Promise<MediaMergeDuration>,
  mediaMergePreviewProxy: (input: { path: string; selectedPaths: string[] }) =>
    ipcRenderer.invoke('mediaMerge.previewProxy', input) as Promise<MediaMergePreviewProxy>,
  mediaMergeImagePreview: (input: { items: MediaMergeItem[]; settings: MediaMergeImageSettings }) =>
    ipcRenderer.invoke('mediaMerge.imagePreview', input) as Promise<{
      src: string
      width: number
      height: number
      error: string | null
    }>,
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
