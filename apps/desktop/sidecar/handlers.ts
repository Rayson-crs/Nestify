import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  ALL_LIBRARIES_ID,
  getEntryById,
  getLibrary,
  membershipLibraryIdFor,
  relocateOnDisk,
  type NestifyRuntime,
} from '../../../packages/core/src/index.ts'
import { asEntryId, type FileOperationKind, type FileOperationProgress } from '@nestify/shared'
import { removeLibraryInWorker } from '../runtime/library-removal-worker-client.ts'
import { runTaskWorker } from '../runtime/task-worker-client.ts'
import { IMAGE_EXT, VIDEO_EXT } from '../runtime/media-extensions.ts'
import { ThumbnailCancelledError } from '../../../packages/core/src/preview/thumbnail-service.ts'
import { previewSelectedVideoProxy, renderImageMergePreview } from './media-merge-preview.ts'
import {
  applySystemLogSettings,
  applyFfmpegDirectory,
  systemLogConfiguration,
  normalizeSettings,
  readSettings,
  testFfmpegDirectory,
  writeSettings,
  type DesktopSettings,
} from './settings.ts'
import { logSidecar, requireRuntime, type HostState } from './state.ts'
import { thumbnailServiceFor, thumbnailUrl } from './thumbnails.ts'

export type HostContext = HostState

