import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(scriptDir, '..')
const cacheDir = join(desktopDir, '.dev-cache')
const ffmpegStampPath = join(cacheDir, 'ffmpeg.json')
const isWindows = process.platform === 'win32'
const executableSuffix = isWindows ? '.exe' : ''
const workerOutputs = [
  'sidecar.mjs',
  'walk-worker.mjs',
  'query-worker.mjs',
  'preview-worker.mjs',
  'writer-worker.mjs',
  'scan-worker.mjs',
  'task-worker.mjs',
  'library-removal-worker.mjs',
  'media-merge-worker.mjs',
]

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDevStartup()
}

export async function prepareDevStartup() {
  const started = Date.now()
  if (ffmpegToolsCurrent()) {
    process.stdout.write('bundled media tools are current, skipped verification\n')
  } else {
    await runNode(join(scriptDir, 'prepare-ffmpeg.mjs'))
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(ffmpegStampPath, `${JSON.stringify(ffmpegFingerprint(), null, 2)}\n`)
  }

  if (workerOutputsCurrent()) {
    process.stdout.write('runtime workers are current, skipped rebuild\n')
    return
  }
  process.stdout.write(`runtime workers are stale, rebuilding (${Math.round(Date.now() - started)}ms elapsed)\n`)
  const viteBin = [
    join(desktopDir, 'node_modules', 'vite', 'bin', 'vite.js'),
    resolve(desktopDir, '../../node_modules/vite/bin/vite.js'),
  ].find((path) => existsSync(path))
  if (!viteBin) throw new Error('vite was not found. Run npm install from the repository root.')
  await runNode(viteBin, ['build', '--config', 'worker.vite.config.ts'], desktopDir)
}

export function ffmpegToolsCurrent(stamp = readStamp(ffmpegStampPath), fingerprint = ffmpegFingerprint()) {
  return stampMatches(stamp, fingerprint)
}

export function workerOutputsCurrent() {
  const outputDir = join(desktopDir, 'dist-runtime')
  const outputs = workerOutputs.map((name) => join(outputDir, name))
  if (outputs.some((path) => !existsSync(path))) return false
  const oldestOutput = Math.min(...outputs.map((path) => statSync(path).mtimeMs))
  return newestInputMtime() <= oldestOutput
}

function ffmpegFingerprint() {
  const require = createRequire(import.meta.url)
  const outputDir = join(desktopDir, 'resources', 'ffmpeg')
  const sources = {
    ffmpeg: require('ffmpeg-static'),
    ffprobe: require('@ffprobe-installer/ffprobe').path,
  }
  const fingerprint = {}
  for (const [name, source] of Object.entries(sources)) {
    const output = join(outputDir, `${name}${executableSuffix}`)
    if (!existsSync(source) || !existsSync(output)) return null
    const sourceStat = statSync(source)
    const outputStat = statSync(output)
    if (sourceStat.size !== outputStat.size || outputStat.size <= 0) return null
    fingerprint[name] = {
      size: outputStat.size,
      sourceMtimeMs: sourceStat.mtimeMs,
      outputMtimeMs: outputStat.mtimeMs,
    }
  }
  return fingerprint
}

function newestInputMtime() {
  const files = [
    join(desktopDir, 'worker.vite.config.ts'),
    ...sourceFiles(join(desktopDir, 'sidecar')),
    ...sourceFiles(join(desktopDir, 'runtime')),
    ...sourceFiles(resolve(desktopDir, '../../packages/core/src')),
    ...sourceFiles(resolve(desktopDir, '../../packages/shared/src')),
    ...sourceFiles(resolve(desktopDir, '../../packages/rules/src')),
  ]
  return Math.max(...files.filter((path) => existsSync(path)).map((path) => statSync(path).mtimeMs))
}

function sourceFiles(directory) {
  if (!existsSync(directory)) return []
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path))
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|json)$/.test(entry.name) && !/\.test\./.test(entry.name)) found.push(path)
  }
  return found
}

function readStamp(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function stampMatches(stamp, fingerprint) {
  if (!stamp || !fingerprint) return false
  return Object.entries(fingerprint).every(([name, current]) => {
    const saved = stamp[name]
    return saved?.size === current.size
      && saved.sourceMtimeMs === current.sourceMtimeMs
      && saved.outputMtimeMs === current.outputMtimeMs
  })
}

function runNode(script, args = [], cwd = scriptDir) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${script} failed with exit code ${code ?? 'unknown'}`))
    })
    child.on('error', reject)
  })
}
