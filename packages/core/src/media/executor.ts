import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import sharp from 'sharp'
import type { MediaMergeCheckpoint, MediaMergePlan, MediaMergeProgress } from '@nestify/shared'
import { classifyKind } from '../fs/kind.ts'
import { imageClipProbe, isImageClip, normalizeImageClip } from './image-clip.ts'
import {
  findFfmpegPath,
  findFfprobePath,
  probeVideo,
  runFfmpeg,
  streamCopyMergeReason,
  type FfmpegProbeResult,
} from './ffmpeg.ts'
import { MediaMergeCancelledError, MediaMergeInterruptedError } from './errors.ts'
import { calculateImageLayout, validateImageLayout } from './layout.ts'
import { MediaMergeWorkspace, mediaMergeStageCount, type MediaMergeResumeInput } from './resume.ts'
import {
  buildStreamCopyMergeCommand,
  buildVideoMergeCommand,
  streamCopyControlsReason,
  trimmedDuration,
  validateVideoMergeControls,
} from './video-command.ts'

export {
  buildConcatListContent,
  buildStreamCopyMergeCommand,
  buildVideoMergeCommand,
  streamCopyControlsReason,
} from './video-command.ts'

const MIN_TRIM_SECONDS = 0.1

export interface MediaMergeExecuteInput {
  jobId?: string
  plan: MediaMergePlan
  workspacePath?: string
  resume?: MediaMergeResumeInput
  signal?: AbortSignal
  onProgress?: (progress: MediaMergeProgress) => void
}

interface MediaMergeExecution {
  jobId: string
  outputPath: string
}

export async function executeMediaMerge(
  input: MediaMergeExecuteInput,
): Promise<MediaMergeExecution> {
  if (input.plan.kind === 'image') return executeImageMerge(input)
  return executeVideoMerge(input)
}

