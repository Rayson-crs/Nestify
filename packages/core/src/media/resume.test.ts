import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import sharp from 'sharp'
import type { MediaMergeItem, MediaMergePlan } from '@nestify/shared'
import { MediaMergeCancelledError, MediaMergeInterruptedError } from './errors.ts'
import { executeMediaMerge } from './executor.ts'
import { MediaMergeWorkspace, mediaMergeStageCount } from './resume.ts'
import { buildMediaMergePlan } from './plan.ts'

const tempRoots: string[] = []

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
})

test('image merge resumes from a completed layer stage', async () => {
  const context = await imageMergeContext()
  const workspace = await openWorkspace(context)
  await workspace.completeStage('analysis')
  await workspace.completeStage('layer-0')
  await sharp({
    create: { width: context.plan.image!.width, height: 8, channels: 4, background: '#ff0000' },
  }).png().toFile(join(workspace.path, 'layer-00000.png'))

  const result = await executeMediaMerge({
    jobId: context.jobId,
    plan: context.plan,
    workspacePath: workspace.path,
    resume: {
      checkpoint: workspace.checkpoint,
      completedStages: workspace.checkpoint.completedStages,
    },
  })

  assert.equal(result.outputPath, context.plan.outputPath)
  assert.equal(statSync(result.outputPath).size > 0, true)
  assert.equal(readdirSync(context.root).includes('workspace'), false)
})

test('interrupted image merge keeps its workspace for explicit resume', async () => {
  const context = await imageMergeContext()
  const workspace = await openWorkspace(context)
  const controller = new AbortController()
  controller.abort(new MediaMergeInterruptedError())

  await assert.rejects(executeMediaMerge({
    jobId: context.jobId,
    plan: context.plan,
    workspacePath: workspace.path,
    resume: {
      checkpoint: workspace.checkpoint,
      completedStages: workspace.checkpoint.completedStages,
    },
    signal: controller.signal,
  }), MediaMergeInterruptedError)
  assert.equal(statSync(workspace.path).isDirectory(), true)
})

test('user cancellation removes the managed workspace', async () => {
  const context = await imageMergeContext()
  const workspace = await openWorkspace(context)
  const controller = new AbortController()
  controller.abort(new MediaMergeCancelledError())

  await assert.rejects(executeMediaMerge({
    jobId: context.jobId,
    plan: context.plan,
    workspacePath: workspace.path,
    resume: {
      checkpoint: workspace.checkpoint,
      completedStages: workspace.checkpoint.completedStages,
    },
    signal: controller.signal,
  }), MediaMergeCancelledError)
  assert.equal(existsSync(workspace.path), false)
})

test('resume rejects a checkpoint that no longer matches the manifest', async () => {
  const context = await imageMergeContext()
  const workspace = await openWorkspace(context)
  await workspace.completeStage('analysis')
  workspace.checkpoint.completedStages = [...workspace.checkpoint.completedStages, 'layer-0']

  await assert.rejects(executeMediaMerge({
    jobId: context.jobId,
    plan: context.plan,
    workspacePath: workspace.path,
    resume: {
      checkpoint: workspace.checkpoint,
      completedStages: workspace.checkpoint.completedStages,
    },
  }), /manifest 与任务断点不匹配/)
})

test('a completed final output can be finalized without rerendering layers', async () => {
  const context = await imageMergeContext()
  const workspace = await openWorkspace(context)
  await workspace.completeStage('analysis')
  await workspace.completeStage('composite')
  writeFileSync(workspace.checkpoint.outputPath, 'completed-output')

  const result = await executeMediaMerge({
    jobId: context.jobId,
    plan: context.plan,
    workspacePath: workspace.path,
    resume: {
      checkpoint: workspace.checkpoint,
      completedStages: workspace.checkpoint.completedStages,
    },
  })

  assert.equal(result.outputPath, workspace.checkpoint.outputPath)
  assert.equal(readdirSync(context.root).includes('workspace'), false)
})

async function imageMergeContext(): Promise<{
  root: string
  jobId: string
  workspacePath: string
  plan: MediaMergePlan
}> {
  const root = mkdtempSync(join(tmpdir(), 'nestify-media-resume-'))
  tempRoots.push(root)
  const outputDirectory = join(root, 'out')
  mkdirSync(outputDirectory)
  const first = await imageItem(0, join(root, '01.png'), 32, 16, '#ff0000')
  const second = await imageItem(1, join(root, '02.png'), 48, 24, '#0000ff')
  const plan = await buildMediaMergePlan({
    kind: 'image',
    items: [first, second],
    orderRule: 'manual',
    outputDirectory,
    outputName: 'merged.png',
    image: { format: 'png', width: 16, gap: 0, background: 'transparent' },
  })
  return {
    root,
    jobId: 'resume-image-job',
    workspacePath: join(root, 'workspace'),
    plan,
  }
}

async function openWorkspace(context: Awaited<ReturnType<typeof imageMergeContext>>) {
  return MediaMergeWorkspace.open({
    workspacePath: context.workspacePath,
    jobId: context.jobId,
    plan: context.plan,
    totalStages: mediaMergeStageCount(context.plan),
  })
}

async function imageItem(
  index: number,
  path: string,
  width: number,
  height: number,
  color: string,
): Promise<MediaMergeItem> {
  await sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toFile(path)
  const info = statSync(path)
  return {
    id: `image-${index}`,
    path,
    kind: 'image',
    size: info.size,
    mtime: info.mtimeMs,
    trimStart: 0,
    trimEndOffset: null,
    trimSource: 'batch',
    orderIndex: index,
    manualOrder: false,
  }
}
