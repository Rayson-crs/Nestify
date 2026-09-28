import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  ALL_LIBRARIES_ID,
  createJob,
  getEntryById,
  getLibrary,
  membershipLibraryIdFor,
  relocateOnDisk,
  updateJobStatus,
  updateJobStatusWithRetry,
  type NestifyRuntime,
} from '../../../packages/core/src/index.ts'
import {
  applyDuplicateKeepStrategy,
  listDuplicateFilesPage,
  listDuplicateExecutionPlan,
  listDuplicateResultPage,
  resetDuplicateGroupKeep,
  setDuplicateMemberKeep,
} from '../../../packages/core/src/duplicates/query.ts'
import {
  asEntryId,
  asJobId,
  type DuplicateAnalysisProgress,
  type FileOperationKind,
  type FileOperationProgress,
  type PlanExecutionFinishedEvent,
  type PlanExecutionProgress,
  type PlanExecutionResult,
  type PlanExecutionSnapshot,
} from '@nestify/shared'
import { removeLibraryInWorker } from '../runtime/library-removal-worker-client.ts'
import { runTaskWorker } from '../runtime/task-worker-client.ts'
import { IMAGE_EXT, VIDEO_EXT } from '../runtime/media-extensions.ts'
import { ThumbnailCancelledError } from '../../../packages/core/src/preview/thumbnail-service.ts'
import { isDuplicateAnalysisCancelled } from '../../../packages/core/src/duplicates/analyzer.ts'
import { previewSelectedVideoProxy, renderImageMergePreview } from './media-merge-preview.ts'
import type { KeepStrategy } from '../../../packages/core/src/modules/types.ts'
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
import { logSidecar, requireRuntime, type HostState, type PlanExecutionState } from './state.ts'
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
      return testFfmpegDirectory(
        typeof input.directory === 'string' && input.directory.trim() ? input.directory : null,
        state,
      )
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
    case 'plan.execute.start':
      return startPlanExecution(state, input)
    case 'plan.execution': {
      const execution = state.planExecutions.get(String(input.requestId ?? ''))
      if (!execution) throw new Error(`plan execution not found: ${String(input.requestId ?? '')}`)
      return {
        requestId: String(input.requestId ?? ''),
        jobId: execution.jobId,
        status: execution.status,
        progress: execution.progress,
        result: execution.result,
        error: execution.error,
      } satisfies PlanExecutionSnapshot
    }
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
      return startDuplicateAnalysis(state, input)
    case 'duplicates.progress':
      return duplicateProgress(state, input)
    case 'duplicates.cancel':
      return cancelDuplicateAnalysis(state, input)
    case 'duplicates.result':
      return {
        result: listDuplicateResultPage(requireRuntime(state).db, {
          jobId: String(input.jobId ?? ''),
          offset: numberInput(input.offset),
          limit: numberInput(input.limit),
          kind: typeof input.kind === 'string' ? input.kind : undefined,
        }),
      }
    case 'duplicates.files':
      return {
        result: listDuplicateFilesPage(requireRuntime(state).db, {
          jobId: String(input.jobId ?? ''),
          quarantineDir: requireRuntime(state).paths.quarantineDir,
          groupId: typeof input.groupId === 'string' && input.groupId ? input.groupId : null,
          offset: numberInput(input.offset),
          limit: numberInput(input.limit),
          kind: typeof input.kind === 'string' ? input.kind : undefined,
        }),
      }
    case 'duplicates.plan':
      return {
        plan: listDuplicateExecutionPlan(requireRuntime(state).db, {
          jobId: String(input.jobId ?? ''),
          quarantineDir: requireRuntime(state).paths.quarantineDir,
          kind: typeof input.kind === 'string' ? input.kind : undefined,
        }),
      }
    case 'duplicates.strategy':
      return {
        result: applyDuplicateKeepStrategy(requireRuntime(state).db, {
          jobId: String(input.jobId ?? ''),
          keepStrategy: keepStrategyInput(input.keepStrategy),
          preferredDirectory: typeof input.preferredDirectory === 'string' ? input.preferredDirectory : undefined,
        }),
      }
    case 'duplicates.groupStrategy':
      return {
        result: resetDuplicateGroupKeep(requireRuntime(state).db, {
          jobId: String(input.jobId ?? ''),
          groupId: String(input.groupId ?? ''),
          keepStrategy: keepStrategyInput(input.keepStrategy),
          preferredDirectory: typeof input.preferredDirectory === 'string' ? input.preferredDirectory : undefined,
        }),
      }
    case 'duplicates.keep':
      return {
        result: setDuplicateMemberKeep(requireRuntime(state).db, {
          jobId: String(input.jobId ?? ''),
          groupId: String(input.groupId ?? ''),
          entryId: String(input.entryId ?? ''),
          keep: input.keep === true,
        }),
      }
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
        force: input.force === true,
        reason: input.reason === 'browser-decode' ? 'browser-decode' : 'container',
        mediaTools: state.mediaTools,
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

