import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MediaMergeItem, MediaMergeVideoSettings } from '@nestify/shared'
import type { FfmpegProbeResult } from './ffmpeg.ts'
import { buildVideoMergeCommand } from './video-command.ts'
import {
  processingSnapshot,
  renderedSegmentInputs,
  renderedSegmentMatchesExpectedDuration,
  segmentRenderSettings,
} from './video-execution.ts'

const settings: MediaMergeVideoSettings = {
  format: 'webm',
  quality: 'standard',
  audio: 'keep',
  transition: { type: 'crossfade', durationSeconds: 0.25 },
  outputVolume: 1.5,
  loudnessNormalize: true,
  canvasWidth: 1280,
  canvasHeight: 720,
}

test('rendered intermediate images become plain video inputs without repeated controls', () => {
  const items: MediaMergeItem[] = [
    item('video', 'C:\\media\\01.mp4', 0),
    {
      ...item('image', 'C:\\media\\02.jpg', 1),
      imageDurationSeconds: 3,
      imageMotion: 'pan-left',
      imageClipSource: 'custom',
      rotation: 'clockwise-90',
      frameFit: 'cover',
      frameScalePercent: 140,
      frameFocusX: 20,
      frameFocusY: 80,
      volume: 0.5,
      audioFadeInSeconds: 0.5,
    },
  ]
  const probes = [probe({ hasAudio: true }), probe({ width: 720, height: 1280, videoCodec: 'image' })]
  const rendered = renderedSegmentInputs(
    items,
    ['C:\\workspace\\segment-0.mp4', 'C:\\workspace\\segment-1.mp4'],
    [2, 3],
    [probe({ hasAudio: true, audioCodec: 'aac' }), probe({ width: 1280, height: 720, hasAudio: false })],
  )
  const command = buildVideoMergeCommand(rendered.items, rendered.probes, 'C:\\out\\merged.webm', settings)

  assert.deepEqual(rendered.items.map((entry) => entry.kind), ['video', 'video'])
  assert.equal(rendered.items[1]?.imageMotion, undefined)
  assert.equal(rendered.items[1]?.rotation, 'none')
  assert.equal(rendered.items[1]?.frameScalePercent, 100)
  assert.equal(rendered.items[1]?.frameFocusX, 50)
  assert.equal(rendered.items[1]?.frameFocusY, 50)
  assert.equal(rendered.items[1]?.muted, true)
  assert.equal(rendered.probes[1]?.videoCodec, 'h264')
  assert.equal(rendered.probes[1]?.hasAudio, false)
  assert.equal(command.args.includes('-loop'), false)
  assert.ok(command.args.includes('C:\\workspace\\segment-1.mp4'))
})

test('rendered segments use actual audio streams instead of the source prediction', () => {
  const items: MediaMergeItem[] = [
    item('video', 'C:\\media\\source-with-audio.mp4', 0),
    item('video', 'C:\\media\\source-without-audio.mp4', 1),
  ]
  const rendered = renderedSegmentInputs(
    items,
    ['C:\\workspace\\segment-0.mp4', 'C:\\workspace\\segment-1.mp4'],
    [2, 2],
    [probe({ hasAudio: false }), probe({ hasAudio: true, audioCodec: 'aac' })],
  )
  const command = buildVideoMergeCommand(rendered.items, rendered.probes, 'C:\\out\\merged.mp4', {
    ...settings,
    format: 'mp4',
    transition: { type: 'none', durationSeconds: 0 },
  })
  const graph = command.args[command.args.indexOf('-filter_complex') + 1]!

  assert.equal(rendered.items[0]?.muted, true)
  assert.equal(rendered.items[1]?.muted, false)
  assert.doesNotMatch(graph, /\[0:a\]/)
  assert.match(graph, /\[1:a\]/)
})

test('segment rendering always uses an mp4 intermediate without final-only controls', () => {
  assert.deepEqual(segmentRenderSettings(settings), {
    ...settings,
    format: 'mp4',
    transition: { type: 'none', durationSeconds: 0 },
    outputVolume: 1,
    loudnessNormalize: false,
  })
})

test('rendered segment duration validation rejects expanded image animation caches', () => {
  assert.equal(renderedSegmentMatchesExpectedDuration(probe({ durationSeconds: 7, fps: 30 }), 7), true)
  assert.equal(renderedSegmentMatchesExpectedDuration(probe({ durationSeconds: 7.08, fps: 30 }), 7), true)
  assert.equal(renderedSegmentMatchesExpectedDuration(probe({ durationSeconds: 1470, fps: 30 }), 7), false)
})

test('processing progress maps work to 25 through 95 percent', () => {
  assert.deepEqual(processingSnapshot(0, 20, 0), { percent: 25, current: 0 })
  assert.deepEqual(processingSnapshot(10, 20, 1), { percent: 60, current: 1 })
  assert.deepEqual(processingSnapshot(20, 20, 2), { percent: 95, current: 2 })
})

function item(kind: MediaMergeItem['kind'], path: string, orderIndex: number): MediaMergeItem {
  return {
    id: `${kind}-${orderIndex}`,
    path,
    kind,
    size: 100,
    mtime: 1,
    trimStart: 0,
    trimEndOffset: null,
    trimSource: 'batch',
    orderIndex,
    manualOrder: false,
  }
}

function probe(overrides: Partial<FfmpegProbeResult> = {}): FfmpegProbeResult {
  return {
    durationSeconds: 2,
    width: 1280,
    height: 720,
    fps: 30,
    hasAudio: false,
    videoCodec: 'h264',
    audioCodec: null,
    videoProfile: 'Main',
    audioProfile: null,
    pixelFormat: 'yuv420p',
    sampleRate: null,
    audioChannels: null,
    videoTimeBase: '1/15360',
    ...overrides,
  }
}