async function executeImageMerge(input: MediaMergeExecuteInput): Promise<MediaMergeExecution> {
  const jobId = input.jobId ?? randomUUID()
  let workspace: MediaMergeWorkspace | null = null
  const emit = createProgressEmitter(input, jobId, () => workspace)
  let temporaryPath: string | null = null

  try {
    emit('validating', 0, 0)
    const items = await validatePlanInputs(input.plan)
    if (input.workspacePath) {
      workspace = await MediaMergeWorkspace.open({
        workspacePath: input.workspacePath,
        jobId,
        plan: input.plan,
        resume: input.resume,
        totalStages: mediaMergeStageCount(input.plan),
      })
    }
    emit('analyzing', 5, 0)

    const settings = input.plan.image
    if (!settings) throw new Error('图片合并缺少输出设置')
    const dimensions: Array<{ width: number; height: number }> = []
    for (const [index, item] of items.entries()) {
      throwIfCancelled(input.signal)
      const metadata = await sharp(item.path, { pages: 1 }).metadata()
      const oriented = orientedDimensions(metadata.width, metadata.height, metadata.orientation)
      if (!oriented.width || !oriented.height) throw new Error(`无法读取图片尺寸：${item.path}`)
      dimensions.push(oriented)
      emit('analyzing', 5 + Math.round(((index + 1) / items.length) * 15), index + 1)
    }

    const layout = calculateImageLayout(dimensions, settings)
    validateImageLayout(layout)
    await workspace?.completeStage('analysis')

    emit('preparing', 22, items.length)
    const allocation = await allocateResumableOutputPath(
      input.plan.outputPath,
      workspace,
      'composite',
    )
    if (allocation.completed) {
      await workspace?.remove()
      emit('completed', 100, items.length, allocation.path)
      return { jobId, outputPath: allocation.path }
    }
    const output = allocation.path
    temporaryPath = temporaryOutputPath(output)

    const layers: Array<{ input: Buffer; left: number; top: number }> = []
    for (const [index, item] of items.entries()) {
      throwIfCancelled(input.signal)
      const placement = layout.placements[index]!
      const stage = `layer-${index}`
      const layerPath = workspace ? join(workspace.path, `layer-${String(index).padStart(5, '0')}.png`) : null
      let buffer: Buffer
      if (workspace && layerPath && workspace.hasCompleted(stage)) {
        buffer = await readFile(layerPath)
      } else {
        let pipeline = sharp(item.path, { pages: 1 })
          .rotate()
          .resize(layout.settings.layout === 'horizontal' ? { height: placement.height } : { width: placement.width })
        if (settings.background === 'white') pipeline = pipeline.flatten({ background: '#ffffff' })
        if (layerPath) {
          await pipeline.png({ compressionLevel: 0 }).toFile(layerPath)
          buffer = await readFile(layerPath)
        } else {
          buffer = await pipeline.png({ compressionLevel: 0 }).toBuffer()
        }
        await workspace?.completeStage(stage)
      }
      layers.push({ input: buffer, left: placement.left, top: placement.top })
      emit('processing', 25 + Math.round(((index + 1) / items.length) * 70), index + 1)
    }

    throwIfCancelled(input.signal)
    const background = settings.background === 'transparent'
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 }
    let canvas = sharp({
      create: {
        width: layout.canvasWidth,
        height: layout.canvasHeight,
        channels: 4,
        background,
      },
    }).composite(layers)
    if (settings.format === 'jpg') {
      canvas = canvas.jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    } else if (settings.format === 'webp') {
      canvas = canvas.webp({ quality: 90 })
    } else {
      canvas = canvas.png({ compressionLevel: 8 })
    }
    await canvas.toFile(temporaryPath)
    await workspace?.completeStage('composite')

    throwIfCancelled(input.signal)
    emit('finalizing', 97, items.length, output)
    await rename(temporaryPath, output)
    temporaryPath = null
    const result = await stat(output)
    if (!result.isFile()) throw new Error('合并输出不是普通文件')
    await workspace?.remove()
    emit('completed', 100, items.length, output)
    return { jobId, outputPath: output }
  } catch (error) {
    const cancelled = isCancellation(error, input.signal)
    const resumable = !cancelled && workspace != null
    if (cancelled || !resumable) await workspace?.remove().catch(() => undefined)
    if (cancelled) emit('cancelled', 100, 0, null, null, null, false)
    else emit(
      'failed',
      100,
      0,
      workspace?.checkpoint.outputPath ?? null,
      errorMessage(error),
      workspace?.checkpoint ?? null,
      resumable,
    )
    throw error
  } finally {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function executeVideoMerge(input: MediaMergeExecuteInput): Promise<MediaMergeExecution> {
  const jobId = input.jobId ?? randomUUID()
  let workspace: MediaMergeWorkspace | null = null
  const emit = createProgressEmitter(input, jobId, () => workspace)
  let temporaryPath: string | null = null
  let temporaryConcatPath: string | null = null

  try {
    emit('validating', 0, 0)
    if (!findFfmpegPath()) throw new Error('未找到可用 FFmpeg，请安装 FFmpeg 或设置 NESTIFY_FFMPEG_PATH')
    const ffprobePath = findFfprobePath()
    if (!ffprobePath) throw new Error('未找到可用 ffprobe，请安装 FFmpeg 或设置 NESTIFY_FFPROBE_PATH')
    const items = await validatePlanInputs(input.plan)
    const settings = input.plan.video
    if (!settings) throw new Error('视频合并缺少输出设置')

    emit('analyzing', 5, 0)
    const probes: FfmpegProbeResult[] = []
    for (const [index, item] of items.entries()) {
      throwIfCancelled(input.signal)
      const probe = await probeVideo(item.path, { ffprobePath, signal: input.signal })
      const normalized = normalizeImageClip(item)
      const imageAware = isImageClip(normalized)
        ? imageClipProbe(probe.width, probe.height, normalized.imageDurationSeconds)
        : probe
      const end = imageAware.durationSeconds - (isImageClip(normalized) ? 0 : item.trimEndOffset ?? 0)
      const start = isImageClip(normalized) ? 0 : item.trimStart
      if (end - start < MIN_TRIM_SECONDS) {
        throw new Error(`裁剪后时长必须大于 ${MIN_TRIM_SECONDS} 秒：${item.path}`)
      }
      probes.push(imageAware)
      emit('analyzing', 5 + Math.round(((index + 1) / items.length) * 15), index + 1)
    }
    validateVideoMergeControls(items, probes, settings)
    if (input.workspacePath) {
      workspace = await MediaMergeWorkspace.open({
        workspacePath: input.workspacePath,
        jobId,
        plan: input.plan,
        resume: input.resume,
        totalStages: mediaMergeStageCount(input.plan),
      })
    }
    await workspace?.completeStage('analysis')

    const compatibilityReason = streamCopyMergeReason(probes)
    const controlsReason = streamCopyControlsReason(items, settings)
    const requestedMode = settings.encodingMode ?? 'auto'
    const useStreamCopy = requestedMode === 'stream-copy'
      || (requestedMode === 'auto' && compatibilityReason === null && controlsReason === null)
    if (requestedMode === 'stream-copy') {
      if (compatibilityReason) throw new Error(`无法使用快速流复制：${compatibilityReason}`)
      if (controlsReason) throw new Error(`无法使用快速流复制：${controlsReason}`)
    }

    emit('preparing', 22, items.length)
    const allocation = await allocateResumableOutputPath(
      input.plan.outputPath,
      workspace,
      useStreamCopy ? 'concat' : 'final',
    )
    if (allocation.completed) {
      await workspace?.remove()
      emit('completed', 100, items.length, allocation.path)
      return { jobId, outputPath: allocation.path }
    }
    const output = allocation.path
    temporaryPath = temporaryOutputPath(output)

    let args: string[]
    let totalDuration: number
    let concatContent: string | null = null
    let runCommand: () => Promise<void>
    const emitFfmpegProgress = (seconds: number, duration: number, count: number) => {
      const ratio = duration > 0 ? Math.min(1, Math.max(0, seconds / duration)) : 0
      emit('processing', 25 + Math.round(ratio * 70), Math.round(ratio * count))
    }
    if (useStreamCopy) {
      temporaryConcatPath = concatListPath(output)
      const command = buildStreamCopyMergeCommand(items, probes, temporaryPath, temporaryConcatPath)
      args = command.args
      totalDuration = command.totalDuration
      concatContent = command.concatContent
      await writeFile(temporaryConcatPath, concatContent, 'utf8')
      runCommand = () => runFfmpeg(args, {
        signal: input.signal,
        onProgress: ({ seconds }) => emitFfmpegProgress(seconds, totalDuration, items.length),
      })
    } else {
      if (workspace) {
        const activeWorkspace = workspace
        const segmentDurations: number[] = []
        for (const [index, item] of items.entries()) {
          const stage = `segment-${index}`
          const segmentPath = join(workspace.path, `${stage}.mp4`)
          const duration = trimmedDuration(item, probes[index]!)
          segmentDurations.push(duration)
          if (!activeWorkspace.hasCompleted(stage) || !existsSync(segmentPath)) {
            const command = buildVideoMergeCommand([item], [probes[index]!], segmentPath, settings)
            await runFfmpeg(command.args, {
              signal: input.signal,
              onProgress: ({ seconds }) => emitFfmpegProgress(seconds, duration, 1),
            })
            await activeWorkspace.completeStage(stage)
          }
        }
        const finalItems = items.map((item, index) => ({
          ...item,
          path: join(activeWorkspace.path, `segment-${index}.mp4`),
          trimStart: 0,
          trimEndOffset: null,
        }))
        const finalProbes = probes.map((probe, index) => ({
          ...probe,
          durationSeconds: segmentDurations[index]!,
        }))
        const command = buildVideoMergeCommand(finalItems, finalProbes, temporaryPath, settings)
        args = command.args
        totalDuration = command.totalDuration
        runCommand = () => runFfmpeg(args, {
          signal: input.signal,
          onProgress: ({ seconds }) => emitFfmpegProgress(seconds, totalDuration, items.length),
        })
      } else {
        const command = buildVideoMergeCommand(items, probes, temporaryPath, settings)
        args = command.args
        totalDuration = command.totalDuration
        runCommand = () => runFfmpeg(args, {
          signal: input.signal,
          onProgress: ({ seconds }) => emitFfmpegProgress(seconds, totalDuration, items.length),
        })
      }
    }

    await runCommand()
    await workspace?.completeStage(useStreamCopy ? 'concat' : 'final')

    throwIfCancelled(input.signal)
    emit('finalizing', 97, items.length, output)
    await rename(temporaryPath, output)
    temporaryPath = null
    const result = await stat(output)
    if (!result.isFile()) throw new Error('合并输出不是普通文件')
    await workspace?.remove()
    emit('completed', 100, items.length, output)
    return { jobId, outputPath: output }
  } catch (error) {
    const cancelled = isCancellation(error, input.signal)
    const resumable = !cancelled && workspace != null
    if (cancelled || !resumable) await workspace?.remove().catch(() => undefined)
    if (cancelled) emit('cancelled', 100, 0, null, null, null, false)
    else emit(
      'failed',
      100,
      0,
      workspace?.checkpoint.outputPath ?? null,
      errorMessage(error),
      workspace?.checkpoint ?? null,
      resumable,
    )
    throw error
  } finally {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined)
    if (temporaryConcatPath) await rm(temporaryConcatPath, { force: true }).catch(() => undefined)
  }
}

