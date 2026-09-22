import { spawnSync } from 'node:child_process'
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  rmSync,
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

rmSync(outputDir, { force: true, recursive: true })
mkdirSync(outputDir, { recursive: true })

copyExecutable(ffmpegSource, `ffmpeg${executableSuffix}`)
copyExecutable(ffprobeSource, `ffprobe${executableSuffix}`)
copyFileSync(
  join(ffmpegPackageRoot, 'LICENSE'),
  join(outputDir, 'ffmpeg.LICENSE.txt'),
)
copyFileSync(
  join(ffmpegPackageRoot, 'LICENSE'),
  join(outputDir, 'ffprobe.LICENSE.txt'),
)

verifyExecutable(join(outputDir, `ffmpeg${executableSuffix}`))
verifyExecutable(join(outputDir, `ffprobe${executableSuffix}`))
process.stdout.write(`bundled media tools prepared in ${outputDir}\n`)

function copyExecutable(source, name) {
  const target = join(outputDir, name)
  assertFile(source)
  copyFileSync(source, target)
  if (!isWindows) chmodSync(target, 0o755)
}

function verifyExecutable(path) {
  const result = spawnSync(path, ['-version'], { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) {
    throw new Error(`unable to verify ${path}: ${result.error?.message ?? result.stderr}`)
  }
}

function assertFile(path) {
  try {
    accessSync(path, constants.R_OK)
  } catch {
    throw new Error(`media tool is unavailable after install: ${path}`)
  }
}