export async function handleRpc(state: HostContext, method: string, params: unknown): Promise<unknown> {
  const input = asRecord(params)
  switch (method) {
    case 'sidecar.meta':
      return { port: state.port, mediaBase: `http://127.0.0.1:${state.port}` }
    case 'app.info':
      return { name: 'Nestify', version: process.env.NESTIFY_APP_VERSION || process.env.npm_package_version || '' }
    case 'log.event':
      logSidecar(
        String(input.event ?? 'renderer.event'),
        input.details,
        input.level === 'warn' || input.level === 'error' ? input.level : 'info',
      )
      return { ok: true }
    case 'settings.get':
      return readSettings(state.appDataRoot)
    case 'logs.path': {
      const settings = await readSettings(state.appDataRoot)
      if (input.directory !== undefined) {
        settings.auditLogDirectory = normalizeSettings({
          ...settings,
          auditLogDirectory: input.directory as string | null,
        }).auditLogDirectory
      }
      const { logsDir } = systemLogConfiguration(settings, state.appDataRoot)
      await mkdir(logsDir, { recursive: true })
      return { path: logsDir }
    }
    case 'settings.update':
      return updateSettings(state, input)
    case 'settings.testFfmpeg':
      return testFfmpegDirectory(typeof input.directory === 'string' ? input.directory : null)
    case 'library.list':
      return { libraries: requireRuntime(state).listLibraries().map(toLibrary) }
    case 'library.add': {
      const runtime = requireRuntime(state)
      const library = runtime.addLibrary({ name: String(input.name ?? ''), roots: stringArray(input.roots) })
      state.writers().start(toWriterLibrary(library), { initialReconcile: false })
      return { library: toLibrary(library) }
    }
    case 'library.update': {
      const runtime = requireRuntime(state)
      const id = String(input.id ?? '')
      await state.writers().stop(id)
      const library = runtime.updateLibrary({ id, patch: asRecord(input.patch) })
      state.writers().start(toWriterLibrary(library), { initialReconcile: false })
      return { library: toLibrary(library) }
    }
    case 'library.remove':
      return removeLibrary(state, String(input.id ?? ''))
    case 'library.removalProgress': {
      const progress = libraryRemovalProgress(state, String(input.jobId ?? ''))
      if (!progress) throw new Error(`移除任务不存在：${String(input.jobId ?? '')}`)
      return progress
    }
    case 'system.list-drive-roots':
      return { roots: listDriveRoots() }
    case 'scan.start':
      return exclusive(state, () => startScan(state, String(input.libraryId ?? '')))
    case 'scan.progress':
      return scanProgress(requireRuntime(state))
    case 'scan.pause':
      return requireRuntime(state).pauseScan(String(input.jobId ?? ''))
    case 'scan.resume':
      return requireRuntime(state).resumeScan(String(input.jobId ?? ''))
    case 'scan.cancel':
      return requireRuntime(state).cancelScan(String(input.jobId ?? ''))
    case 'search.cancel':
      return cancelSearch(state, input)
    case 'search.query':
      return search(state, input)
    case 'directory.children':
      return directoryChildren(state, input)
    case 'rules.list':
      return { ruleSets: requireRuntime(state).listRuleSets().map(toRuleSet) }
    case 'rules.get':
      return { ruleSet: requiredRuleSet(state, String(input.id ?? '')) }
    case 'rules.create':
      return { ruleSet: toRuleSet(requireRuntime(state).createRuleSet(input as never)) }
    case 'rules.update':
      return { ruleSet: toRuleSet(requireRuntime(state).updateRuleSet(String(input.id ?? ''), asRecord(input.patch) as never)) }
    case 'rules.delete':
      requireRuntime(state).deleteRuleSet(String(input.id ?? ''))
      return { ok: true }
    case 'rules.enable':
      return { ruleSet: toRuleSet(requireRuntime(state).setRuleSetEnabled(String(input.id ?? ''), Boolean(input.enabled))) }
    case 'rules.priority':
      return { ruleSet: toRuleSet(requireRuntime(state).setRuleSetPriority(String(input.id ?? ''), Number(input.priority))) }
    case 'rules.clone':
      return { ruleSet: toRuleSet(requireRuntime(state).cloneRuleSet(String(input.sourceId ?? ''), input as never)) }
    case 'rules.export':
      return exportRules(state, input)
    case 'rules.import':
      return importRules(state, input)
    case 'rules.preview':
      return { plan: await state.preview().request('rules', input) }
    case 'rename.preview':
      return { plan: await state.preview().request('rename', input) }
    case 'organize.snapshot':
      return { snapshot: await state.preview().request('organize-snapshot', input) }
    case 'organize.preview':
      return { preview: await state.preview().request('organize', input) }
    case 'plan.execute':
      return exclusive(state, () => executePlan(state, input))
    case 'plan.progress':
      return state.planExecutionProgress
    case 'plan.rollback':
      return exclusive(state, async () => {
        assertNoActiveScan(requireRuntime(state))
        return requireRuntime(state).rollbackPlan(String(input.jobId ?? ''))
      })
    case 'jobs.list':
      return { jobs: requireRuntime(state).listJobs(input as never) }
    case 'jobs.clear':
      return requireRuntime(state).clearJobHistory(input as never)
    case 'job.ops':
      return requireRuntime(state).listJobOps(String(input.jobId ?? ''), input as never)
    case 'duplicates.analyze':
      return exclusive(state, () => analyzeDuplicates(state, input))
    case 'duplicates.progress':
      return state.duplicateAnalysisProgress
    case 'file.rename':
      return exclusive(state, () => renameFile(state, input))
    case 'file.move':
      return exclusive(state, () => moveFile(state, input))
    case 'file.delete':
      return exclusive(state, () => deleteFile(state, input))
    case 'preview.file':
      return previewFile(String(input.path ?? ''))
    case 'preview.thumbnail':
      return thumbnail(state, input)
    case 'preview.thumbnail.cancel': {
      const request = state.thumbnailRequests.get(String(input.requestId ?? ''))
      request?.abort()
      return { cancelled: Boolean(request) }
    }
    case 'mediaMerge.filesFromPaths':
      return filesFromPaths(stringArray(input.paths))
    case 'mediaMerge.buildPlan':
      return requireRuntime(state).buildMediaMergePlan(input as never)
    case 'mediaMerge.start':
      return requireRuntime(state).startMediaMerge(asRecord(input.plan) as never)
    case 'mediaMerge.cancel':
      return requireRuntime(state).cancelMediaMerge(String(input.jobId ?? ''))
    case 'mediaMerge.resume':
      return requireRuntime(state).resumeMediaMerge(String(input.jobId ?? ''))
    case 'mediaMerge.progress': {
      const progress = requireRuntime(state).getMediaMergeProgress(String(input.jobId ?? ''))
      if (!progress) throw new Error(`媒体合并任务不存在：${String(input.jobId ?? '')}`)
      return progress
    }
    case 'mediaMerge.preview':
      return previewMergeFile(input)
    case 'mediaMerge.previewProxy':
      return previewSelectedVideoProxy({
        path: String(input.path ?? ''),
        selectedPaths: stringArray(input.selectedPaths),
      })
    case 'mediaMerge.imagePreview':
      return renderImageMergePreview({
        items: Array.isArray(input.items) ? input.items as never : [],
        settings: asRecord(input.settings) as never,
      })
    case 'mediaMerge.timeline':
      return requireRuntime(state).getMediaMergeTimeline(input as never)
    case 'mediaMerge.waveform':
      return requireRuntime(state).getMediaMergeWaveform(input as never)
    case 'mediaMerge.duration':
      return requireRuntime(state).getMediaMergeDuration(input as never)
    case 'window.minimize-to-tray':
    case 'window.quit':
    case 'window.open-spotlight':
    case 'window.close-spotlight':
    case 'window.resize-spotlight':
    case 'clipboard.writeText':
      return { ok: true }
    default:
      throw new Error(`unknown sidecar method: ${method}`)
  }
}

