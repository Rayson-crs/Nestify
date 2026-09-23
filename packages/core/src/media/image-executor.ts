import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { MediaMergePlan } from '@nestify/shared'
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
import { imageItemDimensions, renderImageFrame } from './image-frame.ts'
import { calculateImageLayout, validateImageLayout } from './layout.ts'
import { MediaMergeWorkspace, mediaMergeStageCount } from './resume.ts'

export async function executeImageMerge(input: MediaMergeExecuteInput): Promise<MediaMergeExecution> {
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
    const animated = settings.format === 'gif'
    const dimensions: Array<{ width: number; height: number }> = []
    if (!animated) {
      for (const [index, item] of items.entries()) {
        throwIfCancelled(input.signal)
        const metadata = await sharp(item.path, { pages: 1 }).metadata()
        const oriented = imageItemDimensions(metadata, item.rotation)
        if (!oriented.width || !oriented.height) throw new Error(`无法读取图片尺寸：${item.path}`)
        dimensions.push(oriented)
        emit('analyzing', 5 + Math.round(((index + 1) / items.length) * 15), index + 1)
      }
    }

    const layout = animated
      ? gifFrameLayout(items.length, settings.gifWidth ?? 1080, settings.gifHeight ?? 1080)
      : calculateImageLayout(dimensions, settings)
    if (!animated) validateImageLayout(layout as ReturnType<typeof calculateImageLayout>)
    await workspace?.completeStage('analysis')

    emit('preparing', 22, items.length)
    const allocation = await allocateResumableOutputPath(input.plan.outputPath, workspace, 'composite')
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
        const rendered = await renderImageFrame(sharp, item, placement, settings.background)
        const pipeline = sharp(rendered)
        if (layerPath) {
          await pipeline.png({ compressionLevel: 0 }).toFile(layerPath)
          buffer = await readFile(layerPath)
        } else {
          buffer = await pipeline.png({ compressionLevel: 0 }).toBuffer()
        }
        await workspace?.completeStage(stage)
      }
      layers.push({
        input: buffer,
        left: animated ? 0 : placement.left,
        top: animated ? index * layout.canvasHeight : placement.top,
      })
      emit('processing', 25 + Math.round(((index + 1) / items.length) * 70), index + 1)
    }

    throwIfCancelled(input.signal)
    const background = settings.background === 'transparent'
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 }
    let canvas = sharp({
      create: {
        width: layout.canvasWidth,
        height: animated ? layout.canvasHeight * items.length : layout.canvasHeight,
        channels: 4,
        background,
        ...(animated ? { pageHeight: layout.canvasHeight } : {}),
      },
    }).composite(layers)
    if (settings.format === 'jpg') {
      canvas = canvas.jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    } else if (settings.format === 'webp') {
      canvas = canvas.webp({ quality: 90 })
    } else if (settings.format === 'gif') {
      const fallback = settings.gifFrameDurationSeconds ?? 3
      canvas = canvas.gif({
        loop: settings.gifLoopCount ?? 0,
        delay: items.map((item) => Math.max(100, Math.round(gifItemDuration(item, fallback) * 1000))),
      })
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
    else emit('failed', 100, 0, workspace?.checkpoint.outputPath ?? null, errorMessage(error), workspace?.checkpoint ?? null, resumable)
    throw error
  } finally {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function gifFrameLayout(itemCount: number, width: number, height: number) {
  const frameWidth = Math.max(1, Math.round(width))
  const frameHeight = Math.max(1, Math.round(height))
  return {
    settings: null,
    canvasWidth: frameWidth,
    canvasHeight: frameHeight,
    placements: Array.from({ length: itemCount }, () => ({ left: 0, top: 0, width: frameWidth, height: frameHeight })),
  }
}

function gifItemDuration(item: MediaMergePlan['items'][number], fallback: number): number {
  return item.imageClipSource === 'custom' && Number.isFinite(item.imageDurationSeconds)
    ? Math.min(120, Math.max(0.1, item.imageDurationSeconds ?? fallback))
    : fallback
}
