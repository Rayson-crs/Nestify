import type {
  ChangePlan,
  Collision,
  DuplicateGroup,
  DuplicateHashStrategy,
  DuplicateProgress,
  DuplicateScope,
  ExecutionProgress,
  FilePreview,
  JobOpsPage,
  JobRecord,
  KeepStrategy,
  LibraryPatchInput,
  LibraryRemovalProgress,
  LibrarySummary,
  MediaMergeDuration,
  MediaMergeImageSettings,
  MediaMergeItem,
  MediaMergePlan,
  MediaMergePlanInput,
  MediaMergePreviewProxy,
  MediaMergeProgress,
  MediaMergeSelectedFile,
  MediaMergeTimeline,
  MediaMergeWaveform,
  NestifyApi,
  NestifySettings,
  NestifyUiEvent,
  OrganizePreviewPayload,
  OrganizeRuleInput,
  OrganizeSnapshotPayload,
  PlanScopeInput,
  RuleSetCreateInput,
  RuleSetPatchInput,
  RuleSetSummary,
  ScanFinishedPayload,
  ScanProgress,
  SearchQueryInput,
  SearchResult,
  SearchSort,
  ThumbnailPreviewRequest,
  ThumbnailPreviewResult,
} from './ipc'
import type { ExecutionModule } from '@nestify/shared'

type TauriEvent = {
  payload?: unknown
}

type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>
  transformCallback: (callback: (event: TauriEvent) => void, once?: boolean) => number
}

type FileFilter = {
  name: string
  extensions: string[]
}

type SidecarMeta = {
  port: number
  mediaBase: string
}

const MEDIA_PREFIX = 'nestify-media://preview/?path='
const THUMBNAIL_PREFIX = 'nestify-thumbnail://cache/'
const NOT_READY = 'Nestify IPC \u672a\u5c31\u7eea\u3002\u8bf7\u4ece Nestify \u684c\u9762\u7aef\u542f\u52a8\uff0c\u800c\u4e0d\u662f\u5355\u72ec\u6253\u5f00\u7f51\u9875\u3002'

let mediaBase: string | null = null
let metaPromise: Promise<SidecarMeta | null> | null = null

type SidecarBusEvent = {
  event: string
  payload: unknown
}
type SidecarBusListener = (payload: unknown) => void
const sidecarBusListeners = new Map<string, Set<SidecarBusListener>>()
let stopSidecarBus: (() => void) | null = null

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
    __NESTIFY_MEDIA_BASE__?: string
  }
}

export function installNestifyHost(): void {
  if (typeof window === 'undefined') return
  window.nestify = createApi()
  if (!window.__TAURI_INTERNALS__) return
  ensureSidecarBus()
  void bootstrap()
}

export function mediaFileUrl(path: string): string {
  const encoded = encodeURIComponent(path)
  return mediaBase ? `${mediaBase}/media?path=${encoded}` : `${MEDIA_PREFIX}${encoded}`
}