async function updateSettings(state: HostState, input: Record<string, unknown>): Promise<DesktopSettings> {
  const current = await readSettings(state.appDataRoot)
  const next = normalizeSettings({ ...current, ...input })
  await writeSettings(state.appDataRoot, next)
  applyFfmpegDirectory(next.ffmpegDirectory, state)
  await applySystemLogSettings(next, state)
  state.runtime?.setScanConcurrency(next.scanConcurrency)
  return next
}

async function removeLibrary(state: HostState, libraryId: string): Promise<{ ok: true; jobId: string }> {
  const runtime = requireRuntime(state)
  const task = runtime.startLibraryRemoval({
    libraryId,
    beforeDelete: async () => {
      await state.writers().stop(libraryId)
      await state.queryWorker?.close()
      state.queryWorker = null
    },
    removeData: async (report) => {
      await removeLibraryInWorker({
        workerPath: state.workerPath('library-removal-worker.mjs'),
        dbPath: runtime.paths.dbPath,
        libraryId,
        preserveJobId: task.jobId,
        thumbnailsDir: runtime.paths.thumbnailsDir,
        onProgress: (progress) => report(progress.stage, progress.current),
      })
    },
    onProgress: (progress) => {
      state.libraryRemovalProgress.set(progress.jobId, progress)
      state.emit('library.removal-progress', progress)
    },
  })
  task.completion.catch((error) => {
    logSidecar('library.removal.failed', error, 'error')
  })
  return { ok: true, jobId: task.jobId }
}

function libraryRemovalProgress(state: HostState, jobId: string) {
  const recorded = state.libraryRemovalProgress.get(jobId)
  if (recorded) return recorded
  const job = requireRuntime(state)
    .listJobs({ limit: 500 })
    .find((item) => item.id === jobId && item.kind === 'library-remove')
  if (!job) return null
  const stats = job.stats as {
    current?: number
    total?: number
    stages?: string[]
    libraryName?: string
  } | null
  const status = job.status === 'completed' || job.status === 'failed'
    ? job.status
    : job.status === 'queued'
      ? 'queued'
      : 'running'
  return {
    jobId,
    libraryId: job.libraryId ?? '',
    libraryName: stats?.libraryName ?? '资料库',
    status,
    current: typeof stats?.current === 'number' ? stats.current : job.status === 'completed' ? 100 : 0,
    total: typeof stats?.total === 'number' ? stats.total : 100,
    stage: status === 'completed' ? '资料库已移除' : status === 'failed' ? '移除失败' : stats?.stages?.at(-1) ?? '正在移除资料库',
    error: job.error,
  }
}

