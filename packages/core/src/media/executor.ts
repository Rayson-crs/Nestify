import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { imageClipProbe, isImageClip, normalizeImageClip } from './image-clip.ts'
import {
  findFfmpegPath,
  findFfprobePath,
  probeVideo,
  runFfmpeg,
  streamCopyMergeReason,
  type FfmpegProbeResult,
} from './ffmpeg.ts'
import {
  allocateResumableOutputPath,
  createProgressEmitter,
  errorMessage,
  isCancellation,
  temporaryOutputPath,
  throwIfCancelled,
  validatePlanInputs,
  type MediaMergeExecuteInput,
  type MediaMergeExecution,
} from './execution-shared.ts'
import { executeImageMerge } from './image-executor.ts'
import { MediaMergeWorkspace, mediaMergeStageCount } from './resume.ts'
import {
  buildStreamCopyMergeCommand,
  buildVideoMergeCommand,
  streamCopyControlsReason,
  trimmedDuration,
  validateVideoMergeControls,
  VIDEO_CHAPTER_METADATA_PLACEHOLDER,
  videoMergeChapterMetadata,
} from './video-command.ts'
import {
  probeRenderedSegments,
  processingSnapshot,
  renderedSegmentInputs,
  renderedSegmentMatchesExpectedDuration,
  segmentRenderSettings,
} from './video-execution.ts'

export {
  buildConcatListContent,
  buildStreamCopyMergeCommand,
  buildVideoMergeCommand,
  streamCopyControlsReason,
} from './video-command.ts'

const MIN_TRIM_SECONDS = 0.1

export type { MediaMergeExecuteInput, MediaMergeExecution } from './execution-shared.ts'

export async function executeMediaMerge(
  input: MediaMergeExecuteInput,
): Promise<MediaMergeExecution> {
  if (input.plan.kind === 'image') return executeImageMerge(input)
  return executeVideoMerge(input)
}

