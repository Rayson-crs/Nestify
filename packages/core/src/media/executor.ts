import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
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
  finalizeMediaMergeOutput,
  isCancellation,
  ManagedTempFiles,
  publishTemporaryFile,
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
  validateVideoMergeCommandScale,
  validateVideoMergeControls,
  validateVideoMergeResources,
  videoMergeOutputDuration,
  VIDEO_CHAPTER_METADATA_PLACEHOLDER,
  videoMergeChapterMetadata,
} from './video-command.ts'
import { resolveVideoEncoder } from './video-encoder.ts'
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
  const managedTempFiles = new ManagedTempFiles()

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
    validateVideoMergeResources(items, probes)
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
      const expectedDuration = videoMergeOutputDuration(items, probes, settings)
      const warnings = await finalizeMediaMergeOutput({
        plan: input.plan,
        outputPath: allocation.path,
        expectedDurationSeconds: expectedDuration,
        probeDuration: async (path) => (await probeVideo(path, { ffprobePath, signal: input.signal })).durationSeconds,
      })
      await workspace?.remove()
      emit('completed', 100, items.length, allocation.path, null, null, false, warnings)
      return { jobId, outputPath: allocation.path, warnings }
    }
    const output = allocation.path
    temporaryPath = managedTempFiles.track(temporaryOutputPath(output))

    let args: string[]
    let totalDuration: number
    let concatContent: string | null = null
    let runCommand: () => Promise<void>
    let execution: MediaMergeProgress['execution']
    const ffmpegPath = findFfmpegPath()
    const emitProcessingWork = (completedWork: number, totalWork: number, current: number) => {
      const progress = processingSnapshot(completedWork, totalWork, current)
      emit('processing', progress.percent, progress.current, null, null, undefined, undefined, undefined, execution)
    }
    if (useStreamCopy) {
      execution = {
        encoder: 'copy',
        processor: 'cpu',
        ffmpegPath,
        commands: [],
      }
      temporaryConcatPath = managedTempFiles.track(concatListPath(output))
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
      const videoEncoder = await resolveVideoEncoder(settings)
      execution = {
        encoder: videoEncoder.id,
        processor: videoEncoder.id === 'libx264' || videoEncoder.id === 'libvpx-vp9' || videoEncoder.id === 'mpeg4' ? 'cpu' : 'gpu',
        hwaccel: videoEncoder.hwaccel ?? null,
        preset: videoEncoder.preset ?? null,
        ffmpegPath,
        commands: [],
      }
      const selectedEncoderArgs = videoEncoder.args
      const hardwareDecode = videoEncoder.hwaccel === 'cuda'
      const prepareChapterArgs = async (commandArgs: string[], metadata: string | null) => {
        if (!metadata || !commandArgs.includes(VIDEO_CHAPTER_METADATA_PLACEHOLDER)) return commandArgs
        temporaryChapterPath ??= managedTempFiles.track(chapterMetadataPath(output))
        await writeFile(temporaryChapterPath, metadata, 'utf8')
        const resolvedArgs = commandArgs.map((arg) =>
          arg === VIDEO_CHAPTER_METADATA_PLACEHOLDER ? temporaryChapterPath! : arg
        )
        validateVideoMergeCommandScale(resolvedArgs)
        return resolvedArgs
      }
      const recordCommand = (stage: string, commandArgs: readonly string[]) => {
        execution = {
          ...execution!,
          commands: [...execution!.commands, {
            stage,
            command: [ffmpegPath ?? 'ffmpeg', ...commandArgs].join(' '),
            args: [...commandArgs],
          }],
        }
        emit('processing', processingSnapshot(0, 1, 0).percent, 0, null, null, undefined, undefined, undefined, execution)
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
        const segmentSettings = renderSettings
        for (const [index, item] of items.entries()) {
          const stage = `segment-${index}`
          const segmentPath = segmentPaths[index]!
          const duration = segmentDurations[index]!
          if (!reusableSegments[index]) {
            const command = buildVideoMergeCommand(
              [item],
              [probes[index]!],
              segmentPath,
              segmentSettings,
              { chapters: false, videoEncoderArgs: selectedEncoderArgs, hardwareDecode },
            )
            recordCommand(`segment-${index}`, command.args)
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
        const command = buildVideoMergeCommand(finalItems, finalProbes, temporaryPath, settings, { videoEncoderArgs: selectedEncoderArgs, hardwareDecode })
        args = await prepareChapterArgs(
          command.args,
          videoMergeChapterMetadata(items, probes, settings),
        )
        recordCommand('final', args)
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
        const command = buildVideoMergeCommand(items, probes, temporaryPath, settings, { videoEncoderArgs: selectedEncoderArgs, hardwareDecode })
        args = await prepareChapterArgs(command.args, command.chapterMetadata)
        recordCommand('merge', args)
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
    emit('processing', 95, items.length, null, null, undefined, undefined, undefined, execution)
    await workspace?.completeStage(useStreamCopy ? 'concat' : 'final')

    throwIfCancelled(input.signal)
    emit('finalizing', 97, items.length, output, null, undefined, undefined, undefined, execution)
    await publishTemporaryFile(temporaryPath, output)
    temporaryPath = null
    const warnings = await finalizeMediaMergeOutput({
      plan: input.plan,
      outputPath: output,
      expectedDurationSeconds: totalDuration,
      probeDuration: async (path) => (await probeVideo(path, { ffprobePath, signal: input.signal })).durationSeconds,
    })
    await workspace?.remove()
    emit('completed', 100, items.length, output, null, null, false, warnings, execution)
    return { jobId, outputPath: output, warnings }
  } catch (error) {
    const cancelled = isCancellation(error, input.signal)
    const resumable = !cancelled && (workspace?.canResume ?? false)
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
      undefined,
      execution,
    )
    throw error
  } finally {
    await managedTempFiles.cleanup()
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
