import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MediaMergeItem } from '@nestify/shared'
import type { FfmpegProbeResult } from './ffmpeg.ts'
import {
  buildVideoMergeCommand,
  streamCopyControlsReason,
  validateVideoMergeControls,
  videoMergeOutputDuration,
  VIDEO_CHAPTER_METADATA_PLACEHOLDER,
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

test('video command appends generated silence after every media input', () => {
  const items = [
    videoItem(0, 'D:/media/silent-first.mp4'),
    videoItem(1, 'D:/media/audible-second.mp4'),
    videoItem(2, 'D:/media/silent-third.mp4'),
  ]
  const command = buildVideoMergeCommand(
    items,
    [probe({ hasAudio: false }), probe({ hasAudio: true }), probe({ hasAudio: false })],
    'D:/out/merged.mp4',
    baseSettings,
    { chapters: false },
  )
  const inputValues = command.args
    .map((value, index) => command.args[index - 1] === '-i' ? value : null)
    .filter((value): value is string => value != null)
  const filters = filterGraph(command.args)

  assert.deepEqual(inputValues.slice(0, 3), items.map((item) => item.path))
  assert.deepEqual(inputValues.slice(3), [
    'anullsrc=r=48000:cl=stereo',
    'anullsrc=r=48000:cl=stereo',
  ])
  assert.match(filters, /\[3:a\][^;]*\[a0\]/)
  assert.match(filters, /\[1:a\][^;]*\[a1\]/)
  assert.match(filters, /\[4:a\][^;]*\[a2\]/)
})

test('video command does not create a silent output track when no source has audio', () => {
  const command = buildVideoMergeCommand(
    [videoItem(0, 'D:/media/a.mp4'), videoItem(1, 'D:/media/b.mp4')],
    [probe({ hasAudio: false }), probe({ hasAudio: false })],
    'D:/out/merged.mp4',
    baseSettings,
  )

  assert.equal(command.args.includes('anullsrc=r=48000:cl=stereo'), false)
  assert.equal(command.args.includes('-an'), true)
  assert.doesNotMatch(filterGraph(command.args), /\[[0-9]+:a\]/)
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
  assert.match(filters, /zoompan=[^;]*:d=1:/)
  assert.doesNotMatch(filters, /zoompan=[^;]*:d=75:/)
  assert.match(filters, /zoompan=[^;]*,setsar=1,format=yuv420p\[v0\]/)
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
  assert.equal(filters.match(/setsar=1/g)?.length, 2)
  assert.equal(streamCopyControlsReason([image, video], baseSettings), '包含图片时必须重新编码')
})

test('video command applies visual motion to ordinary video clips', () => {
  const zoom = videoItem(0, 'D:/media/zoom.mp4', { imageMotion: 'zoom-in' })
  const fade = videoItem(1, 'D:/media/fade.mp4', { imageMotion: 'fade' })
  const pan = videoItem(2, 'D:/media/pan.mp4', { imageMotion: 'pan-left' })
  const command = buildVideoMergeCommand(
    [zoom, fade, pan],
    [probe({ durationSeconds: 4 }), probe({ durationSeconds: 5 }), probe({ durationSeconds: 6 })],
    'D:/out/motion.mp4',
    baseSettings,
  )
  const filters = filterGraph(command.args)

  assert.match(filters, /\[0:v\][^;]*zoompan=z='min\(1\.18,1\+0\.18\*on\/120\)'/)
  assert.match(filters, /\[1:v\][^;]*fade=t=in:st=0:d=0\.60,fade=t=out:st=4\.40:d=0\.60/)
  assert.match(filters, /\[2:v\][^;]*crop=64:48:'\(iw-ow\)\*min\(1,n\/180\)'/)
  assert.equal(
    streamCopyControlsReason([zoom, videoItem(3, 'D:/media/plain.mp4')], baseSettings),
    '单个素材的画面动效必须重新编码',
  )
  assert.equal(
    streamCopyControlsReason([
      videoItem(0, 'D:/media/still.mp4', { imageMotion: 'still' }),
      videoItem(1, 'D:/media/plain.mp4'),
    ], baseSettings),
    null,
  )
})

test('image duration ignores video trim fields left on mixed-media items', () => {
  const image = videoItem(0, 'D:/media/cover.png', {
    kind: 'image',
    imageDurationSeconds: 4,
    trimStart: 2,
    trimEndOffset: 1,
  })
  const command = buildVideoMergeCommand(
    [image],
    [probe({ durationSeconds: 4, hasAudio: false, videoCodec: 'image' })],
    'D:/out/still.mp4',
    baseSettings,
  )

  assert.equal(command.totalDuration, 4)
  assert.deepEqual(command.args.slice(0, 8), [
    '-loop', '1', '-framerate', '30', '-t', '4.000', '-i', image.path,
  ])
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

test('video command chooses fit size, image frame rate, and loudness before volume', () => {
  const image = videoItem(0, 'D:/media/wide.png', { kind: 'image', imageDurationSeconds: 2 })
  const portrait = videoItem(1, 'D:/media/tall.mp4')
  const probes = [
    probe({ width: 2000, height: 1000, fps: 24, hasAudio: false, videoCodec: 'image' }),
    probe({ width: 1440, height: 2560, fps: 30 }),
  ]
  const largest = buildVideoMergeCommand([image, portrait], probes, 'D:/out/merged.mp4', baseSettings)
  const first = buildVideoMergeCommand([image, portrait], probes, 'D:/out/merged.mp4', {
    ...baseSettings,
    fit: 'first',
  })
  const limited = buildVideoMergeCommand([image, portrait], probes, 'D:/out/merged.mp4', {
    ...baseSettings,
    fit: 'limit-1080p',
    loudnessNormalize: true,
    outputVolume: 0.8,
  })
  const largestFilters = filterGraph(largest.args)
  const firstFilters = filterGraph(first.args)
  const limitedFilters = filterGraph(limited.args)

  assert.match(largestFilters, /scale=2000:2560:force_original_aspect_ratio=decrease[^;]*pad=w='max\(iw,2000\)':h='max\(ih,2560\)'/)
  assert.match(firstFilters, /scale=2000:1000:force_original_aspect_ratio=decrease[^;]*pad=w='max\(iw,2000\)':h='max\(ih,1000\)'/)
  assert.match(limitedFilters, /scale=1920:1920:force_original_aspect_ratio=decrease[^;]*pad=w='max\(iw,1920\)':h='max\(ih,1920\)'/)

  const fixed = buildVideoMergeCommand([image, portrait], probes, 'D:/out/merged.mp4', {
    ...baseSettings,
    canvasWidth: 1080,
    canvasHeight: 1920,
  })
  const covered = buildVideoMergeCommand(
    [videoItem(0, 'D:/media/wide.png', { kind: 'image', imageDurationSeconds: 2, frameFit: 'cover' }), portrait],
    probes,
    'D:/out/merged.mp4',
    { ...baseSettings, canvasWidth: 1080, canvasHeight: 1920 },
  )
  assert.match(filterGraph(fixed.args), /scale=1080:1920:force_original_aspect_ratio=decrease[^;]*crop=1080:1920/)
  assert.match(filterGraph(covered.args), /\[0:v\]scale=1080:1920:force_original_aspect_ratio=increase[^;]*crop=1080:1920/)
  assert.match(filterGraph(covered.args), /\[1:v\]scale=1080:1920:force_original_aspect_ratio=decrease[^;]*crop=1080:1920/)
  assert.equal(
    streamCopyControlsReason([portrait, portrait], { ...baseSettings, canvasWidth: 1920, canvasHeight: 1080 }),
    '固定分辨率必须重新编码',
  )
  assert.equal(largest.args[largest.args.indexOf('-framerate') + 1], '30')
  assert.match(limitedFilters, /loudnorm,volume=0\.8\[outa\]/)
  assert.doesNotMatch(filterGraph(buildVideoMergeCommand(
    [videoItem(0, 'D:/media/a.mp4', { muted: true }), videoItem(1, 'D:/media/b.mp4', { muted: true })],
    [probe(), probe()],
    'D:/out/muted.mp4',
    { ...baseSettings, loudnessNormalize: true },
  ).args), /loudnorm/)
})

test('video command applies each per-item rotation before fitting the output frame', () => {
  const clockwise = videoItem(0, 'D:/media/wide.mp4', { rotation: 'clockwise-90' })
  const portrait = videoItem(1, 'D:/media/tall.png', {
    kind: 'image',
    imageDurationSeconds: 2,
    rotation: 'counterclockwise-90',
  })
  const upsideDown = videoItem(2, 'D:/media/upside-down.mp4', { rotation: 'rotate-180' })
  const command = buildVideoMergeCommand(
    [clockwise, portrait, upsideDown],
    [
      probe({ width: 1920, height: 1080 }),
      probe({ width: 1080, height: 1920, videoCodec: 'image' }),
      probe({ width: 1920, height: 1080 }),
    ],
    'D:/out/oriented.mp4',
    { ...baseSettings, canvasWidth: 1920, canvasHeight: 1080 },
  )
  const filters = filterGraph(command.args)

  assert.match(filters, /\[0:v\]transpose=clock,scale=1920:1080/)
  assert.match(filters, /\[1:v\]transpose=cclock,scale=1920:1080/)
  assert.match(filters, /\[2:v\]hflip,vflip,scale=1920:1080/)
  assert.equal(
    streamCopyControlsReason([clockwise, videoItem(1, 'D:/media/other.mp4')], baseSettings),
    '单个素材的画面旋转必须重新编码',
  )

  const automaticFrame = filterGraph(buildVideoMergeCommand(
    [clockwise],
    [probe({ width: 1920, height: 1080 })],
    'D:/out/portrait.mp4',
    baseSettings,
  ).args)
  assert.match(automaticFrame, /transpose=clock,scale=1080:1920/)
})

test('video command applies per-item frame size after rotation and fitting', () => {
  const smaller = videoItem(0, 'D:/media/wide.mp4', {
    rotation: 'clockwise-90',
    frameScalePercent: 75,
    frameFocusX: 25,
    frameFocusY: 75,
  })
  const larger = videoItem(1, 'D:/media/tall.png', {
    kind: 'image',
    imageDurationSeconds: 2,
    frameScalePercent: 150,
  })
  const command = buildVideoMergeCommand(
    [smaller, larger],
    [probe({ width: 1920, height: 1080 }), probe({ width: 1080, height: 1920, videoCodec: 'image' })],
    'D:/out/scaled.mp4',
    { ...baseSettings, canvasWidth: 1920, canvasHeight: 1080 },
  )
  const filters = filterGraph(command.args)

  assert.match(filters, /transpose=clock,scale=1920:1080:force_original_aspect_ratio=decrease[^;]*iw\*0\.75[^;]*crop=1920:1080:'\(iw-ow\)\*0\.25':'\(ih-oh\)\*0\.75'/)
  assert.match(filters, /\[1:v\]scale=1920:1080:force_original_aspect_ratio=decrease[^;]*iw\*1\.5[^;]*crop=1920:1080:'\(iw-ow\)\*0\.5':'\(ih-oh\)\*0\.5'/)
  assert.equal(
    streamCopyControlsReason([
      videoItem(0, 'D:/media/scaled.mp4', { frameScalePercent: 75 }),
      videoItem(1, 'D:/media/other.mp4'),
    ], baseSettings),
    '单个素材的画面大小必须重新编码',
  )
  assert.equal(
    streamCopyControlsReason([
      videoItem(0, 'D:/media/focused.mp4', { frameFocusX: 25 }),
      videoItem(1, 'D:/media/other.mp4'),
    ], baseSettings),
    '单个素材的画面焦点必须重新编码',
  )
})

test('video command writes crossfaded chapter timestamps only for chapter containers', () => {
  const items = [
    videoItem(0, 'D:/media/opening clip.mp4'),
    videoItem(1, 'D:/media/second.mkv'),
  ]
  const probes = [probe({ durationSeconds: 5 }), probe({ durationSeconds: 4 })]
  const settings = {
    ...baseSettings,
    transition: { type: 'crossfade' as const, durationSeconds: 1 },
    loudnessNormalize: true,
  }
  const command = buildVideoMergeCommand(items, probes, 'D:/out/merged.mkv', settings)

  assert.equal(command.totalDuration, 8)
  assert.equal(command.args[0], '-ss')
  assert.equal(command.args.at(command.args.indexOf(VIDEO_CHAPTER_METADATA_PLACEHOLDER) - 1), '-i')
  assert.ok(command.args.includes('-map_chapters'))
  assert.equal(command.args.at(command.args.indexOf('-map_chapters') + 1), '2')
  assert.match(command.chapterMetadata ?? '', /TIMEBASE=1\/1000/)
  assert.match(command.chapterMetadata ?? '', /START=0\nEND=4000\ntitle=opening clip/)
  assert.match(command.chapterMetadata ?? '', /START=4000\nEND=8000\ntitle=second/)
  assert.equal(
    buildVideoMergeCommand(items, probes, 'D:/out/merged.webm', { ...settings, format: 'webm' }).chapterMetadata,
    null,
  )
  assert.equal(
    buildVideoMergeCommand(items, probes, 'D:/out/merged.mp4', settings, { chapters: false }).chapterMetadata,
    null,
  )
  assert.equal(
    streamCopyControlsReason(items, { ...settings, encodingMode: 'stream-copy', format: 'mp4' }),
    '快速流复制不支持响度归一，请使用重新编码',
  )
})

function filterGraph(args: string[]): string {
  return args[args.indexOf('-filter_complex') + 1] ?? ''
}

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