async function startScan(state: HostState, libraryId: string) {
  assertNoActiveScan(requireRuntime(state))
  const runtime = requireRuntime(state)
  const library = runtime.listLibraries().find((item) => item.id === libraryId)
  if (!library) throw new Error(`library not found: ${libraryId}`)
  await state.writers().stop(libraryId)
  try {
    const started = runtime.startScan(libraryId)
    const removeListener = runtime.onScanFinished((finishedId) => {
      if (finishedId !== libraryId) return
      removeListener()
      const current = runtime.listLibraries().find((item) => item.id === finishedId)
      if (current) state.writers().start(toWriterLibrary(current), { initialReconcile: false })
    })
    return started
  } catch (error) {
    state.writers().start(toWriterLibrary(library), { initialReconcile: false })
    throw error
  }
}

function scanProgress(runtime: NestifyRuntime) {
  const progress = runtime.getScanProgress()
  const activeJobStatus = progress.jobStatus
  const active = activeJobStatus === 'running' || activeJobStatus === 'paused' || activeJobStatus === 'cancelling'
  return {
    phase: !active && (progress.phase === 'walk' || progress.phase === 'upsert') ? 'idle' : progress.phase,
    paused: active ? progress.paused === true : false,
    filesScanned: progress.filesScanned,
    dirsScanned: progress.dirsScanned,
    bytesScanned: progress.bytesScanned,
    currentPath: progress.currentPath,
    errors: progress.errors,
    filesPerSecond: progress.filesPerSecond,
    jobId: progress.jobId ?? null,
    libraryId: progress.libraryId ?? null,
    jobStatus: active ? activeJobStatus : null,
  }
}

export async function search(state: HostState, input: Record<string, unknown>) {
  const runtime = requireRuntime(state)
  const libraryId = String(input.libraryId ?? '')
  const text = String(input.text ?? '')
  const {
    libraryId: _libraryId,
    text: _text,
    requestSeq: rawRequestSeq,
    searchClientId: rawSearchClientId,
    ...options
  } = input
  const freshQuery = Number(options.offset ?? 0) === 0 && options.cursor == null
  const requestSeq = Number(rawRequestSeq ?? 0)
  const clientId = searchClientId(rawSearchClientId)
  const currentSeq = state.searchRequestSeqByClient.get(clientId) ?? 0
  assertSearchRequestSeq(requestSeq)
  if (requestSeq > 0 && requestSeq < currentSeq) throw new Error('query cancelled')
  if (requestSeq > currentSeq) state.searchRequestSeqByClient.set(clientId, requestSeq)
  if (freshQuery) {
    if (requestSeq === 0) state.searchRequestSeqByClient.set(clientId, currentSeq + 1)
    if (state.queryWorker?.hasPending('search')) state.queryWorker.cancel()
  }
  const result = await state.query().search<ReturnType<NestifyRuntime['search']>>({ ...options, libraryId, text })
  if (requestSeq > 0 && requestSeq !== (state.searchRequestSeqByClient.get(clientId) ?? 0)) {
    throw new Error('query cancelled')
  }
  return {
    result: {
      ...result,
      hits: result.hits.map((hit) => ({
        entryId: hit.entryId,
        libraryId: hit.libraryId,
        name: hit.name,
        path: hit.path,
        ext: hit.ext,
        kind: hit.kind,
        size: hit.size,
        mtime: hit.mtime,
        parent: hit.parent,
      })),
    },
  }
}

export function cancelSearch(state: HostState, input: Record<string, unknown>) {
  const requestSeq = Number(input.requestSeq ?? 0)
  assertSearchRequestSeq(requestSeq)
  const clientId = searchClientId(input.searchClientId)
  const currentSeq = state.searchRequestSeqByClient.get(clientId) ?? 0
  const effectiveSeq = requestSeq > 0 ? requestSeq : currentSeq + 1
  if (effectiveSeq < currentSeq) return { cancelled: false }
  state.searchRequestSeqByClient.set(clientId, effectiveSeq)
  state.queryWorker?.cancel()
  return { cancelled: true }
}

function searchClientId(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 128) : 'default'
}

function assertSearchRequestSeq(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid search requestSeq')
}