async function validatePlanInputs(plan: MediaMergePlan) {
  const items = [...plan.items].sort((a, b) => a.orderIndex - b.orderIndex)
  if (items.length < 1) throw new Error('合并至少需要一个输入文件')
  if (plan.kind === 'image' && items.length < 2) throw new Error('图片合并至少需要两个图片文件')
  for (const item of items) {
    const info = await stat(item.path)
    if (!info.isFile()) throw new Error(`输入不是普通文件：${item.path}`)
    const fileKind = classifyKind(item.path, false)
    const allowed = fileKind === plan.kind || (plan.kind === 'video' && isImageClip(item))
    if (!allowed) {
      throw new Error(`输入类型已变化：${item.path}`)
    }
    if (item.mtime != null && Math.abs(info.mtimeMs - item.mtime) > 1) {
      throw new Error(`输入文件在执行前发生变化：${item.path}`)
    }
    if (item.size != null && info.size !== item.size) {
      throw new Error(`输入文件大小发生变化：${item.path}`)
    }
    if (plan.kind === 'video') validateVideoTrim(item.trimStart, item.trimEndOffset, item.path)
  }
  return items
}

function validateVideoTrim(start: number, endOffset: number | null, path: string): void {
  if (!Number.isFinite(start) || start < 0) throw new Error(`裁剪起点无效：${path}`)
  if (endOffset != null && (!Number.isFinite(endOffset) || endOffset < 0)) {
    throw new Error(`结尾裁剪秒数无效：${path}`)
  }
}