function startDuplicateAnalysis(state: HostState, input: Record<string, unknown>): { jobId: string } {
  const runtime = requireRuntime(state)
  if (state.duplicateAnalysisJobs.size > 0) throw new Error('已有重复分析正在进行，请先取消或等待完成')
  const libraryId = String(input.libraryId ?? '')
  const library = getLibrary(runtime.db, libraryId)
  if (!library) throw new Error(`library not found: ${libraryId}`)
  const jobId = asJobId(randomUUID())
  createJob(runtime.db, {
    id: jobId,
    libraryId: library.id,
    kind: 'duplicates',
    status: 'running',
    startedAt: Date.now(),
    stats: {
      scope: input.scope ?? 'library',
      directory: input.directory ?? null,
      filter: input.filter ?? null,
      hashStrategy: input.hashStrategy ?? 'duplicate-candidate-only',
    },
  })
  const progress: DuplicateAnalysisProgress = {
    jobId,
    status: 'running',
    phase: 'collecting',
    phaseCurrent: 0,
    phaseTotal: 0,
    percent: 0,
    path: null,
  }
  publishDuplicateProgress(state, progress)
  const execution = runTaskWorker<{
    persistence?: { groupsInserted: number; membersInserted: number; groupsSuperseded: number }
    hashStrategy?: string
    groupCount?: number
  }>({
    workerPath: state.workerPath('task-worker.mjs'),
    dbPath: runtime.paths.dbPath,
    quarantineDir: runtime.paths.quarantineDir,
    task: { kind: 'duplicates', jobId, ...(input as object) },
    onProgress: (next: unknown) => {
      const progress = next as DuplicateAnalysisProgress
      // The analyzer reports completion before the worker message is settled.
      // Expose completion only after the job row is safe for result queries.
      if (progress.status === 'completed') return
      publishDuplicateProgress(state, progress)
    },
  })
  const completion = execution.then(async (summary) => {
    try {
      await updateJobStatusWithRetry(runtime.db, jobId, 'completed', {
        finishedAt: Date.now(),
        stats: {
          scope: input.scope ?? 'library',
          directory: input.directory ?? null,
          filter: input.filter ?? null,
          hashStrategy: summary.hashStrategy ?? input.hashStrategy ?? 'duplicate-candidate-only',
          ...summary.persistence,
          groupCount: summary.groupCount ?? summary.persistence?.groupsInserted ?? 0,
        },
      })
      publishDuplicateProgress(state, {
        ...progress,
        status: 'completed',
        phase: 'finalizing',
        phaseCurrent: 1,
        phaseTotal: 1,
        percent: 100,
        path: null,
      })
    } catch (error) {
      const message = `分析结果已生成，但保存任务状态失败：${error instanceof Error ? error.message : String(error)}`
      logSidecar('duplicates.analysis.status-persist.failed', { jobId, error }, 'error')
      await updateJobStatusWithRetry(runtime.db, jobId, 'failed', {
        finishedAt: Date.now(),
        error: message,
      }).catch((statusError: unknown) => {
        logSidecar('duplicates.analysis.failure-status.failed', { jobId, error: statusError }, 'error')
      })
      publishDuplicateProgress(state, {
        ...progress,
        status: 'failed',
        phase: 'finalizing',
        phaseCurrent: 0,
        phaseTotal: 0,
        percent: 0,
        path: null,
        error: message,
      })
    }
  }, async (error: unknown) => {
    const cancelled = isDuplicateAnalysisCancelled(error)
      || (error instanceof Error && error.name === 'DuplicateAnalysisCancelledError')
    const message = error instanceof Error ? error.message : String(error)
    await updateJobStatusWithRetry(runtime.db, jobId, cancelled ? 'cancelled' : 'failed', {
      finishedAt: Date.now(),
      error: message,
    }).catch((statusError: unknown) => {
      logSidecar('duplicates.analysis.failure-status.failed', { jobId, error: statusError }, 'error')
    })
    publishDuplicateProgress(state, {
      ...progress,
      status: cancelled ? 'cancelled' : 'failed',
      phase: 'finalizing',
      phaseCurrent: 0,
      phaseTotal: 0,
      percent: 0,
      path: null,
      error: message,
    })
  }).finally(() => state.duplicateAnalysisJobs.delete(jobId))
  state.duplicateAnalysisJobs.set(jobId, { cancel: () => execution.cancel(), completion })
  return { jobId }
}

