import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ffmpegToolsCurrent, workerOutputsCurrent } from './dev-prepare.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const devScript = readFileSync(join(scriptDir, 'dev-tauri.mjs'), 'utf8')
const cargoManifest = readFileSync(join(scriptDir, '../src-tauri/Cargo.toml'), 'utf8')

test('tauri dev runs use the Vite renderer instead of the stale dist bundle', () => {
  assert.match(devScript, /'--no-default-features'/)
  assert.match(cargoManifest, /default\s*=\s*\["custom-protocol"\]/)
  assert.match(cargoManifest, /custom-protocol\s*=\s*\["tauri\/custom-protocol"\]/)
  assert.doesNotMatch(
    cargoManifest,
    /tauri\s*=\s*\{[^\n]*features\s*=\s*\[[^\]]*"custom-protocol"/,
  )
})

test('dev startup can recognize an unchanged ffmpeg stamp without executing it', () => {
  const fingerprint = {
    ffmpeg: { size: 10, sourceMtimeMs: 20, outputMtimeMs: 30 },
    ffprobe: { size: 11, sourceMtimeMs: 21, outputMtimeMs: 31 },
  }
  assert.equal(ffmpegToolsCurrent(fingerprint, fingerprint), true)
  assert.equal(ffmpegToolsCurrent({ ...fingerprint, ffmpeg: { ...fingerprint.ffmpeg, size: 9 } }, fingerprint), false)
})

test('dev startup keeps the worker rebuild decision tied to existing outputs', () => {
  assert.equal(typeof workerOutputsCurrent(), 'boolean')
})
