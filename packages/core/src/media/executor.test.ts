import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import sharp from 'sharp'
import type { MediaMergeItem, MediaMergeProgress } from '@nestify/shared'
import { findFfmpegPath, findFfprobePath, runFfmpeg, streamCopyMergeReason, type FfmpegProbeResult } from './ffmpeg.ts'
import { MediaMergeCancelledError } from './errors.ts'
import { buildConcatListContent, buildStreamCopyMergeCommand, executeMediaMerge, streamCopyControlsReason } from './executor.ts'
import { buildMediaMergePlan } from './plan.ts'

const tempDirs: string[] = []
const ffmpegAvailable = Boolean(findFfmpegPath() && findFfprobePath())

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

test('image merge creates an ordered vertical image and allocates a conflict suffix', async () => {
  const root = tempDir()
  const outputDirectory = join(root, 'out')
  mkdirSync(outputDirectory)
  const first = await imageItem(0, join(root, '01.png'), 32, 16, '#ff0000')
  const second = await imageItem(1, join(root, '02.png'), 64, 32, '#0000ff')
  const plan = await buildMediaMergePlan({
    kind: 'image',
    items: [second, first],
    orderRule: 'name-natural',
    outputDirectory,
    outputName: 'merged',
    image: { format: 'png', width: 16, gap: 0, background: 'transparent' },
  })
  const progress: MediaMergeProgress[] = []

  const result = await executeMediaMerge({
    plan,
    onProgress: (value) => progress.push(value),
  })

  const metadata = await sharp(result.outputPath).metadata()
  assert.equal(metadata.width, 16)
  assert.equal(metadata.height, 16)
  await assertPixel(result.outputPath, 4, 4, [255, 0, 0])
  await assertPixel(result.outputPath, 4, 11, [0, 0, 255])
  assert.equal(progress.at(-1)?.status, 'completed')
  assert.equal(progress.at(-1)?.percent, 100)
  assert.ok(!readdirSync(outputDirectory).some((name) => name.includes('.nestify-')))

  const secondResult = await executeMediaMerge({ plan })
  assert.equal(secondResult.outputPath, join(outputDirectory, 'merged-1.png'))
})

test('image merge cancellation removes the temporary output', async () => {
  const root = tempDir()
  const outputDirectory = join(root, 'out')
  mkdirSync(outputDirectory)
  const first = await imageItem(0, join(root, '01.png'), 16, 16, '#ff0000')
  const second = await imageItem(1, join(root, '02.png'), 16, 16, '#0000ff')
  const plan = await buildMediaMergePlan({
    kind: 'image',
    items: [first, second],
    orderRule: 'manual',
    outputDirectory,
    outputName: 'merged.png',
    image: { format: 'png', width: 16, gap: 0, background: 'white' },
  })
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(executeMediaMerge({ plan, signal: controller.signal }), MediaMergeCancelledError)
  assert.deepEqual(readdirSync(outputDirectory), [])
})

test('image merge supports horizontal composition', async () => {
  const root = tempDir()
  const outputDirectory = join(root, 'out')
  mkdirSync(outputDirectory)
  const first = await imageItem(0, join(root, '01.png'), 32, 16, '#ff0000')
  const second = await imageItem(1, join(root, '02.png'), 64, 32, '#0000ff')
  const plan = await buildMediaMergePlan({
    kind: 'image',
    items: [first, second],
    orderRule: 'manual',
    outputDirectory,
    outputName: 'merged.png',
    image: {
      format: 'png',
      layout: 'horizontal',
      width: 1080,
      height: 16,
      gap: 0,
      background: 'transparent',
    },
  })

  const result = await executeMediaMerge({ plan })

  const metadata = await sharp(result.outputPath).metadata()
  assert.equal(metadata.width, 64)
  assert.equal(metadata.height, 16)
  assert.equal(plan.summary.image?.width, 64)
  assert.equal(plan.summary.image?.height, 16)
  await assertPixel(result.outputPath, 8, 8, [255, 0, 0])
  await assertPixel(result.outputPath, 40, 8, [0, 0, 255])
})

test('image merge supports grid composition and row centering', async () => {
  const root = tempDir()
  const outputDirectory = join(root, 'out')
  mkdirSync(outputDirectory)
  const first = await imageItem(0, join(root, '01.png'), 16, 16, '#ff0000')
  const second = await imageItem(1, join(root, '02.png'), 16, 8, '#0000ff')
  const third = await imageItem(2, join(root, '03.png'), 16, 16, '#00ff00')
  const plan = await buildMediaMergePlan({
    kind: 'image',
    items: [first, second, third],
    orderRule: 'manual',
    outputDirectory,
    outputName: 'merged.png',
    image: {
      format: 'png',
      layout: 'grid',
      width: 32,
      columns: 2,
      gap: 0,
      background: 'transparent',
    },
  })

  const result = await executeMediaMerge({ plan })

  const metadata = await sharp(result.outputPath).metadata()
  assert.equal(metadata.width, 32)
  assert.equal(metadata.height, 32)
  await assertPixel(result.outputPath, 8, 8, [255, 0, 0])
  await assertPixel(result.outputPath, 24, 8, [0, 0, 255])
  await assertPixel(result.outputPath, 8, 24, [0, 255, 0])
})

