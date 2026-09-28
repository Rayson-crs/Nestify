import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { link, rm, stat } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import type { MediaMergeCheckpoint, MediaMergePlan, MediaMergeProgress } from '@nestify/shared'
import { classifyKind } from '../fs/kind.ts'
import { MediaMergeCancelledError, MediaMergeInterruptedError } from './errors.ts'
import { isAnimatedImage, isImageClip } from './image-clip.ts'
import type { MediaMergeResumeInput, MediaMergeWorkspace } from './resume.ts'

export interface MediaMergeExecuteInput {
  jobId?: string
  plan: MediaMergePlan
  workspacePath?: string
  resume?: MediaMergeResumeInput
  signal?: AbortSignal
  onProgress?: (progress: MediaMergeProgress) => void
  onLog?: (event: string, details?: Record<string, unknown>) => void
}

export interface MediaMergeExecution {
  jobId: string
  outputPath: string
  warnings?: string[]
}

export const MAX_IMAGE_INPUT_COUNT = 512
export const MAX_IMAGE_TOTAL_SOURCE_PIXELS = 150_000_000
export const MAX_IMAGE_COMPOSITE_ESTIMATED_BYTES = 1_500_000_000

export class ManagedTempFiles {
  private readonly paths = new Set<string>()

  track(path: string): string {
    this.paths.add(path)
    return path
  }

  async cleanup(): Promise<void> {
    const paths = [...this.paths]
    this.paths.clear()
    await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)))
  }
}

export async function validatePlanInputs(
  plan: MediaMergePlan,
  options: {
    signal?: AbortSignal
    onProgress?: (completed: number, total: number) => void
  } = {},
) {
  const items = [...plan.items].sort((a, b) => a.orderIndex - b.orderIndex)
  if (items.length < 1) throw new Error('合并至少需要一个输入文件')
  for (const [index, item] of items.entries()) {
    throwIfCancelled(options.signal)
    const info = await stat(item.path)
    if (!info.isFile()) throw new Error(`输入不是普通文件：${item.path}`)
    const fileKind = classifyKind(item.path, false)
    const allowed = fileKind === plan.kind
      || (plan.kind === 'video' && (isImageClip(item) || isAnimatedImage(item.path)))
    if (!allowed) throw new Error(`输入类型已变化：${item.path}`)
    if (item.mtime != null && Math.abs(info.mtimeMs - item.mtime) > 1) {
      throw new Error(`输入文件在执行前发生变化：${item.path}`)
    }
    if (item.size != null && info.size !== item.size) {
      throw new Error(`输入文件大小发生变化：${item.path}`)
    }
    if (plan.kind === 'video') validateVideoTrim(item.trimStart, item.trimEndOffset, item.path)
    options.onProgress?.(index + 1, items.length)
  }
  return items
}

export function createProgressEmitter(
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
    warnings?: string[],
    execution?: MediaMergeProgress['execution'],
  ) => {
    const completed = phase === 'completed'
    const failed = phase === 'failed'
    const cancelled = phase === 'cancelled'
    if (!completed && !failed && !cancelled && input.signal?.aborted) return
    input.onProgress?.({
      jobId,
      status: completed ? 'completed' : failed ? 'failed' : cancelled ? 'cancelled' : 'running',
      phase: completed || failed || cancelled ? 'finalizing' : phase as MediaMergeProgress['phase'],
      percent: clampPercent(percent),
      current,
      total: input.plan.items.length,
      outputPath,
      error,
      warnings,
      execution,
      checkpoint: checkpointOverride !== undefined
        ? checkpointOverride
        : completed
          ? null
          : getWorkspace()?.checkpoint ?? null,
      resumeSupported: resumeSupportedOverride !== undefined
        ? resumeSupportedOverride
        : completed
          ? false
          : getWorkspace()?.canResume ?? false,
    })
  }
}

export async function allocateResumableOutputPath(
  preferredPath: string,
  workspace: MediaMergeWorkspace | null,
  finalStage: string,
): Promise<{ path: string; completed: boolean }> {
  if (!workspace) return { path: allocateOutputPath(preferredPath), completed: false }

  const checkpointOutputPath = workspace.checkpoint.outputPath
  if (!existsSync(checkpointOutputPath)) return { path: checkpointOutputPath, completed: false }
  if (workspace.hasCompleted(finalStage)) {
    const info = await stat(checkpointOutputPath)
    if (!info.isFile() || info.size <= 0) throw new Error('恢复失败：已完成的合并输出无效')
    return { path: checkpointOutputPath, completed: true }
  }

  const output = allocateOutputPath(checkpointOutputPath)
  await workspace.setOutputPath(output)
  return { path: output, completed: false }
}

export function temporaryOutputPath(outputPath: string): string {
  const parsed = parse(outputPath)
  return join(parsed.dir, `${parsed.name}.nestify-${randomUUID()}.tmp${parsed.ext}`)
}