function startPlanExecution(
  state: HostState,
  input: Record<string, unknown>,
): { requestId: string; jobId: string } {
  const runtime = requireRuntime(state)
  assertNoActiveScan(runtime)
  const requestId = `plan-${randomUUID()}`
  const jobId = asJobId(randomUUID())
  const module = (typeof input.module === 'string' ? input.module : 'rules') as PlanExecutionProgress['module']
  const plan = asRecord(input.plan)
  const duplicateJobId = typeof input.duplicateJobId === 'string' ? input.duplicateJobId : null
  const selectedOps = Array.isArray(input.selectedOps)
    ? input.selectedOps.filter((item) => typeof item === 'number')
    : []
  const ops = Array.isArray(plan.ops) ? plan.ops : []
  const progress: PlanExecutionProgress = {
    requestId,
    jobId,
    module,
    status: 'running',
    current: 0,
    total: input.selectedOps == null ? ops.length : selectedOps.length,
    ok: 0,
    skipped: 0,
    failed: 0,
    path: null,
  }
  const record: PlanExecutionState = {
    jobId,
    status: 'queued',
    progress,
    result: null,
    error: null,
    completion: Promise.resolve(),
  }
  state.planExecutions.set(requestId, record)
  state.planExecutionProgress = progress

  const execution = state.fileOperationTail.then(() => {
    record.status = 'running'
    state.emit('plan.execution-progress', record.progress)
    return runTaskWorker<PlanExecutionResult>({
      workerPath: state.workerPath('task-worker.mjs'),
      dbPath: runtime.paths.dbPath,
      quarantineDir: runtime.paths.quarantineDir,
      task: duplicateJobId
        ? {
          kind: 'duplicate-plan-execute',
          libraryId: String(input.libraryId ?? ''),
          jobId,
          duplicateJobId,
          duplicateKind: typeof input.duplicateKind === 'string' ? input.duplicateKind : undefined,
          deselectedEntryIds: Array.isArray(input.deselectedEntryIds)
            ? input.deselectedEntryIds.filter((item): item is string => typeof item === 'string')
            : [],
        }
        : { kind: 'plan-execute', ...(input as object), jobId },
      onProgress: (value: unknown) => {
        const next = {
          ...(value && typeof value === 'object' ? value : {}),
          requestId,
          jobId,
          module,
        } as PlanExecutionProgress
        record.progress = next
        state.planExecutionProgress = next
        state.emit('plan.execution-progress', next)
      },
    })
  })
  state.fileOperationTail = execution.then(() => undefined, () => undefined)
  record.completion = execution.then(
    (result) => {
      record.status = result.status
      record.result = result
      record.progress = {
        ...record.progress,
        jobId: result.jobId,
        status: result.status,
      }
      state.planExecutionProgress = record.progress
      state.emit('plan.execution-progress', record.progress)
      publishPlanExecutionFinished(state, {
        requestId,
        jobId: record.jobId,
        status: result.status,
        result,
        error: null,
      })
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      record.status = 'failed'
      record.error = message
      record.progress = {
        ...record.progress,
        status: 'failed',
        path: null,
      }
      state.planExecutionProgress = record.progress
      state.emit('plan.execution-progress', record.progress)
      publishPlanExecutionFinished(state, {
        requestId,
        jobId: record.jobId,
        status: 'failed',
        result: null,
        error: message,
      })
    },
  )
  void record.completion.catch(() => undefined)
  return { requestId, jobId }
}

function publishPlanExecutionFinished(state: HostState, event: PlanExecutionFinishedEvent): void {
  state.emit('plan.execution-finished', event)
}

function publishDuplicateProgress(state: HostState, progress: DuplicateAnalysisProgress) {
  state.duplicateAnalysisProgress = progress
  if (progress.jobId) state.duplicateAnalysisProgressByJob.set(progress.jobId, progress)
  state.emit('duplicates.analysis-progress', progress)
}

function duplicateProgress(state: HostState, input: Record<string, unknown>) {
  const jobId = typeof input.jobId === 'string' && input.jobId ? input.jobId : null
  if (jobId) return state.duplicateAnalysisProgressByJob.get(jobId) ?? null
  return state.duplicateAnalysisProgress
}

async function cancelDuplicateAnalysis(state: HostState, input: Record<string, unknown>) {
  const jobId = String(input.jobId ?? '')
  const job = state.duplicateAnalysisJobs.get(jobId)
  if (!job) return { cancelled: false }
  await updateJobStatusWithRetry(requireRuntime(state).db, jobId, 'cancelling')
    .catch((error: unknown) => {
      logSidecar('duplicates.analysis.cancel-status.failed', { jobId, error }, 'error')
    })
  job.cancel()
  return { cancelled: true }
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

function numberInput(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined
}

function keepStrategyInput(value: unknown): KeepStrategy {
  return value === 'oldest'
    || value === 'shortest_path'
    || value === 'longest_path'
    || value === 'shortest_name'
    || value === 'longest_name'
    || value === 'name_quality'
    || value === 'preferred_dir'
    ? value
    : 'newest'
}

function mimeFor(extension: string): string {
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.bmp') return 'image/bmp'
  if (extension === '.avif') return 'image/avif'
  return 'image/jpeg'
}
