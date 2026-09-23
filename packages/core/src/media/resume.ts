import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  MediaMergeCheckpoint,
  MediaMergePlan,
  MediaMergeWorkspaceManifest,
} from '@nestify/shared'

const MANIFEST_NAME = 'manifest.json'

export interface MediaMergeResumeInput {
  checkpoint?: MediaMergeCheckpoint | null
  completedStages?: readonly string[]
}

export class MediaMergeWorkspace {
  readonly checkpoint: MediaMergeCheckpoint
  readonly path: string
  private readonly manifest: MediaMergeWorkspaceManifest
  private readonly manifestPath: string
  private readonly completedStages: Set<string>

  private constructor(
    path: string,
    checkpoint: MediaMergeCheckpoint,
    manifest: MediaMergeWorkspaceManifest,
  ) {
    this.manifestPath = join(path, MANIFEST_NAME)
    this.path = path
    this.checkpoint = checkpoint
    this.manifest = manifest
    this.completedStages = new Set(manifest.completedStages)
  }

  static async open(input: {
    workspacePath: string
    jobId: string
    plan: MediaMergePlan
    resume?: MediaMergeResumeInput
    totalStages: number
  }): Promise<MediaMergeWorkspace> {
    const identity = planIdentity(input.plan)
    const inputs = input.plan.items.map((item) => ({
      path: item.path,
      size: item.size,
      mtime: item.mtime,
    }))
    await mkdir(input.workspacePath, { recursive: true })
    const manifestPath = join(input.workspacePath, MANIFEST_NAME)

    if (input.resume) {
      const checkpoint = input.resume.checkpoint
      if (!checkpoint || checkpoint.version !== 1) throw new Error('恢复失败：任务没有有效断点')
      if (checkpoint.jobId !== input.jobId) throw new Error('恢复失败：断点与任务 ID 不匹配')
      if (checkpoint.workspacePath !== input.workspacePath) throw new Error('恢复失败：断点工作区路径不匹配')
      if (checkpoint.preferredOutputPath !== input.plan.outputPath) {
        throw new Error('恢复失败：计划输出路径已变化')
      }
      if (checkpoint.totalStages !== input.totalStages) throw new Error('恢复失败：任务阶段数量不匹配')
      let manifest: MediaMergeWorkspaceManifest
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as MediaMergeWorkspaceManifest
      } catch {
        throw new Error('恢复失败：工作区 manifest 缺失或无法读取')
      }
      if (manifest.version !== 1
        || manifest.jobId !== input.jobId
        || manifest.planIdentity !== identity
        || manifest.workspacePath !== input.workspacePath
        || manifest.preferredOutputPath !== checkpoint.preferredOutputPath
        || manifest.outputPath !== checkpoint.outputPath
        || manifest.totalStages !== input.totalStages
        || !sameStages(manifest.completedStages, checkpoint.completedStages)
        || !sameInputs(manifest.inputs, inputs)) {
        throw new Error('恢复失败：工作区 manifest 与任务断点不匹配')
      }
      return new MediaMergeWorkspace(input.workspacePath, checkpoint, manifest)
    }

    const now = Date.now()
    const checkpoint: MediaMergeCheckpoint = {
      version: 1,
      jobId: input.jobId,
      workspacePath: input.workspacePath,
      preferredOutputPath: input.plan.outputPath,
      outputPath: input.plan.outputPath,
      completedStages: [],
      totalStages: input.totalStages,
      updatedAt: now,
    }
    const manifest: MediaMergeWorkspaceManifest = {
      version: 1,
      jobId: input.jobId,
      planIdentity: identity,
      preferredOutputPath: checkpoint.preferredOutputPath,
      outputPath: checkpoint.outputPath,
      workspacePath: input.workspacePath,
      inputs,
      completedStages: [],
      totalStages: input.totalStages,
      updatedAt: now,
    }
    const workspace = new MediaMergeWorkspace(input.workspacePath, checkpoint, manifest)
    await workspace.persist()
    return workspace
  }

  hasCompleted(stage: string): boolean {
    return this.completedStages.has(stage)
  }

  async setOutputPath(outputPath: string): Promise<void> {
    if (this.checkpoint.outputPath === outputPath) return
    this.checkpoint.outputPath = outputPath
    this.checkpoint.updatedAt = Date.now()
    this.manifest.outputPath = outputPath
    this.manifest.updatedAt = this.checkpoint.updatedAt
    await this.persist()
  }

  async completeStage(stage: string): Promise<void> {
    if (this.completedStages.has(stage)) return
    this.completedStages.add(stage)
    this.checkpoint.completedStages = [...this.completedStages]
    this.checkpoint.updatedAt = Date.now()
    this.manifest.completedStages = [...this.completedStages]
    this.manifest.updatedAt = this.checkpoint.updatedAt
    await this.persist()
  }

  async remove(): Promise<void> {
    await rm(this.path, { recursive: true, force: true })
  }

  private async persist(): Promise<void> {
    await writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf8')
  }
}

export function mediaMergeStageCount(plan: MediaMergePlan): number {
  return plan.items.length + 2
}

export function planIdentity(plan: MediaMergePlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

function sameStages(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((stage, index) => stage === right[index])
}

function sameInputs(
  left: MediaMergeWorkspaceManifest['inputs'],
  right: MediaMergeWorkspaceManifest['inputs'],
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]!
    return samePath(item.path, other.path)
      && item.size === other.size
      && (item.mtime == null ? other.mtime == null : Math.abs(item.mtime - (other.mtime ?? 0)) <= 1)
  })
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll('\\', '/').toLowerCase() === right.replaceAll('\\', '/').toLowerCase()
}