function createApi(): NestifyApi {
  return {
    settingsGet: () => sidecar<NestifySettings>('settings.get'),
    settingsUpdate: (input) => sidecar<NestifySettings>('settings.update', input),
    settingsTestFfmpeg: (input) => sidecar('settings.testFfmpeg', input),
    appInfo: () => sidecar('app.info'),
    logsPath: (input) => sidecar<{ path: string }>('logs.path', input ?? {}),
    libraryList: () => sidecar<{ libraries: LibrarySummary[] }>('library.list'),
    libraryAdd: (input) => sidecar<{ library: LibrarySummary }>('library.add', input),
    libraryUpdate: (input: { id: string; patch: LibraryPatchInput }) =>
      sidecar<{ library: LibrarySummary }>('library.update', input),
    libraryRemove: (input) => sidecar<{ ok: true; jobId: string }>('library.remove', input),
    libraryRemovalProgress: (input) => sidecar<LibraryRemovalProgress>('library.removalProgress', input),
    pickDirectory: () => pickDirectory(),
    listDriveRoots: () => sidecar<{ roots: string[] }>('system.list-drive-roots'),
    minimizeToTray: () => commandOk('window_minimize_to_tray'),
    quitApp: () => commandOk('window_quit'),
    openSpotlight: () => commandOk('window_open_spotlight'),
    closeSpotlight: () => commandOk('window_close_spotlight'),
    resizeSpotlight: (input) => commandOk('window_resize_spotlight', { height: input.height }),
    onUiEvent: (listener) => listenUi(listener),
    onSyncUpdated: (listener) => listenPayload('sync.updated', listener),
    onPlanExecutionProgress: (listener) => listenPayload('plan.execution-progress', listener),
    onLibraryRemovalProgress: (listener) => listenPayload('library.removal-progress', listener),
    onDuplicateAnalysisProgress: (listener) => listenPayload('duplicates.analysis-progress', listener),
    onScanProgress: (listener) => listenPayload('scan.progress', listener),
    onScanFinished: (listener) => listenPayload<ScanFinishedPayload>('scan.finished', listener),
    scanStart: (input) => sidecar('scan.start', input),
    scanProgress: () => sidecar<ScanProgress>('scan.progress'),
    scanPause: (input) => sidecar('scan.pause', input),
    scanResume: (input) => sidecar('scan.resume', input),
    scanCancel: (input) => sidecar('scan.cancel', input),
    searchCancel: (input) => sidecar<{ cancelled: boolean }>('search.cancel', input ?? {}),
    searchQuery: (input: SearchQueryInput) => sidecar<{ result: SearchResult }>('search.query', input),
    directoryChildren: (input: {
      libraryId: string
      directory: string
      parentId?: string
      limit?: number
      offset?: number
      sort?: SearchSort
    }) => sidecar('directory.children', input),
    rulesList: () => sidecar<{ ruleSets: RuleSetSummary[] }>('rules.list'),
    rulesGet: (input) => sidecar<{ ruleSet: RuleSetSummary }>('rules.get', input),
    rulesCreate: (input: RuleSetCreateInput) => sidecar<{ ruleSet: RuleSetSummary }>('rules.create', input),
    rulesUpdate: (input: { id: string; patch: RuleSetPatchInput }) =>
      sidecar<{ ruleSet: RuleSetSummary }>('rules.update', input),
    rulesDelete: (input) => sidecar<{ ok: true }>('rules.delete', input),
    rulesEnable: (input) => sidecar<{ ruleSet: RuleSetSummary }>('rules.enable', input),
    rulesPriority: (input) => sidecar<{ ruleSet: RuleSetSummary }>('rules.priority', input),
    rulesClone: (input) => sidecar<{ ruleSet: RuleSetSummary }>('rules.clone', input),
    rulesExport: (input) => exportRules(input.id),
    rulesImport: () => importRules(),
    rulesPreview: (input: PlanScopeInput & { libraryId: string; ruleSetId: string; collision?: Collision }) =>
      sidecar<{ plan: ChangePlan }>('rules.preview', input),
    renamePreview: (input) => sidecar<{ plan: ChangePlan }>('rename.preview', input),
    planExecute: (input: { libraryId: string; plan: ChangePlan; selectedOps?: number[]; module?: ExecutionModule }) =>
      sidecar('plan.execute', input),
    planRollback: (input) => sidecar('plan.rollback', input),
    planProgress: () => sidecar<ExecutionProgress | null>('plan.progress'),
    organizeSnapshot: (input) => sidecar<{ snapshot: OrganizeSnapshotPayload }>('organize.snapshot', input),
    organizePreview: (input: {
      libraryId: string
      rules: OrganizeRuleInput[]
      snapshotId?: string
      scope?: 'library' | 'directory' | 'selection'
      entryIds?: string[]
      directory?: string
      filter?: string
      collision?: Collision
    }) => sidecar<{ preview: OrganizePreviewPayload }>('organize.preview', input),
    jobsList: (input?: { libraryId?: string; limit?: number }) =>
      sidecar<{ jobs: JobRecord[] }>('jobs.list', input ?? {}),
    jobsClear: (input?: { libraryId?: string }) =>
      sidecar<{ deleted: number; retainedActive: number }>('jobs.clear', input ?? {}),
    jobOps: (input: { jobId: string; offset?: number; limit?: number }) => sidecar<JobOpsPage>('job.ops', input),
    duplicatesAnalyze: (input: {
      libraryId: string
      scope?: DuplicateScope
      entryIds?: string[]
      directory?: string
      filter?: string
      hashStrategy?: DuplicateHashStrategy
      keepStrategy?: KeepStrategy
      dispose?: 'quarantine' | 'delete'
    }) => sidecar<{ groups: DuplicateGroup[]; plan: ChangePlan }>('duplicates.analyze', input),
    duplicateProgress: () => sidecar<DuplicateProgress | null>('duplicates.progress'),
    shellReveal: (input) => commandOk('shell_reveal', { path: input.path }),
    shellOpen: (input) => commandOk('shell_open_path', { path: input.path }),
    shellOpenExternal: (input) => commandOk('shell_open_external', { url: input.url }),
    clipboardWriteText: (input) => commandOk('clipboard_write_text', { text: input.text }),
    fileRename: (input) => sidecar<{ ok: true }>('file.rename', input),
    fileMove: (input) => sidecar<{ ok: true }>('file.move', input),
    fileDelete: (input) => sidecar<{ ok: true }>('file.delete', input),
    onFileOperationProgress: (listener) => listenPayload('file.operation-progress', listener),
    logEvent: (event, details, level) => sidecar<{ ok: true }>('log.event', { event, details, level }),
    previewFile: (input) => sidecar<FilePreview>('preview.file', input),
    mediaMergeSelectFiles: () => selectMediaFiles(),
    mediaMergeBuildPlan: (input: MediaMergePlanInput) => sidecar<MediaMergePlan>('mediaMerge.buildPlan', input),
    mediaMergeStart: (input) => sidecar('mediaMerge.start', input),
    mediaMergeCancel: (input) => sidecar('mediaMerge.cancel', input),
    mediaMergeResume: (input) => sidecar<MediaMergeProgress>('mediaMerge.resume', input),
    mediaMergeProgress: (input) => sidecar<MediaMergeProgress>('mediaMerge.progress', input),
    onMediaMergeProgress: (listener) => listenPayload('mediaMerge.progress', listener),
    mediaMergePreview: (input) => sidecar<FilePreview>('mediaMerge.preview', input),
    mediaMergeTimeline: (input) => sidecar<MediaMergeTimeline>('mediaMerge.timeline', input),
    mediaMergeWaveform: (input) => sidecar<MediaMergeWaveform>('mediaMerge.waveform', input),
    mediaMergeDuration: (input) => sidecar<MediaMergeDuration>('mediaMerge.duration', input),
    mediaMergePreviewProxy: (input) => sidecar<MediaMergePreviewProxy>('mediaMerge.previewProxy', input),
    mediaMergeImagePreview: (input: { items: MediaMergeItem[]; settings: MediaMergeImageSettings }) =>
      sidecar('mediaMerge.imagePreview', input),
    previewThumbnail: (input, options) => previewThumbnail(input, options),
  }
}