export async function directoryChildren(state: HostState, input: Record<string, unknown>) {
  const query = state.query()
  if (state.queryWorker?.hasPending('directory')) state.queryWorker.cancel('directory')
  const result = await query.directory(String(input.libraryId ?? ''), String(input.directory ?? ''), input)
  return { result }
}

async function exportRules(state: HostState, input: Record<string, unknown>) {
  const yaml = requireRuntime(state).exportRuleSet(String(input.id ?? ''))
  const path = typeof input.path === 'string' ? input.path : ''
  if (!path) return { yaml, path: null }
  await writeFile(path, yaml, 'utf8')
  return { yaml, path }
}

async function importRules(state: HostState, input: Record<string, unknown>) {
  const path = typeof input.path === 'string' ? input.path : ''
  if (!path) return null
  const yaml = await readFile(path, 'utf8')
  return { ruleSet: toRuleSet(requireRuntime(state).importRuleSet(yaml)) }
}

async function executePlan(state: HostState, input: Record<string, unknown>) {
  const runtime = requireRuntime(state)
  assertNoActiveScan(runtime)
  const plan = asRecord(input.plan)
  const selectedOps = Array.isArray(input.selectedOps) ? input.selectedOps.filter((item) => typeof item === 'number') : []
  const ops = Array.isArray(plan.ops) ? plan.ops : []
  state.planExecutionProgress = {
    module: (typeof input.module === 'string' ? input.module : 'rules') as never,
    status: 'running',
    current: 0,
    total: input.selectedOps == null ? ops.length : selectedOps.length,
    ok: 0,
    skipped: 0,
    failed: 0,
    path: null,
  }
  state.emit('plan.execution-progress', state.planExecutionProgress)
  try {
    return await runTaskWorker<Awaited<ReturnType<NestifyRuntime['executePlan']>>>({
      workerPath: state.workerPath('task-worker.mjs'),
      dbPath: runtime.paths.dbPath,
      quarantineDir: runtime.paths.quarantineDir,
      task: { kind: 'plan-execute', ...(input as object) },
      onProgress: (progress: unknown) => {
        state.planExecutionProgress = progress as never
        state.emit('plan.execution-progress', progress)
      },
    })
  } catch (error) {
    state.planExecutionProgress = {
      ...(state.planExecutionProgress ?? { module: 'rules', current: 0, total: 0, ok: 0, skipped: 0, failed: 0, path: null }),
      status: 'failed',
      path: null,
    } as never
    state.emit('plan.execution-progress', state.planExecutionProgress)
    throw error
  }
}

async function analyzeDuplicates(state: HostState, input: Record<string, unknown>) {
  const runtime = requireRuntime(state)
  state.duplicateAnalysisProgress = {
    status: 'running',
    phase: 'collecting',
    phaseCurrent: 0,
    phaseTotal: 0,
    percent: 0,
    path: null,
  }
  state.emit('duplicates.analysis-progress', state.duplicateAnalysisProgress)
  try {
    return await runTaskWorker<Awaited<ReturnType<NestifyRuntime['analyzeDuplicates']>>>({
      workerPath: state.workerPath('task-worker.mjs'),
      dbPath: runtime.paths.dbPath,
      quarantineDir: runtime.paths.quarantineDir,
      task: { kind: 'duplicates', ...(input as object) },
      onProgress: (progress: unknown) => {
        state.duplicateAnalysisProgress = progress as never
        state.emit('duplicates.analysis-progress', progress)
      },
    })
  } catch (error) {
    state.duplicateAnalysisProgress = {
      status: 'failed',
      phase: 'finalizing',
      phaseCurrent: 0,
      phaseTotal: 0,
      percent: 0,
      path: null,
    }
    state.emit('duplicates.analysis-progress', state.duplicateAnalysisProgress)
    throw error
  }
}