export async function finalizeMediaMergeOutput(input: {
  plan: MediaMergePlan
  outputPath: string
  expectedDurationSeconds?: number
  probeDuration?: (path: string) => Promise<number>
  expectedDimensions?: { width: number; height: number }
  probeDimensions?: (path: string) => Promise<{ width: number; height: number }>
}): Promise<string[]> {
  const info = await stat(input.outputPath)
  if (!info.isFile() || info.size <= 0) throw new Error('合并输出大小校验失败')

  if (input.expectedDurationSeconds != null) {
    if (!input.probeDuration) throw new Error('合并输出时长校验不可用')
    const actualDuration = await input.probeDuration(input.outputPath)
    const tolerance = Math.max(0.25, input.expectedDurationSeconds * 0.02)
    if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - input.expectedDurationSeconds) > tolerance) {
      throw new Error(
        `合并输出时长校验失败：预计 ${input.expectedDurationSeconds.toFixed(2)} 秒，实际 ${actualDuration.toFixed(2)} 秒`,
      )
    }
  }

  if (input.expectedDimensions) {
    if (!input.probeDimensions) throw new Error('合并输出尺寸校验不可用')
    const actual = await input.probeDimensions(input.outputPath)
    if (actual.width !== input.expectedDimensions.width || actual.height !== input.expectedDimensions.height) {
      throw new Error(
        `合并输出尺寸校验失败：预计 ${input.expectedDimensions.width} x ${input.expectedDimensions.height}，`
          + `实际 ${actual.width} x ${actual.height}`,
      )
    }
  }

  if (!input.plan.deleteSourcesAfterSuccess) return []
  const failures: string[] = []
  for (const item of input.plan.items) {
    try {
      await rm(item.path)
    } catch (error) {
      failures.push(`${item.path}：${errorMessage(error)}`)
    }
  }
  return failures.length > 0
    ? [`合并已完成，但有 ${failures.length} 个源文件删除失败：${failures.join('；')}`]
    : []
}

export function temporaryLayerPath(outputPath: string, index: number): string {
  const parsed = parse(outputPath)
  return join(
    parsed.dir,
    `${parsed.name}.nestify-layer-${String(index).padStart(5, '0')}-${randomUUID()}.png`,
  )
}

export function validateImageMergeResources(input: {
  itemCount: number
  dimensions: Array<{ width: number; height: number }>
  layout: {
    canvasWidth: number
    canvasHeight: number
    placements: Array<{ width: number; height: number }>
  }
  animated: boolean
}): void {
  if (input.itemCount > MAX_IMAGE_INPUT_COUNT) {
    throw new Error(`图片合并最多支持 ${MAX_IMAGE_INPUT_COUNT} 个输入，请分批合并`)
  }

  const sourcePixels = input.dimensions.reduce(
    (total, dimension) => total + Math.max(0, dimension.width) * Math.max(0, dimension.height),
    0,
  )
  if (sourcePixels > MAX_IMAGE_TOTAL_SOURCE_PIXELS) {
    throw new Error(
      `图片输入共 ${sourcePixels} 像素，超过 ${MAX_IMAGE_TOTAL_SOURCE_PIXELS} 像素安全限制，请分批合并`,
    )
  }

  const outputPixels = input.animated
    ? input.layout.canvasWidth * input.layout.canvasHeight * input.itemCount
    : input.layout.canvasWidth * input.layout.canvasHeight
  const renderedPixels = input.animated
    ? outputPixels
    : input.layout.placements.reduce(
      (total, placement) => total + Math.max(0, placement.width) * Math.max(0, placement.height),
      0,
    )
  const estimatedBytes = (outputPixels + renderedPixels) * 4
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > MAX_IMAGE_COMPOSITE_ESTIMATED_BYTES) {
    throw new Error(
      `图片合成预计需要约 ${formatBytes(estimatedBytes)} 内存，超过 `
        + `${formatBytes(MAX_IMAGE_COMPOSITE_ESTIMATED_BYTES)} 安全限制，请降低尺寸或分批合并`,
    )
  }
}

export async function publishTemporaryFile(temporaryPath: string, outputPath: string): Promise<void> {
  try {
    await link(temporaryPath, outputPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new Error(`输出文件已存在，已阻止覆盖：${outputPath}`)
    }
    throw error
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof MediaMergeInterruptedError) throw signal.reason
  throw new MediaMergeCancelledError()
}

export function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return error instanceof MediaMergeCancelledError
    || Boolean(signal?.aborted && error instanceof Error && error.name === 'AbortError')
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateVideoTrim(start: number, endOffset: number | null, path: string): void {
  if (!Number.isFinite(start) || start < 0) throw new Error(`裁剪起点无效：${path}`)
  if (endOffset != null && (!Number.isFinite(endOffset) || endOffset < 0)) {
    throw new Error(`结尾裁剪秒数无效：${path}`)
  }
}

export function allocateOutputPath(preferredPath: string): string {
  const directory = dirname(preferredPath)
  const parsed = parse(preferredPath)
  let candidate = preferredPath
  let suffix = 1
  while (existsSync(candidate)) {
    candidate = join(directory, `${parsed.name}-${suffix}${parsed.ext}`)
    suffix += 1
    if (suffix > 9999) throw new Error('输出目录中同名文件过多，请更换文件名')
  }
  return candidate
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function formatBytes(value: number): string {
  if (!Number.isSafeInteger(value)) return '超过安全范围'
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)}MB`
  return `${(value / 1024).toFixed(0)}KB`
}
