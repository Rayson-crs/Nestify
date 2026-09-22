import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MediaMergeItem } from '@nestify/shared'
import type { FfmpegProbeResult } from './ffmpeg.ts'
import {
  buildVideoMergeCommand,
  streamCopyControlsReason,
  validateVideoMergeControls,
  videoMergeOutputDuration,
} from './video-command.ts'

const baseSettings = {
  quality: 'standard' as const,
  audio: 'keep' as const,
  encodingMode: 'reencode' as const,
  transition: { type: 'none' as const, durationSeconds: 0 },
  outputVolume: 1,
}

test('video command applies per-item and global audio controls', () => {
  const first = videoItem(0, 'D:/media/first.mp4', {
    volume: 0.5,
    audioFadeInSeconds: 0.2,
    audioFadeOutSeconds: 0.3,
  })
  const second = videoItem(1, 'D:/media/second.mp4', {
    volume: 2,
    audioFadeOutSeconds: 0.5,
  })
  const probes = [
    probe({ durationSeconds: 4, hasAudio: true }),
    probe({ durationSeconds: 6, hasAudio: false }),
  ]

  const command = buildVideoMergeCommand([first, second], probes, 'D:/out/merged.mp4', {
    ...baseSettings,
    outputVolume: 1.5,
  })
  const filters = command.args[command.args.indexOf('-filter_complex') + 1]!

  assert.equal(command.totalDuration, 10)
  assert.match(filters, /\[0:a\]aresample=48000,aformat[^;]*volume=0\.5/)
  assert.match(filters, /afade=t=in:st=0:d=0\.2/)
  assert.match(filters, /afade=t=out:st=3\.7:d=0\.3/)
  assert.ok(command.args.includes('anullsrc=r=48000:cl=stereo'))
  assert.match(filters, /volume=2/)
  assert.match(filters, /concat=n=2:v=0:a=1\[concat-audio\]/)
  assert.match(filters, /\[concat-audio\]volume=1\.5\[outa\]/)
  assert.ok(command.args.includes('-c:a'))
})

test('video command exports one image without a concat filter', () => {
  const image = videoItem(0, 'D:/media/cover.png', {
    kind: 'image',
    imageDurationSeconds: 2.5,
    imageMotion: 'zoom-in',
  })
  const command = buildVideoMergeCommand(
    [image],
    [probe({ durationSeconds: 3, hasAudio: false, videoCodec: 'image' })],
    'D:/out/still.mp4',
    baseSettings,
  )
  const filters = command.args[command.args.indexOf('-filter_complex') + 1]!
  assert.equal(command.totalDuration, 2.5)
  assert.match(filters, /\[v0\]null\[outv\]/)
  assert.equal(streamCopyControlsReason([image], baseSettings), '单个素材请使用重新编码')
})

test('video command turns an image into a timed silent clip', () => {
  const image = videoItem(0, 'D:/media/cover.png', {
    kind: 'image',
    imageDurationSeconds: 4,
    imageMotion: 'fade',
  })
  const video = videoItem(1, 'D:/media/clip.mp4')
  const command = buildVideoMergeCommand(
    [image, video],
    [probe({ durationSeconds: 3, hasAudio: false, videoCodec: 'image' }), probe({ durationSeconds: 5 })],
    'D:/out/merged.mp4',
    baseSettings,
  )
  const filters = command.args[command.args.indexOf('-filter_complex') + 1]!
  assert.equal(command.totalDuration, 9)
  assert.ok(command.args.includes('-loop'))
  assert.match(filters, /fade=t=in/)
  assert.equal(streamCopyControlsReason([image, video], baseSettings), '包含图片时必须重新编码')
})

test('video command builds chained crossfades and subtracts overlaps', () => {
  const items = [
    videoItem(0, 'D:/media/first.mp4'),
    videoItem(1, 'D:/media/second.mp4'),
    videoItem(2, 'D:/media/third.mp4'),
  ]
  const probes = [
    probe({ durationSeconds: 5 }),
    probe({ durationSeconds: 4 }),
    probe({ durationSeconds: 3 }),
  ]
  const settings = {
    ...baseSettings,
    transition: { type: 'crossfade' as const, durationSeconds: 0.5 },
  }

  const command = buildVideoMergeCommand(items, probes, 'D:/out/merged.mp4', settings)
  const filters = command.args[command.args.indexOf('-filter_complex') + 1]!

  assert.equal(command.totalDuration, 11)
  assert.equal(videoMergeOutputDuration(items, probes, settings), 11)
  assert.match(filters, /xfade=transition=fade:duration=0\.5:offset=4\.5\[xv1\]/)
  assert.match(filters, /xfade=transition=fade:duration=0\.5:offset=8\[outv\]/)
  assert.match(filters, /acrossfade=d=0\.5:c1=tri:c2=tri\[xa1\]/)
  assert.match(filters, /acrossfade=d=0\.5:c1=tri:c2=tri\[pre-output-audio\]/)
})

test('video command validates transition and fade boundaries, and omits silent audio', () => {
  const items = [
    videoItem(0, 'D:/media/first.mp4', { muted: true }),
    videoItem(1, 'D:/media/second.mp4', { muted: true }),
  ]
  const probes = [
    probe({ durationSeconds: 4 }),
    probe({ durationSeconds: 0.2 }),
  ]
  const crossfade = {
    ...baseSettings,
    transition: { type: 'crossfade' as const, durationSeconds: 0.5 },
  }

  assert.throws(
    () => validateVideoMergeControls(items, probes, crossfade),
    /转场时长不能超过相邻两个裁剪后片段中较短的那个/,
  )
  assert.throws(
    () => validateVideoMergeControls(
      [videoItem(0, 'D:/media/short.mp4', {
        audioFadeInSeconds: 1,
        audioFadeOutSeconds: 1,
      }), videoItem(1, 'D:/media/other.mp4')],
      [probe({ durationSeconds: 1.5 }), probe()],
      baseSettings,
    ),
    /音频淡入和淡出总时长不能超过裁剪后时长/,
  )
  assert.equal(
    streamCopyControlsReason(items, {
      ...baseSettings,
      encodingMode: 'stream-copy',
      transition: { type: 'crossfade' as const, durationSeconds: 0 },
    }),
    '快速流复制不支持单个素材的音量、静音或淡入淡出',
  )

  const command = buildVideoMergeCommand(items, probes, 'D:/out/merged.mp4', baseSettings)
  const filters = command.args[command.args.indexOf('-filter_complex') + 1]!
  assert.ok(!filters.includes('[outa]'))
  assert.ok(!filters.includes('anullsrc'))
  assert.ok(command.args.includes('-an'))
})

function videoItem(
  index: number,
  path: string,
  audio: Partial<MediaMergeItem> = {},
): MediaMergeItem {
  return {
    id: `video-${index}`,
    path,
    kind: 'video',
    size: 100,
    mtime: 1,
    trimStart: 0,
    trimEndOffset: null,
    trimSource: 'batch',
    orderIndex: index,
    manualOrder: false,
    volume: 1,
    muted: false,
    audioFadeInSeconds: 0,
    audioFadeOutSeconds: 0,
    ...audio,
  }
}

function probe(overrides: Partial<FfmpegProbeResult> = {}): FfmpegProbeResult {
  return {
    durationSeconds: 10,
    width: 64,
    height: 48,
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