async function executeVideoMerge(input: MediaMergeExecuteInput): Promise<MediaMergeExecution> {
  const jobId = input.jobId ?? randomUUID()
  let workspace: MediaMergeWorkspace | null = null
  const emit = createProgressEmitter(input, jobId, () => workspace)
  let temporaryPath: string | null = null
  let temporaryConcatPath: string | null = null
  let temporaryChapterPath: string | null = null

  try {
    emit('validating', 0, 0)
    if (!findFfmpegPath()) throw new Error('未找到可用 FFmpeg，请安装 FFmpeg 或设置 NESTIFY_FFMPEG_PATH')
    const ffprobePath = findFfprobePath()
    if (!ffprobePath) throw new Error('未找到可用 ffprobe，请安装 FFmpeg 或设置 NESTIFY_FFPROBE_PATH')
    const items = await validatePlanInputs(input.plan, {
      signal: input.signal,
      onProgress: (completed, total) => emit(
        'validating',
        Math.round((completed / total) * 5),
        completed,
      ),
    })
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
    const emitProcessingWork = (completedWork: number, totalWork: number, current: number) => {
      const progress = processingSnapshot(completedWork, totalWork, current)
      emit('processing', progress.percent, progress.current)
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
        onProgress: ({ seconds }) => emitProcessingWork(
          seconds,
          totalDuration,
          (seconds / totalDuration) * items.length,
        ),
      })
    } else {
      const prepareChapterArgs = async (commandArgs: string[], metadata: string | null) => {
        if (!metadata || !commandArgs.includes(VIDEO_CHAPTER_METADATA_PLACEHOLDER)) return commandArgs
        temporaryChapterPath ??= chapterMetadataPath(output)
        await writeFile(temporaryChapterPath, metadata, 'utf8')
        return commandArgs.map((arg) => arg === VIDEO_CHAPTER_METADATA_PLACEHOLDER ? temporaryChapterPath! : arg)
      }
      if (workspace) {
        const activeWorkspace = workspace
        const segmentDurations = items.map((item, index) => trimmedDuration(item, probes[index]!))
        const segmentPaths = items.map((_, index) => join(activeWorkspace.path, `segment-${index}.mp4`))
        const totalSegmentDuration = segmentDurations.reduce((sum, duration) => sum + duration, 0)
        const estimatedFinalDuration = Math.max(
          0,
          totalSegmentDuration - (items.length - 1) * (
            settings.transition?.type === 'crossfade' ? settings.transition.durationSeconds : 0
          ),
        )
        const totalProcessingWork = totalSegmentDuration + estimatedFinalDuration
        let completedSegmentDuration = 0
        let completedSegmentCount = 0
        const reusableSegments = await Promise.all(segmentPaths.map(async (segmentPath, index) => {
          if (!activeWorkspace.hasCompleted(`segment-${index}`) || !existsSync(segmentPath)) return false
          try {
            const probe = await probeVideo(segmentPath, { ffprobePath, signal: input.signal })
            return renderedSegmentMatchesExpectedDuration(probe, segmentDurations[index]!)
          } catch {
            return false
          }
        }))
        for (const [index, segmentPath] of segmentPaths.entries()) {
          if (reusableSegments[index]) {
            completedSegmentDuration += segmentDurations[index]!
            completedSegmentCount += 1
          }
        }
        emitProcessingWork(completedSegmentDuration, totalProcessingWork, completedSegmentCount)
        const renderSettings = segmentRenderSettings(settings)
        for (const [index, item] of items.entries()) {
          const stage = `segment-${index}`
          const segmentPath = segmentPaths[index]!
          const duration = segmentDurations[index]!
          if (!reusableSegments[index]) {
            const command = buildVideoMergeCommand(
              [item],
              [probes[index]!],
              segmentPath,
              renderSettings,
              { chapters: false },
            )
            await runFfmpeg(command.args, {
              signal: input.signal,
              onProgress: ({ seconds }) => emitProcessingWork(
                completedSegmentDuration + Math.min(duration, Math.max(0, seconds)),
                totalProcessingWork,
                completedSegmentCount,
              ),
            })
            await activeWorkspace.completeStage(stage)
            completedSegmentDuration += duration
            completedSegmentCount += 1
            emitProcessingWork(completedSegmentDuration, totalProcessingWork, completedSegmentCount)
          }
        }
        const segmentProbes = await probeRenderedSegments(segmentPaths, {
          ffprobePath,
          signal: input.signal,
        })
        const rendered = renderedSegmentInputs(
          items,
          segmentPaths,
          segmentDurations,
          segmentProbes,
        )
        const finalItems = rendered.items
        const finalProbes = rendered.probes
        const command = buildVideoMergeCommand(finalItems, finalProbes, temporaryPath, settings)
        args = await prepareChapterArgs(
          command.args,
          videoMergeChapterMetadata(items, probes, settings),
        )
        totalDuration = command.totalDuration
        runCommand = () => runFfmpeg(args, {
          signal: input.signal,
          onProgress: ({ seconds }) => emitProcessingWork(
            totalSegmentDuration + Math.min(totalDuration, Math.max(0, seconds)),
            totalSegmentDuration + totalDuration,
            items.length,
          ),
        })
      } else {
        const command = buildVideoMergeCommand(items, probes, temporaryPath, settings)
        args = await prepareChapterArgs(command.args, command.chapterMetadata)
        totalDuration = command.totalDuration
        runCommand = () => runFfmpeg(args, {
          signal: input.signal,
          onProgress: ({ seconds }) => emitProcessingWork(
            seconds,
            totalDuration,
            (seconds / totalDuration) * items.length,
          ),
        })
      }
    }

    await runCommand()
    emitProcessingWork(totalDuration, totalDuration, items.length)
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
    if (cancelled && workspace == null && input.workspacePath) {
      await rm(input.workspacePath, { recursive: true, force: true }).catch(() => undefined)
    }
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
    if (temporaryChapterPath) await rm(temporaryChapterPath, { force: true }).catch(() => undefined)
  }
}

function concatListPath(outputPath: string): string {
  const parsed = parse(outputPath)
  return join(parsed.dir, `${parsed.name}.nestify-concat-${randomUUID()}.txt`)
}

function chapterMetadataPath(outputPath: string): string {
  const parsed = parse(outputPath)
  return join(parsed.dir, `${parsed.name}.nestify-chapters-${randomUUID()}.txt`)
}