function createProgressEmitter(
  input: MediaMergeExecuteInput,
  jobId: string,
  getWorkspace: () => MediaMergeWorkspace | null,
) {
  return (
    phase: MediaMergeProgress['phase'] | MediaMergeProgress['status'],
    percent: number,
    current: number,
    outputPath: string | null = null,
    error: string | null = null,
    checkpointOverride?: MediaMergeCheckpoint | null,
    resumeSupportedOverride?: boolean,
  ) => {
    const completed = phase === 'completed'
    const failed = phase === 'failed'
    const cancelled = phase === 'cancelled'
    if (!completed && !failed && !cancelled && input.signal?.aborted) return
    input.onProgress?.({
      jobId,
      status: completed ? 'completed' : failed ? 'failed' : cancelled ? 'cancelled' : 'running',
      phase: completed || failed || cancelled
        ? 'finalizing'
        : phase as MediaMergeProgress['phase'],
      percent: clampPercent(percent),
      current,
      total: input.plan.items.length,
      outputPath,
      error,
      checkpoint: checkpointOverride !== undefined
        ? checkpointOverride
        : completed
          ? null
          : getWorkspace()?.checkpoint ?? null,
      resumeSupported: resumeSupportedOverride !== undefined
        ? resumeSupportedOverride
        : completed
          ? false
          : true,
    })
  }
}

function allocateOutputPath(preferredPath: string): string {
  const directory = dirname(preferredPath)
  const parsed = parse(preferredPath)
  let candidate = preferredPath
  let suffix = 1
  while (exists(candidate)) {
    candidate = join(directory, `${parsed.name}-${suffix}${parsed.ext}`)
    suffix += 1
    if (suffix > 9999) throw new Error('输出目录中同名文件过多，请更换文件名')
  }
  return candidate
}

async function allocateResumableOutputPath(
  preferredPath: string,
  workspace: MediaMergeWorkspace | null,
  finalStage: string,
): Promise<{ path: string; completed: boolean }> {
  if (!workspace) return { path: allocateOutputPath(preferredPath), completed: false }

  const checkpointOutputPath = workspace.checkpoint.outputPath
  if (!exists(checkpointOutputPath)) {
    return { path: checkpointOutputPath, completed: false }
  }
  if (workspace.hasCompleted(finalStage)) {
    const info = await stat(checkpointOutputPath)
    if (!info.isFile() || info.size <= 0) {
      throw new Error('恢复失败：已完成的合并输出无效')
    }
    return { path: checkpointOutputPath, completed: true }
  }

  const output = allocateOutputPath(checkpointOutputPath)
  await workspace.setOutputPath(output)
  return { path: output, completed: false }
}

function exists(path: string): boolean {
  return existsSync(path)
}

function temporaryOutputPath(outputPath: string): string {
  const parsed = parse(outputPath)
  return join(parsed.dir, `${parsed.name}.nestify-${randomUUID()}.tmp${parsed.ext}`)
}

function concatListPath(outputPath: string): string {
  const parsed = parse(outputPath)
  return join(parsed.dir, `${parsed.name}.nestify-concat-${randomUUID()}.txt`)
}

function orientedDimensions(
  width: number | undefined,
  height: number | undefined,
  orientation: number | undefined,
): { width: number; height: number } {
  if (!width || !height) return { width: 0, height: 0 }
  return orientation != null && orientation >= 5
    ? { width: height, height: width }
    : { width, height }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof MediaMergeInterruptedError) throw signal.reason
  throw new MediaMergeCancelledError()
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return error instanceof MediaMergeCancelledError
    || Boolean(signal?.aborted && error instanceof Error && error.name === 'AbortError')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}
