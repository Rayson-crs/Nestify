import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { MediaMergeItem } from '@nestify/shared'
import { buildMediaMergePlan } from './plan.ts'

const tempDirs: string[] = []

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nestify-media-plan-'))
  tempDirs.push(dir)
  return dir
}

function imageItem(index: number, path: string): MediaMergeItem {
  writeFileSync(path, 'image')
  return {
    id: `image-${index}`,
    path,
    kind: 'image',
    size: 4,
    mtime: null,
    trimStart: 0,
    trimEndOffset: null,
    trimSource: 'batch',
    orderIndex: index,
    manualOrder: false,
  }
}

function imagePlan(items: MediaMergeItem[], outputName: string, outputDirectory: string) {
  return buildMediaMergePlan({
    kind: 'image',
    items,
    orderRule: 'name-natural',
    outputDirectory,
    outputName,
    image: { format: 'png', width: 1600, gap: 0, background: 'transparent' },
  })
}

test('media merge plan validates homogeneous inputs and normalizes output', async () => {
  const root = tempDir()
  const output = join(root, 'out')
  mkdirSync(output)
  const first = imageItem(0, join(root, 'a2.png'))
  const second = imageItem(1, join(root, 'a10.png'))

  const plan = await imagePlan([second, first], 'merged', output)

  assert.deepEqual(plan.items.map((item) => item.path), [first.path, second.path])
  assert.equal(plan.outputName, 'merged.png')
  assert.equal(plan.outputPath, join(output, 'merged.png'))
  assert.equal(plan.summary.itemCount, 2)
})

test('media merge plan rejects mixed kinds and duplicate inputs', async () => {
  const root = tempDir()
  const output = join(root, 'out')
  mkdirSync(output)
  const image = imageItem(0, join(root, 'a.png'))
  const video = { ...image, id: 'video', path: join(root, 'a.mp4'), kind: 'video' as const }
  writeFileSync(video.path, 'video')

  await assert.rejects(imagePlan([image, video], 'merged.png', output), /图片合并不能加入视频/)
  await assert.rejects(imagePlan([image, image], 'merged.png', output), /输入文件重复/)
})

test('media merge plan rejects output that would replace an input', async () => {
  const root = tempDir()
  const output = join(root, 'out')
  mkdirSync(output)
  const first = imageItem(0, join(root, 'a.png'))
  const target = imageItem(1, join(output, 'merged.png'))

  await assert.rejects(imagePlan([first, target], 'merged.png', output), /输出文件不能覆盖/)
})
