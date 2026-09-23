import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { MediaMergeItem } from '@nestify/shared'
import { buildMediaMergePlan } from './plan.ts'
import { calculateImageLayout } from './layout.ts'

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

test('media merge plan allocates a numbered name for existing image and video outputs', async () => {
  const root = tempDir()
  const output = join(root, 'out')
  mkdirSync(output)
  const image = imageItem(0, join(root, 'a.png'))
  writeFileSync(join(output, 'merged.png'), 'existing image')
  writeFileSync(join(output, 'merged-1.png'), 'existing image')

  const imageResult = await imagePlan([image], 'merged.png', output)

  assert.equal(imageResult.outputName, 'merged-2.png')
  assert.equal(imageResult.outputPath, join(output, 'merged-2.png'))

  const videoPath = join(root, 'a.mp4')
  writeFileSync(videoPath, 'video')
  const video = { ...image, id: 'video', path: videoPath, kind: 'video' as const }
  writeFileSync(join(output, 'merged.mp4'), 'existing video')
  const videoResult = await buildMediaMergePlan({
    kind: 'video',
    items: [video],
    orderRule: 'manual',
    outputDirectory: output,
    outputName: 'merged.mp4',
    video: { format: 'mp4', quality: 'standard', audio: 'keep' },
  })

  assert.equal(videoResult.outputName, 'merged-1.mp4')
  assert.equal(videoResult.outputPath, join(output, 'merged-1.mp4'))
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

test('image merge accepts one image and still rejects video input', async () => {
  const root = tempDir()
  const output = join(root, 'out')
  mkdirSync(output)
  const image = imageItem(0, join(root, 'only.png'))
  const video = { ...image, id: 'video', path: join(root, 'clip.mp4'), kind: 'video' as const }
  writeFileSync(video.path, 'video')

  const plan = await buildMediaMergePlan({
    kind: 'image',
    items: [image],
    orderRule: 'manual',
    outputDirectory: output,
    outputName: 'only.png',
    image: { format: 'png', width: 1080, height: 0, gap: 0, background: 'transparent' },
  })

  assert.equal(plan.summary.itemCount, 1)
  assert.equal(plan.image?.width, 1080)
  assert.equal(plan.image?.format, 'png')
  await assert.rejects(
    imagePlan([video], 'merged.png', output),
    /图片合并不能加入视频/,
  )
})

test('image settings validate only the dimension used by the active layout', async () => {
  const root = tempDir()
  const output = join(root, 'out')
  mkdirSync(output)
  const image = imageItem(0, join(root, 'only.png'))
  const base = {
    kind: 'image' as const,
    items: [image],
    orderRule: 'manual' as const,
    outputDirectory: output,
    outputName: 'only.png',
  }

  const horizontal = await buildMediaMergePlan({
    ...base,
    outputName: 'wide.jpg',
    image: { format: 'jpg', layout: 'horizontal', width: 0, height: 720, gap: 8, background: 'white' },
  })
  assert.equal(horizontal.image?.height, 720)
  assert.equal(horizontal.image?.width, 0)

  const vertical = await buildMediaMergePlan({
    ...base,
    image: { format: 'png', layout: 'vertical', width: 1080, height: 0, gap: 0, background: 'transparent' },
  })
  assert.equal(vertical.image?.width, 1080)

  await assert.rejects(
    buildMediaMergePlan({
      ...base,
      outputName: 'tall.jpg',
      image: { format: 'jpg', layout: 'vertical', width: 0, height: 1080, gap: 8, background: 'white' },
    }),
    /图片统一宽度必须在 16 到 8192 之间，当前值为 0/,
  )
  await assert.rejects(
    buildMediaMergePlan({
      ...base,
      outputName: 'short.jpg',
      image: { format: 'jpg', layout: 'horizontal', width: 1080, height: 0, gap: 8, background: 'white' },
    }),
    /图片统一高度必须在 16 到 8192 之间，当前值为 0/,
  )
  const horizontalWidthIgnored = await buildMediaMergePlan({
    ...base,
    outputName: 'wide.jpg',
    image: { format: 'jpg', layout: 'horizontal', width: 1, height: 640, gap: 4, background: 'white' },
  })
  assert.equal(horizontalWidthIgnored.image?.height, 640)
  assert.equal(horizontalWidthIgnored.image?.width, 1)
  await assert.rejects(
    buildMediaMergePlan({
      ...base,
      image: { format: 'png', layout: 'vertical', width: 15, height: 0, gap: 0, background: 'transparent' },
    }),
    /图片统一宽度必须在 16 到 8192 之间，当前值为 15/,
  )
  await assert.rejects(
    buildMediaMergePlan({
      ...base,
      outputName: 'clear.jpg',
      image: { format: 'jpg', width: 1080, gap: 8, background: 'transparent' },
    }),
    /JPG 不支持透明背景/,
  )
})

test('gif image plan validates its fixed canvas and normalizes output', async () => {
  const root = tempDir()
  const output = join(root, 'out')
  mkdirSync(output)
  const image = imageItem(0, join(root, 'only.png'))
  const plan = await buildMediaMergePlan({
    kind: 'image',
    items: [image],
    orderRule: 'manual',
    outputDirectory: output,
    outputName: 'preview',
    image: {
      format: 'gif', width: 0, gap: 0, background: 'transparent',
      gifWidth: 640, gifHeight: 360, gifFrameDurationSeconds: 1.5, gifLoopCount: 0,
    },
  })

  assert.equal(plan.outputName, 'preview.gif')
  assert.equal(plan.summary.image?.width, 640)
  assert.equal(plan.summary.image?.height, 360)
  assert.equal(plan.summary.image?.animated, true)
  await assert.rejects(buildMediaMergePlan({
    kind: 'image',
    items: [image],
    orderRule: 'manual',
    outputDirectory: output,
    outputName: 'invalid.gif',
    image: { format: 'gif', width: 0, gap: 0, background: 'white', gifWidth: 8, gifHeight: 360 },
  }), /GIF 画布宽高必须在 16 到 8192 之间/)
})

test('a single image layout uses the shared width and one placement', () => {
  const layout = calculateImageLayout(
    [{ width: 400, height: 200 }],
    { format: 'png', layout: 'vertical', width: 200, height: 0, gap: 4, background: 'transparent' },
  )
  assert.equal(layout.placements.length, 1)
  assert.deepEqual(layout.placements[0], { left: 0, top: 0, width: 200, height: 100 })
  assert.equal(layout.canvasWidth, 200)
  assert.equal(layout.canvasHeight, 100)
})

test('video plan normalizes per-item frame focus and rejects invalid coordinates', async () => {
  const root = tempDir()
  const output = join(root, 'out')
  mkdirSync(output)
  const first = { ...imageItem(0, join(root, '01.mp4')), kind: 'video' as const, frameFocusX: 20.4, frameFocusY: 79.6 }
  const second = { ...imageItem(1, join(root, '02.mp4')), kind: 'video' as const }
  const plan = await buildMediaMergePlan({
    kind: 'video',
    items: [first, second],
    orderRule: 'manual',
    outputDirectory: output,
    outputName: 'merged.mp4',
    video: { quality: 'standard', audio: 'keep' },
  })

  assert.equal(plan.items[0]?.frameFocusX, 20)
  assert.equal(plan.items[0]?.frameFocusY, 80)

  await assert.rejects(buildMediaMergePlan({
    kind: 'video',
    items: [{ ...first, frameFocusX: 101 }, second],
    orderRule: 'manual',
    outputDirectory: output,
    outputName: 'invalid.mp4',
    video: { quality: 'standard', audio: 'keep' },
  }), /画面焦点必须在 0% 到 100% 之间/)
})
