import { spawnSync } from 'node:child_process'
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(scriptDir, '..')
const outputDir = join(desktopDir, 'resources', 'ffmpeg')
const require = createRequire(import.meta.url)
const isWindows = process.platform === 'win32'
const executableSuffix = isWindows ? '.exe' : ''

const ffmpegSource = require('ffmpeg-static')
const ffmpegPackageRoot = dirname(require.resolve('ffmpeg-static/package.json'))
const ffprobePackage = require('@ffprobe-installer/ffprobe')
const ffprobeSource = ffprobePackage.path

mkdirSync(outputDir, { recursive: true })

ensureExecutable(ffmpegSource, `ffmpeg${executableSuffix}`)
ensureExecutable(ffprobeSource, `ffprobe${executableSuffix}`)
ensureFile(join(ffmpegPackageRoot, 'LICENSE'), join(outputDir, 'ffmpeg.LICENSE.txt'))
ensureFile(join(ffmpegPackageRoot, 'LICENSE'), join(outputDir, 'ffprobe.LICENSE.txt'))

verifyExecutable(join(outputDir, `ffmpeg${executableSuffix}`))
verifyExecutable(join(outputDir, `ffprobe${executableSuffix}`))
process.stdout.write(`bundled media tools prepared in ${outputDir}\n`)

function ensureExecutable(source, name) {
  const target = join(outputDir, name)
  assertFile(source)
  if (!sameFileSize(source, target)) copyFileSync(source, target)
  if (!isWindows) chmodSync(target, 0o755)
}

function verifyExecutable(path) {
  let result
  for (const delay of [0, 250, 750, 1500]) {
    if (delay > 0) sleep(delay)
    result = spawnSync(path, ['-version'], { encoding: 'utf8', windowsHide: true })
    if (!result.error && result.status === 0) return
  }
  if (isWindows && result?.error?.code === 'EPERM') {
    assertNonEmptyFile(path)
    process.stdout.write(`bundled media tool is present but execution verification was blocked: ${path}\n`)
    return
  }
  throw new Error(`unable to verify ${path}: ${result?.error?.message ?? result?.stderr}`)
}

function assertFile(path) {
  try {
    accessSync(path, constants.R_OK)
  } catch {
    throw new Error(`media tool is unavailable after install: ${path}`)
  }
}

function ensureFile(source, target) {
  assertFile(source)
  if (!sameFileSize(source, target)) copyFileSync(source, target)
}

function sameFileSize(source, target) {
  if (!existsSync(target)) return false
  return statSync(source).size === statSync(target).size
}

function assertNonEmptyFile(path) {
  assertFile(path)
  if (statSync(path).size <= 0) throw new Error(`bundled media tool is empty: ${path}`)
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}
