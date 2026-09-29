import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { MediaMergePlan, MediaMergeProgress } from '@nestify/shared'
import {
  createProgressEmitter,
  finalizeMediaMergeOutput,
  ManagedTempFiles,
  MAX_IMAGE_INPUT_COUNT,
  publishTemporaryFile,
  validateImageMergeResources,
} from './execution-shared.ts'

const tempRoots: string[] = []

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
})

test('temporary merge files are tracked and cleaned up together', async () => {
  const root = tempDir()
  const files = new ManagedTempFiles()
  const first = files.track(join(root, 'first.tmp'))
  const second = files.track(join(root, 'second.tmp'))
  writeFileSync(first, 'first')
  writeFileSync(second, 'second')

  await files.cleanup()

  assert.deepEqual(readdirSync(root), [])
})

test('temporary output publication never replaces an existing file', async () => {
  const root = tempDir()
  const temporaryPath = join(root, 'merged.nestify.tmp.png')
  const outputPath = join(root, 'merged.png')
  writeFileSync(temporaryPath, 'temporary')
  writeFileSync(outputPath, 'existing')

  await assert.rejects(
    publishTemporaryFile(temporaryPath, outputPath),
    /输出文件已存在，已阻止覆盖/,
  )
  assert.equal(readFileSync(outputPath, 'utf8'), 'existing')
  assert.equal(readFileSync(temporaryPath, 'utf8'), 'temporary')
})

test('temporary output publication creates the final file without overwriting', async () => {
  const root = tempDir()
  const temporaryPath = join(root, 'merged.nestify.tmp.png')
  const outputPath = join(root, 'merged.png')
  writeFileSync(temporaryPath, 'temporary')

  await publishTemporaryFile(temporaryPath, outputPath)

  assert.equal(readFileSync(outputPath, 'utf8'), 'temporary')
  assert.equal(readFileSync(temporaryPath, 'utf8'), 'temporary')
})

test('image merge resource guards reject excessive inputs and estimated memory', () => {
  assert.throws(
    () => imageResources({ itemCount: MAX_IMAGE_INPUT_COUNT + 1 }),
    new RegExp(`图片合并最多支持 ${MAX_IMAGE_INPUT_COUNT} 个输入`),
  )
  assert.throws(
    () => imageResources({
      dimensions: [{ width: 10_000, height: 10_000 }],
      layout: {
        canvasWidth: 10_000,
        canvasHeight: 10_000,
        placements: [{ width: 20_000, height: 20_000 }],
      },
    }),
    /图片合成预计需要约.+内存，超过.+安全限制/,
  )
  assert.doesNotThrow(() => imageResources())
})

test('progress reports resume support only from a valid workspace', () => {
  const progress: MediaMergeProgress[] = []
  const emit = createProgressEmitter(
    { plan: { items: [] } as never, onProgress: (value) => progress.push(value) },
    'job',
    () => null,
  )

  emit('validating', 0, 0)
  emit('failed', 100, 0, null, 'failure')

  assert.equal(progress[0]?.resumeSupported, false)
  assert.equal(progress[1]?.resumeSupported, false)
})

test('media merge finalization keeps sources by default', async () => {
  const root = tempDir()
  const source = join(root, 'source.mp4')
  const output = join(root, 'output.mp4')
  writeFileSync(source, 'source')
  writeFileSync(output, 'output')

  const warnings = await finalizeMediaMergeOutput({
    plan: finalizationPlan(source, output, false),
    outputPath: output,
    expectedDurationSeconds: 10,
    probeDuration: async () => 10,
  })

  assert.deepEqual(warnings, [])
  assert.equal(existsSync(source), true)
})

test('media merge finalization keeps sources when duration validation fails', async () => {
  const root = tempDir()
  const source = join(root, 'source.mp4')
  const output = join(root, 'output.mp4')
  writeFileSync(source, 'source')
  writeFileSync(output, 'output')

  await assert.rejects(finalizeMediaMergeOutput({
    plan: finalizationPlan(source, output, true),
    outputPath: output,
    expectedDurationSeconds: 10,
    probeDuration: async () => 5,
  }), /时长校验失败/)

  assert.equal(existsSync(source), true)
})

test('media merge finalization deletes sources only after validation when enabled', async () => {
  const root = tempDir()
  const source = join(root, 'source.mp4')
  const output = join(root, 'output.mp4')
  writeFileSync(source, 'source')
  writeFileSync(output, 'output')

  const warnings = await finalizeMediaMergeOutput({
    plan: finalizationPlan(source, output, true),
    outputPath: output,
    expectedDurationSeconds: 10,
    probeDuration: async () => 10.05,
  })

  assert.deepEqual(warnings, [])
  assert.equal(existsSync(source), false)
  assert.equal(existsSync(output), true)
})

test('media merge finalization reports deletion failures without rejecting output', async () => {
  const root = tempDir()
  const source = join(root, 'missing.mp4')
  const output = join(root, 'output.mp4')
  writeFileSync(output, 'output')

  const warnings = await finalizeMediaMergeOutput({
    plan: finalizationPlan(source, output, true),
    outputPath: output,
    expectedDurationSeconds: 10,
    probeDuration: async () => 10,
  })

  assert.equal(warnings.length, 1)
  assert.match(warnings[0]!, /源文件删除失败/)
  assert.equal(existsSync(output), true)
})

function imageResources(overrides: Partial<Parameters<typeof validateImageMergeResources>[0]> = {}) {
  return validateImageMergeResources({
    itemCount: 1,
    dimensions: [{ width: 16, height: 16 }],
    layout: {
      canvasWidth: 16,
      canvasHeight: 16,
      placements: [{ width: 16, height: 16 }],
    },
    animated: false,
    ...overrides,
  })
}

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'nestify-media-shared-'))
  tempRoots.push(root)
  return root
}

function finalizationPlan(source: string, output: string, deleteSourcesAfterSuccess: boolean): MediaMergePlan {
  return {
    version: 1,
    kind: 'video',
    items: [{
      id: 'source', path: source, kind: 'video', size: 6, mtime: null,
      trimStart: 0, trimEndOffset: null, trimSource: 'batch', orderIndex: 0, manualOrder: false,
    }],
    outputDirectory: output.slice(0, Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'))),
    outputName: 'output.mp4',
    outputPath: output,
    deleteSourcesAfterSuccess,
    video: { quality: 'standard', audio: 'keep' },
    summary: { itemCount: 1, warnings: [] },
  }
}