async function renameFile(state: HostState, input: Record<string, unknown>): Promise<{ ok: true }> {
  const runtime = requireRuntime(state)
  const report = fileOperationReporter(state, input, 'rename')
  try {
    report(5, '重命名中')
    assertNoActiveScan(runtime)
    const source = pathInLibrary(runtime, String(input.libraryId ?? ''), String(input.path ?? ''))
    const name = String(input.name ?? '').trim()
    if (!name || name.includes('\\') || name.includes('/') || name === '.' || name === '..') throw new Error('名称无效')
    const target = join(dirname(source), name)
    report(30, '正在修改磁盘文件')
    await relocateSafely(source, target)
    report(65, '正在更新索引')
    await runtime.refreshLibrariesContainingPaths([source, target])
    report(100, '重命名完成')
    return { ok: true }
  } catch (error) {
    report(100, '重命名失败', error)
    throw error
  }
}

async function moveFile(state: HostState, input: Record<string, unknown>): Promise<{ ok: true }> {
  const runtime = requireRuntime(state)
  const report = fileOperationReporter(state, input, 'move')
  try {
    report(5, '移动中')
    assertNoActiveScan(runtime)
    const source = pathInLibrary(runtime, String(input.libraryId ?? ''), String(input.path ?? ''))
    const directory = pathInLibrary(runtime, String(input.libraryId ?? ''), String(input.directory ?? ''))
    report(25, '正在检查目标目录')
    if (!(await stat(directory)).isDirectory()) throw new Error('目标必须是目录')
    const target = join(directory, basename(source))
    report(35, '正在修改磁盘文件')
    await relocateSafely(source, target)
    report(65, '正在更新索引')
    await runtime.refreshLibrariesContainingPaths([source, target])
    report(100, '移动完成')
    return { ok: true }
  } catch (error) {
    report(100, '移动失败', error)
    throw error
  }
}

async function deleteFile(state: HostState, input: Record<string, unknown>): Promise<{ ok: true }> {
  const runtime = requireRuntime(state)
  const report = fileOperationReporter(state, input, 'delete')
  try {
    report(5, '删除中')
    assertNoActiveScan(runtime)
    const source = pathInLibrary(runtime, String(input.libraryId ?? ''), String(input.path ?? ''))
    report(35, '正在删除磁盘文件')
    await rm(source, { recursive: true, force: false })
    report(65, '正在更新索引')
    await runtime.refreshLibrariesContainingPaths([source])
    report(100, '删除完成')
    return { ok: true }
  } catch (error) {
    report(100, '删除失败', error)
    throw error
  }
}

function fileOperationReporter(
  state: HostState,
  input: Record<string, unknown>,
  operation: FileOperationKind,
): (percent: number, stage: string, error?: unknown) => void {
  const progress: FileOperationProgress = {
    requestId: typeof input.requestId === 'string' && input.requestId ? input.requestId : randomUUID(),
    operation,
    path: String(input.path ?? ''),
    status: 'running',
    stage: '准备操作',
    percent: 0,
    error: null,
  }
  return (percent, stage, error) => {
    const next: FileOperationProgress = {
      ...progress,
      status: error ? 'failed' : percent >= 100 ? 'completed' : 'running',
      stage,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      error: error ? (error instanceof Error ? error.message : String(error)) : null,
    }
    state.emit('file.operation-progress', next)
  }
}

async function relocateSafely(source: string, target: string): Promise<void> {
  const targetExists = await stat(target).then(() => true, () => false)
  if (targetExists && source.toLowerCase() !== target.toLowerCase()) throw new Error('目标路径已存在')
  if (source.toLowerCase() === target.toLowerCase()) return
  await mkdir(dirname(target), { recursive: true })
  await relocateOnDisk(source, target)
}

async function previewMergeFile(input: Record<string, unknown>) {
  const path = String(input.path ?? '')
  const selected = new Set(stringArray(input.selectedPaths))
  if (!selected.has(path)) return { kind: 'none' as const }
  return previewFile(path)
}

async function previewFile(path: string) {
  try {
    const extension = extname(path).toLowerCase()
    if (IMAGE_EXT.has(extension)) {
      const info = await stat(path)
      if (info.size > 8 * 1024 * 1024) return { kind: 'too-large' as const }
      const data = await readFile(path)
      return { kind: 'image' as const, dataUrl: `data:${mimeFor(extension)};base64,${data.toString('base64')}` }
    }
    if (VIDEO_EXT.has(extension)) return { kind: 'video' as const, src: `nestify-media://preview/?path=${encodeURIComponent(path)}` }
  } catch {
    return { kind: 'none' as const }
  }
  return { kind: 'none' as const }
}