function sidecar<T>(method: string, params?: unknown): Promise<T> {
  return invoke<unknown>('sidecar_call', {
    method,
    params: params && typeof params === 'object' ? params : {},
  }).then((value) => rewriteMediaUrls(value) as T)
}

async function commandOk(command: string, args?: Record<string, unknown>): Promise<{ ok: true }> {
  await directInvoke(command, args)
  return { ok: true }
}

async function directInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const startedAt = Date.now()
  try {
    const value = await invoke<T>(command, args)
    auditDirectCommand(command, args, {
      outcome: 'success',
      elapsedMs: Date.now() - startedAt,
      result: auditCommandResult(command, value),
    })
    return value
  } catch (error) {
    auditDirectCommand(command, args, {
      outcome: 'failed',
      elapsedMs: Date.now() - startedAt,
      error,
    })
    throw error
  }
}

function auditDirectCommand(
  command: string,
  args: Record<string, unknown> | undefined,
  outcome: {
    outcome: 'success' | 'failed'
    elapsedMs: number
    result?: unknown
    error?: unknown
  },
): void {
  void sidecar('log.event', {
    event: `renderer.command.${outcome.outcome}`,
    details: {
      command,
      args: auditCommandArgs(args),
      ...outcome,
    },
  }).catch(() => undefined)
}

function auditCommandArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {}
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(args)) {
    const value = args[key]
    if (key === 'text') {
      result[key] = { length: typeof value === 'string' ? value.length : 0 }
      continue
    }
    if (Array.isArray(value)) result[key] = { count: value.length }
    else if (value && typeof value === 'object') {
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([itemKey, item]) => [
          itemKey,
          Array.isArray(item) ? { count: item.length } : item,
        ]),
      )
    } else result[key] = value
  }
  return result
}

function auditCommandResult(command: string, value: unknown): unknown {
  if (command === 'dialog_pick_directory' || command === 'dialog_save_file' || command === 'dialog_open_file') {
    return { path: value }
  }
  if (command === 'dialog_pick_files') {
    return { count: Array.isArray(value) ? value.length : 0 }
  }
  return undefined
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const internals = window.__TAURI_INTERNALS__
  if (!internals) return Promise.reject(new Error(NOT_READY))
  return internals.invoke(command, args) as Promise<T>
}

async function pickDirectory(): Promise<{ path: string } | null> {
  const path = await directInvoke<string | null>('dialog_pick_directory')
  return path ? { path } : null
}

async function exportRules(id: string): Promise<{ yaml: string; path: string | null }> {
  let name = 'ruleset'
  try {
    const loaded = await sidecar<{ ruleSet?: { name?: string } }>('rules.get', { id })
    if (loaded.ruleSet?.name) name = loaded.ruleSet.name
  } catch {
    name = 'ruleset'
  }
  const path = await directInvoke<string | null>('dialog_save_file', {
    title: '\u5bfc\u51fa\u89c4\u5219',
    defaultPath: `${name}.yaml`,
    extensions: ['yaml', 'yml'],
  })
  if (!path) return sidecar('rules.export', { id })
  return sidecar('rules.export', { id, path })
}

async function importRules(): Promise<{ ruleSet: RuleSetSummary } | null> {
  const path = await directInvoke<string | null>('dialog_open_file', {
    title: '\u5bfc\u5165\u89c4\u5219',
    extensions: ['yaml', 'yml'],
  })
  if (!path) return null
  return sidecar('rules.import', { path })
}

async function selectMediaFiles(): Promise<{ files: MediaMergeSelectedFile[] }> {
  const filters: FileFilter[] = [
    {
      name: '\u53ef\u5408\u5e76\u5a92\u4f53',
      extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'],
    },
  ]
  const paths = await directInvoke<string[]>('dialog_pick_files', { filters })
  if (!paths.length) return { files: [] }
  return sidecar('mediaMerge.filesFromPaths', { paths })
}