test('video merge fails clearly when FFmpeg is unavailable', { skip: ffmpegAvailable }, async () => {
  const root = tempDir()
  const outputDirectory = join(root, 'out')
  mkdirSync(outputDirectory)
  const first = videoItem(0, join(root, '01.mp4'))
  const second = videoItem(1, join(root, '02.mp4'))
  const plan = await buildMediaMergePlan({
    kind: 'video',
    items: [first, second],
    orderRule: 'manual',
    outputDirectory,
    outputName: 'merged.mp4',
    video: { quality: 'standard', audio: 'keep' },
  })

  await assert.rejects(executeMediaMerge({ plan }), /未找到可用 (FFmpeg|ffprobe)/)
  assert.deepEqual(readdirSync(outputDirectory), [])
})

test('stream copy merge builds a concat command and reports incompatible inputs', async () => {
  const root = tempDir()
  const outputDirectory = join(root, 'out')
  mkdirSync(outputDirectory)
  const first = videoItem(0, join(root, '01.mp4'))
  const second = videoItem(1, join(root, '02.mp4'))
  first.trimStart = 1
  second.trimEndOffset = 1
  const plan = await buildMediaMergePlan({
    kind: 'video',
    items: [first, second],
    orderRule: 'manual',
    outputDirectory,
    outputName: 'merged.mp4',
    video: { quality: 'standard', audio: 'keep', encodingMode: 'stream-copy' },
  })
  const probes = [compatibleProbe(), compatibleProbe()]
  const settings = {
    quality: 'standard' as const,
    audio: 'keep' as const,
    encodingMode: 'stream-copy' as const,
    transition: { type: 'none' as const, durationSeconds: 0 },
    outputVolume: 1,
  }

  assert.equal(streamCopyMergeReason(probes), null)
  assert.equal(streamCopyControlsReason(plan.items, settings), null)
  const command = buildStreamCopyMergeCommand(
    plan.items,
    probes,
    join(outputDirectory, 'merged.mp4'),
    join(outputDirectory, 'concat.txt'),
  )
  assert.equal(command.totalDuration, 18)
  assert.ok(command.args.includes('-f'))
  assert.ok(command.args.includes('concat'))
  assert.ok(command.args.includes('-c') && command.args.includes('copy'))
  const concat = buildConcatListContent(plan.items, probes)
  assert.match(concat, /inpoint 1\.000/)
  assert.match(concat, /duration 9\.000/)
  assert.match(concat, /file '[A-Za-z]:\//)

  assert.equal(streamCopyMergeReason([compatibleProbe(), compatibleProbe({ videoCodec: 'hevc' })]), '流复制要求所有输入都是 H.264 视频')
  assert.equal(
    streamCopyControlsReason(plan.items, { ...settings, outputVolume: 2 }),
    '快速流复制不能调整输出音量',
  )
  assert.equal(
    streamCopyControlsReason(plan.items, { ...settings, audio: 'mute' }),
    '快速流复制仅支持保留原音频，静音输出请使用重新编码',
  )
})

test('video merge concatenates trimmed clips', { skip: !ffmpegAvailable }, async () => {
  const root = tempDir()
  const outputDirectory = join(root, 'out')
  mkdirSync(outputDirectory)
  const first = videoItem(0, join(root, '01.mp4'))
  const second = videoItem(1, join(root, '02.mp4'))
  for (const [index, item] of [first, second].entries()) {
    await runFfmpeg([
      '-f', 'lavfi', '-i', `testsrc=size=64x64:rate=30`,
      '-t', '1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', item.path,
    ])
    item.size = statSync(item.path).size
    item.mtime = statSync(item.path).mtimeMs
  }
  first.trimStart = 0.1
  second.trimEndOffset = 0.1
  const plan = await buildMediaMergePlan({
    kind: 'video',
    items: [first, second],
    orderRule: 'manual',
    outputDirectory,
    outputName: 'merged.mp4',
    video: { quality: 'standard', audio: 'keep' },
  })

  const result = await executeMediaMerge({ plan })
  const info = statSync(result.outputPath)
  assert.ok(info.size > 0)
  assert.ok(!readdirSync(outputDirectory).some((name) => name.includes('.nestify-')))
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nestify-media-executor-'))
  tempDirs.push(dir)
  return dir
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

function videoItem(index: number, path: string): MediaMergeItem {
  writeFileSync(path, 'video')
  const info = statSync(path)
  return {
    id: `video-${index}`,
    path,
    kind: 'video',
    size: info.size,
    mtime: info.mtimeMs,
    trimStart: 0,
    trimEndOffset: null,
    trimSource: 'batch',
    orderIndex: index,
    manualOrder: false,
  }
}

function compatibleProbe(overrides: Partial<FfmpegProbeResult> = {}): FfmpegProbeResult {
  return {
    durationSeconds: 10,
    width: 64,
    height: 64,
    fps: 30,
    hasAudio: true,
    videoCodec: 'h264',
    audioCodec: 'aac',
    videoProfile: 'Main',
    audioProfile: 'LC',
    pixelFormat: 'yuv420p',
    sampleRate: 48000,
    audioChannels: 2,
    videoTimeBase: '1/15360',
    ...overrides,
  }
}

async function assertPixel(
  path: string,
  x: number,
  y: number,
  expected: Array<number>,
): Promise<void> {
  const pixel = await sharp(path)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer()
  assert.deepEqual([...pixel.subarray(0, expected.length)], expected)
}