async function filesFromPaths(paths: string[]) {
  const files = []
  for (const path of paths) {
    const info = await stat(path)
    const extension = extname(path).toLowerCase()
    if (!isAbsolute(path) || !info.isFile() || (!IMAGE_EXT.has(extension) && !VIDEO_EXT.has(extension))) {
      throw new Error('只能选择本地图片或视频文件')
    }
    files.push({ path, kind: IMAGE_EXT.has(extension) ? 'image' : 'video', size: info.size, mtime: info.mtimeMs })
  }
  return { files }
}

async function thumbnail(state: HostState, input: Record<string, unknown>) {
  const entryId = String(input.entryId ?? '').trim()
  const libraryId = String(input.libraryId ?? '').trim()
  const requestId = String(input.requestId ?? '').trim()
  if (requestId && state.thumbnailRequests.has(requestId)) {
    return thumbnailError(entryId, 'invalid_request', 'requestId is already active', false)
  }
  if (!libraryId || !entryId) {
    return thumbnailError(entryId, 'invalid_request', 'libraryId and entryId are required', false)
  }

  const controller = new AbortController()
  if (requestId) state.thumbnailRequests.set(requestId, controller)
  try {
    const runtime = requireRuntime(state)
    const entry = getEntryById(runtime.db, entryId)
    const membership = libraryId === ALL_LIBRARIES_ID
      ? membershipLibraryIdFor(runtime.db, entryId)
      : membershipLibraryIdFor(runtime.db, entryId, libraryId)
    if (!entry || !membership || entry.tombstone) {
      return thumbnailError(entryId, 'entry_not_found', 'entry not found in library', false)
    }
    const requestedKind = input.kind === 'image' || input.kind === 'video' ? input.kind : undefined
    if (entry.isDir || !['image', 'video'].includes(entry.kind) || entry.protocol !== 'local') {
      return thumbnailError(entryId, 'unsupported_kind', 'only local image and video entries are supported', false)
    }
    if (requestedKind && requestedKind !== entry.kind) {
      return thumbnailError(entryId, 'unsupported_kind', 'requested kind does not match the indexed entry', false)
    }
    const entryExt = extname(entry.path).toLowerCase()
    if ((!IMAGE_EXT.has(entryExt) && !VIDEO_EXT.has(entryExt)) || !isAbsolute(entry.path)) {
      return thumbnailError(entryId, 'unsupported_kind', 'entry has an unsupported media path', false)
    }
    const library = getLibrary(runtime.db, membership)
    if (!library?.roots.some((root) => isInsideDirectory(root, entry.path))) {
      return thumbnailError(entryId, 'entry_not_found', 'entry is outside its library roots', false)
    }

    const info = await stat(entry.path)
    const mtime = Math.trunc(info.mtimeMs)
    if (!info.isFile() || info.size !== entry.size || mtime !== entry.mtime) {
      return thumbnailError(entryId, 'generation_failed', 'source file changed since the last scan; rescan the library', true)
    }
    if (controller.signal.aborted) {
      return thumbnailError(entryId, 'cancelled', 'thumbnail generation was cancelled', true)
    }

    const result = await thumbnailServiceFor(runtime.db, runtime.paths.thumbnailsDir).getThumbnail(
      {
        entryId: asEntryId(entryId),
        sizeBytes: info.size,
        mtime,
        generatorVersion: 3,
        sourcePath: entry.path,
      },
      {
        priority: thumbnailPriority(input.priority),
        signal: controller.signal,
      },
    )
    return {
      entryId,
      kind: entry.kind,
      cacheKey: result.cacheKey,
      mime: result.mime,
      width: result.width,
      height: result.height,
      url: thumbnailUrl(result.cacheKey, result.mime),
      error: null,
    }
  } catch (error) {
    if (error instanceof ThumbnailCancelledError || controller.signal.aborted) {
      return thumbnailError(entryId, 'cancelled', 'thumbnail generation was cancelled', true)
    }
    return thumbnailError(entryId, 'generation_failed', error instanceof Error ? error.message : 'thumbnail generation failed', true)
  } finally {
    if (requestId) state.thumbnailRequests.delete(requestId)
  }
}

