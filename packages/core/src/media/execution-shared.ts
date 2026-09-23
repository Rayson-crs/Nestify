import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import type { MediaMergeCheckpoint, MediaMergePlan, MediaMergeProgress } from '@nestify/shared'
import { classifyKind } from '../fs/kind.ts'
import { MediaMergeCancelledError, MediaMergeInterruptedError } from './errors.ts'
import { isImageClip } from './image-clip.ts'
import type { MediaMergeResumeInput, MediaMergeWorkspace } from './resume.ts'

export interface MediaMergeExecuteInput {
  jobId?: string
  plan: MediaMergePlan
  workspacePath?: string
  resume?: MediaMergeResumeInput
  signal?: AbortSignal
  onProgress?: (progress: MediaMergeProgress) => void
}

export interface MediaMergeExecution {
  jobId: string
  outputPath: string
}

export async function validatePlanInputs(plan: MediaMergePlan) {
  const items = [...plan.items].sort((a, b) => a.orderIndex - b.orderIndex)
  if (items.length < 1) throw new Error('合并至少需要一个输入文件')
  for (const item of items) {
    const info = await stat(item.path)
    if (!info.isFile()) throw new Error(`输入不是普通文件：${item.path}`)
    const fileKind = classifyKind(item.path, false)
    const allowed = fileKind === plan.kind || (plan.kind === 'video' && isImageClip(item))
    if (!allowed) throw new Error(`输入类型已变化：${item.path}`)
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
      checkpoint: checkpointOverride !== undefined
        ? checkpointOverride
        : completed
          ? null
          : getWorkspace()?.checkpoint ?? null,
      resumeSupported: resumeSupportedOverride !== undefined
        ? resumeSupportedOverride
        : !completed,
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
