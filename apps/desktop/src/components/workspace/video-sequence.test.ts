import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizePreviewProxySrc, selectMainPreviewSurface, videoFrameIsPainted } from './video-preview-surface.ts'

test('main preview keeps an extracted frame until the browser decodes video dimensions', () => {
  const frameUrl = 'data:image/jpeg;base64,frame'
  const hiddenVideo = selectMainPreviewSurface({ frameUrl, videoReady: false })
  const paintedVideo = selectMainPreviewSurface({ frameUrl, videoReady: true })
  const empty = selectMainPreviewSurface({ frameUrl: null, videoReady: false })

  assert.equal(hiddenVideo, 'frame')
  assert.notEqual(hiddenVideo, 'video')
  assert.equal(paintedVideo, 'video')
  assert.equal(empty, 'empty')
  assert.equal(videoFrameIsPainted({ videoWidth: 0, videoHeight: 0 }), false)
  assert.equal(videoFrameIsPainted({ videoWidth: 16, videoHeight: 9 }), true)
  assert.equal(videoFrameIsPainted({ videoWidth: 16, videoHeight: 0 }), false)
})

test('composite preview selects the image layer for an image segment', () => {
  const image = selectMainPreviewSurface({
    frameUrl: 'data:image/jpeg;base64,video-frame',
    videoReady: false,
    imageReady: true,
  })
  const missingImage = selectMainPreviewSurface({
    frameUrl: 'data:image/jpeg;base64,video-frame',
    videoReady: false,
    imageReady: false,
  })

  assert.equal(image, 'image')
  assert.equal(missingImage, 'frame')
})

test('preview proxy protocol URLs are converted to the local media server', () => {
  const sourcePath = 'C:/Temp/nestify-media-preview/example.mp4'
  const result = normalizePreviewProxySrc(
    `nestify-media://preview/?path=${encodeURIComponent(sourcePath)}`,
    'http://127.0.0.1:1234/media?path=source.mp4',
    (path) => `http://127.0.0.1:4321/media?path=${encodeURIComponent(path)}`,
  )

  assert.equal(result, `http://127.0.0.1:4321/media?path=${encodeURIComponent(sourcePath)}`)
})