function thumbnailError(entryId: string, code: string, message: string, retryable: boolean) {
  return { entryId, kind: null, cacheKey: '', mime: null, width: null, height: null, url: null, error: { code, message, retryable } }
}

function thumbnailPriority(priority: unknown): number {
  if (priority === 'selected') return 30
  if (priority === 'background') return 10
  return 20
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const relativePath = relative(resolve(directory), resolve(candidate))
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}


function requiredRuleSet(state: HostState, id: string) {
  const ruleSet = requireRuntime(state).getRuleSet(id)
  if (!ruleSet) throw new Error(`ruleset not found: ${id}`)
  return toRuleSet(ruleSet)
}

function toLibrary(library: ReturnType<NestifyRuntime['listLibraries']>[number]) {
  return {
    id: library.id,
    name: library.name,
    roots: library.roots,
    excludeGlobs: library.excludeGlobs,
    maxDepth: library.maxDepth,
    followSymlinks: library.followSymlinks,
    scanHidden: library.scanHidden,
    hashStrategy: library.hashStrategy,
    mediaStrategy: library.mediaStrategy,
    previewStrategy: library.previewStrategy,
    updatedAt: library.updatedAt,
  }
}

function toWriterLibrary(library: ReturnType<NestifyRuntime['listLibraries']>[number]) {
  return {
    id: library.id,
    roots: library.roots,
    excludeGlobs: library.excludeGlobs,
    maxDepth: library.maxDepth,
    followSymlinks: library.followSymlinks,
    scanHidden: library.scanHidden,
  }
}

function toRuleSet(set: ReturnType<NestifyRuntime['listRuleSets']>[number]) {
  return {
    id: set.id,
    name: set.name,
    description: set.description,
    dryRunDefault: set.dryRunDefault,
    collision: set.collision,
    builtin: set.builtin,
    enabled: set.enabled,
    priority: set.priority,
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
    rules: set.rules.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      priority: rule.priority,
      action: rule.action,
      match: rule.match,
      template: rule.template,
      extract: rule.extract,
      reason: rule.reason,
    })),
  }
}

function assertNoActiveScan(runtime: NestifyRuntime): void {
  const active = runtime.getActiveScanJob()
  if (active && (active.status === 'running' || active.status === 'paused' || active.status === 'cancelling')) {
    throw new Error('扫描正在进行，请先暂停或取消后再修改文件')
  }
}

function pathInLibrary(runtime: NestifyRuntime, libraryId: string, path: string): string {
  const library = getLibrary(runtime.db, libraryId)
  if (!library) throw new Error('资料库不存在')
  const candidate = path.trim()
  if (!candidate || !isAbsolute(candidate)) throw new Error('路径无效')
  const normalized = candidate.replaceAll('/', '\\').toLowerCase()
  const inside = library.roots.some((root) => {
    const base = root.replaceAll('/', '\\').replace(/[\\]+$/, '').toLowerCase()
    return normalized === base || normalized.startsWith(`${base}\\`)
  })
  if (!inside) throw new Error('只能操作资料库根目录内的路径')
  return candidate
}

function listDriveRoots(): string[] {
  if (process.platform !== 'win32') return ['/']
  return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`).filter((root) => existsSync(root))
}

function exclusive<T>(state: HostState, operation: () => Promise<T>): Promise<T> {
  const execution = state.fileOperationTail.then(operation)
  state.fileOperationTail = execution.then(() => undefined, () => undefined)
  return execution
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function mimeFor(extension: string): string {
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.bmp') return 'image/bmp'
  if (extension === '.avif') return 'image/avif'
  return 'image/jpeg'
}