function previewThumbnail(
  input: Omit<ThumbnailPreviewRequest, 'requestId'>,
  options?: { signal?: AbortSignal },
): Promise<ThumbnailPreviewResult> {
  if (!options?.signal) return sidecar<ThumbnailPreviewResult>('preview.thumbnail', input)

  const requestId = `thumbnail-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const request = sidecar<ThumbnailPreviewResult>('preview.thumbnail', { ...input, requestId })
  let settled = false
  const cancel = () => {
    if (settled) return
    void sidecar('preview.thumbnail.cancel', { requestId }).catch(() => undefined)
  }
  const onAbort = () => cancel()
  options.signal.addEventListener('abort', onAbort, { once: true })
  if (options.signal.aborted) cancel()

  return request.finally(() => {
    settled = true
    options.signal?.removeEventListener('abort', onAbort)
  })
}

function listenUi(listener: (event: NestifyUiEvent) => void): () => void {
  const stopClose = listen('window:close-requested', () => listener('window:close-requested'))
  const stopSpotlight = listen('ui:spotlight-open', () => listener('spotlight:open'))
  return () => {
    stopClose()
    stopSpotlight()
  }
}

function listenPayload<T>(event: string, listener: (payload: T) => void): () => void {
  const wrapped: SidecarBusListener = (value) => listener(value as T)
  const listeners = sidecarBusListeners.get(event) ?? new Set<SidecarBusListener>()
  listeners.add(wrapped)
  sidecarBusListeners.set(event, listeners)
  ensureSidecarBus()
  return () => {
    listeners.delete(wrapped)
    if (!listeners.size) sidecarBusListeners.delete(event)
  }
}

function ensureSidecarBus(): void {
  if (stopSidecarBus) return
  stopSidecarBus = listen('sidecar:event', (value) => {
    const event = value as SidecarBusEvent | null
    if (!event || typeof event.event !== 'string') return
    const listeners = sidecarBusListeners.get(event.event)
    if (!listeners?.size) return
    for (const listener of [...listeners]) listener(event.payload)
  })
}

function listen(event: string, listener: (payload: unknown) => void): () => void {
  const internals = window.__TAURI_INTERNALS__
  if (!internals) return () => undefined
  let eventId: number | null = null
  let stopped = false
  const handler = internals.transformCallback((incoming) => {
    listener(incoming && typeof incoming === 'object' && 'payload' in incoming ? incoming.payload : incoming)
  })
  void internals
    .invoke('plugin:event|listen', {
      event,
      target: { kind: 'Any' },
      handler,
    })
    .then((id) => {
      eventId = Number(id)
      if (stopped) void internals.invoke('plugin:event|unlisten', { eventId })
    })
    .catch(() => undefined)
  return () => {
    stopped = true
    if (eventId == null) return
    void internals.invoke('plugin:event|unlisten', { eventId }).catch(() => undefined)
  }
}

function rewriteMediaUrls(value: unknown): unknown {
  if (typeof value === 'string') return rewriteMediaString(value)
  if (Array.isArray(value)) return value.map((item) => rewriteMediaUrls(item))
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const key of Object.keys(source)) next[key] = rewriteMediaUrls(source[key])
  return next
}

function rewriteMediaString(value: string): string {
  if (!mediaBase) return value
  if (value.startsWith(MEDIA_PREFIX)) return `${mediaBase}/media?path=${value.slice(MEDIA_PREFIX.length)}`
  if (value.startsWith(THUMBNAIL_PREFIX)) return `${mediaBase}/thumbnail/${value.slice(THUMBNAIL_PREFIX.length)}`
  return value
}

async function bootstrap(): Promise<void> {
  try {
    const meta = await loadMeta()
    if (!meta) return
    const settings = await sidecar<Partial<NestifySettings>>('settings.get')
    if (settings.spotlightShortcut) {
      await directInvoke('register_spotlight_shortcut', { accelerator: settings.spotlightShortcut })
    }
  } catch {
    return
  }
}

function loadMeta(): Promise<SidecarMeta | null> {
  if (!metaPromise) {
    metaPromise = invoke<SidecarMeta>('sidecar_call', { method: 'sidecar.meta', params: {} })
      .then((meta) => {
        if (!meta || typeof meta.port !== 'number' || typeof meta.mediaBase !== 'string') return null
        mediaBase = meta.mediaBase.replace(/\/$/, '')
        window.__NESTIFY_MEDIA_BASE__ = mediaBase
        return { port: meta.port, mediaBase }
      })
      .catch(() => null)
  }
  return metaPromise
}

installNestifyHost()
