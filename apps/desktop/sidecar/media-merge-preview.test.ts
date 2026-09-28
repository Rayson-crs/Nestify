import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { configureMediaToolPaths } from '../../../packages/core/src/media/ffmpeg.ts'
import { resolveBundledTool } from './media-tools.ts'
import { previewSelectedVideoProxy } from './media-merge-preview.ts'

const ffmpegPath = resolveBundledTool('ffmpeg.exe')
const ffprobePath = resolveBundledTool('ffprobe.exe')

configureMediaToolPaths({ ffmpegPath, ffprobePath })

test('preview proxy returns a playable cached result for a generated video', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nestify-preview-test-'))
  const sourcePath = join(directory, 'source.avi')
  await run(ffmpegPath, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
    '-t', '1.5',
    '-c:v', 'mpeg4',
    sourcePath,
  ])

  const result = await waitForProxy(sourcePath)
  if (result.status === 'failed') assert.fail(result.error)
  assert.equal(result.status, 'ready')
  assert.equal(result.error, null)
  assert.match(result.src, /^nestify-media:\/\/preview\/\?path=/)
})

test('preview proxy returns the source immediately for browser playable video', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nestify-preview-test-'))
  const sourcePath = join(directory, 'source.mp4')
  await run(ffmpegPath, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12',
    '-t', '0.4',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    sourcePath,
  ])

  const startedAt = Date.now()
  const result = await previewSelectedVideoProxy({ path: sourcePath, selectedPaths: [sourcePath] })
  assert.equal(result.status, 'ready')
  assert.equal(result.error, null)
  assert.match(decodeURIComponent(result.src), /source\.mp4/)
  assert.ok(Date.now() - startedAt < 1_500)
})

test('preview proxy preserves ffmpeg failure for polling clients', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nestify-preview-test-'))
  const sourcePath = join(directory, 'broken.avi')
  await writeFile(sourcePath, 'not a video')

  const first = await previewSelectedVideoProxy({ path: sourcePath, selectedPaths: [sourcePath] })
  assert.equal(first.status, 'preparing')
  const failed = await waitForProxy(sourcePath)
  assert.equal(failed.status, 'failed')
  assert.ok(failed.error)
  const cached = await previewSelectedVideoProxy({ path: sourcePath, selectedPaths: [sourcePath] })
  assert.deepEqual(cached, failed)
})

test('preview proxy uses explicit media tools and remuxes H.264 without transcoding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nestify-preview-test-'))
  const sourcePath = join(directory, 'h264-source.avi')
  await run(ffmpegPath, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
    '-t', '1.5',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-an',
    sourcePath,
  ])
  configureMediaToolPaths({ ffmpegPath: null, ffprobePath: null })
  const mediaTools = { ffmpegPath, ffprobePath }
  const startedAt = Date.now()
  try {
    const first = await previewSelectedVideoProxy({
      path: sourcePath,
      selectedPaths: [sourcePath],
      reason: 'container',
      mediaTools,
    })
    assert.equal(first.status, 'preparing')
    const ready = await waitForProxy(sourcePath, mediaTools)
    if (ready.status === 'failed') assert.fail(ready.error)
    assert.equal(ready.status, 'ready')
    assert.equal(ready.error, null)
    assert.ok(Date.now() - startedAt < 5_000)
  } finally {
    configureMediaToolPaths({ ffmpegPath, ffprobePath })
  }
})

async function waitForProxy(
  path: string,
  mediaTools?: { ffmpegPath?: string | null; ffprobePath?: string | null },
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await previewSelectedVideoProxy({ path, selectedPaths: [path], mediaTools })
    if (result.status !== 'preparing') return result
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('preview proxy did not finish')
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(stderr))
    })
  })
}
