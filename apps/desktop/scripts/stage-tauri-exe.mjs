import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const desktopDir = resolve(dirname(scriptPath), '..')
const repoRoot = resolve(desktopDir, '../..')
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === resolve(scriptPath).toLowerCase()

if (invokedDirectly) {
  stageSingleExe()
}

function stageSingleExe() {
  const paths = readPackagingPaths()
  const sourceExe = resolve(paths.builtDir, 'nestify.exe')
  const sourceDll = resolve(paths.builtDir, 'WebView2Loader.dll')
  if (!existsSync(sourceExe)) throw new Error(`missing tauri executable: ${sourceExe}`)
  if (!existsSync(sourceDll)) throw new Error(`missing WebView2 loader: ${sourceDll}`)

  mkdirSync(paths.releaseDir, { recursive: true })
  rmSync(paths.stageDir, { recursive: true, force: true })
  mkdirSync(paths.stageDir, { recursive: true })

  const payloadDir = resolve(paths.stageDir, 'payload')
  mkdirSync(payloadDir, { recursive: true })
  cpSync(sourceExe, resolve(payloadDir, 'nestify.exe'))
  cpSync(sourceDll, resolve(payloadDir, 'WebView2Loader.dll'))
  stageNode(payloadDir)
  stageTree(resolve(desktopDir, 'sidecar'), resolve(payloadDir, 'apps/desktop/sidecar'))
  stageTree(resolve(desktopDir, 'runtime'), resolve(payloadDir, 'apps/desktop/runtime'))
  stageTree(resolve(desktopDir, 'dist-runtime'), resolve(payloadDir, 'apps/desktop/dist-runtime'))
  stageTree(resolve(desktopDir, 'dist'), resolve(payloadDir, 'apps/desktop/dist'))
  stageTree(resolve(repoRoot, 'config'), resolve(payloadDir, 'config'))
  stageResources(resolve(payloadDir, 'apps/desktop/resources'))
  stageWorkspacePackages(payloadDir)
  stageRuntimeDependencies(resolve(payloadDir, 'node_modules'))

  const archive = resolve(paths.stageDir, 'payload.zip')
  const archived = spawnSync('tar', ['-a', '-c', '-f', archive, '-C', payloadDir, '.'], { stdio: 'inherit' })
  if ((archived.status ?? 1) > 1 || !existsSync(archive) || statSync(archive).size === 0) {
    throw new Error('failed to archive the Nestify runtime')
  }

  const resource = resolve(paths.stageDir, 'launcher.rc')
  const resourceObject = resolve(paths.stageDir, 'launcher-res.o')
  const versionHeader = resolve(paths.stageDir, 'version.h')
  writeFileSync(versionHeader, `#define NESTIFY_VERSION L"${paths.version}"\n`, 'ascii')
  const icon = resolve(desktopDir, 'resources/nestify-icon.ico')
  if (!existsSync(icon)) throw new Error(`missing application icon: ${icon}`)
  writeFileSync(resource, `1 ICON "${rcPath(icon)}"\n101 RCDATA "${rcPath(archive)}"\n`, 'ascii')

  const compiledResource = spawnSync(paths.windres, ['-O', 'coff', '-o', resourceObject, resource], { stdio: 'inherit' })
  if (compiledResource.status !== 0) throw new Error('windres failed to embed the Nestify runtime')

  const launcher = resolve(desktopDir, 'src-tauri/launcher/launcher.c')
  const linked = spawnSync(paths.gcc, ['-municode', '-mwindows', '-O2', `-I${paths.stageDir}`, launcher, resourceObject, '-o', paths.output], { stdio: 'inherit' })
  if (linked.status !== 0) throw new Error('failed to link the single-file Nestify executable')

  rmSync(paths.stageDir, { recursive: true, force: true })
  const outputStat = statSync(paths.output)
  if (!outputStat.isFile() || outputStat.size <= 0) throw new Error(`single-file executable was not written: ${paths.output}`)
  console.log(paths.output)
}

function stageNode(payloadDir) {
  const nodePath = process.execPath
  if (!existsSync(nodePath)) throw new Error(`node executable not found: ${nodePath}`)
  cpSync(nodePath, resolve(payloadDir, 'node.exe'))
}

function stageResources(destination) {
  mkdirSync(destination, { recursive: true })
  stageTree(resolve(desktopDir, 'resources/ffmpeg'), resolve(destination, 'ffmpeg'))
  stageTree(resolve(desktopDir, 'resources/sharp'), resolve(destination, 'sharp'))
}

function stageWorkspacePackages(payloadDir) {
  for (const [name, relativeDir] of [
    ['@nestify/core', 'packages/core'],
    ['@nestify/rules', 'packages/rules'],
    ['@nestify/shared', 'packages/shared'],
  ]) {
    const source = resolve(repoRoot, relativeDir)
    const destination = resolve(payloadDir, relativeDir)
    stageTree(source, destination)
    const link = resolve(payloadDir, 'node_modules', name)
    mkdirSync(dirname(link), { recursive: true })
    const target = relative(dirname(link), destination)
    linkPackage(destination, link, target)
  }
}

function stageRuntimeDependencies(destination) {
  mkdirSync(destination, { recursive: true })
  for (const name of ['yaml', 'sharp', 'drizzle-orm', 'opencc-js']) {
    const source = resolveDependency(name)
    if (!source) throw new Error(`missing runtime dependency: ${name}`)
    stageTree(source, resolve(destination, name))
  }
  const imgRoot = resolveDependency('@img')
  if (imgRoot) stageTree(imgRoot, resolve(destination, '@img'))
}

function resolveDependency(name) {
  const candidates = [
    resolve(repoRoot, 'node_modules', name),
    resolve(desktopDir, 'node_modules', name),
    resolve(repoRoot, 'packages/core/node_modules', name),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function linkPackage(source, link, relativeTarget) {
  rmSync(link, { recursive: true, force: true })
  try {
    symlinkSync(relativeTarget, link, 'junction')
  } catch {
    stageTree(source, link)
  }
}

function stageTree(source, destination) {
  if (!existsSync(source)) throw new Error(`missing runtime directory: ${source}`)
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      const name = path.split(/[\\/]/).pop() ?? ''
      return name !== 'node_modules' && name !== '.git' && !name.endsWith('.test.ts')
    },
  })
}

export function readPackagingPaths() {
  const rootPkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
  const desktopPkg = JSON.parse(readFileSync(resolve(desktopDir, 'package.json'), 'utf8'))
  const version = String(rootPkg.version ?? '').trim()
  if (!version) throw new Error('missing version in root package.json')

  const productName = desktopPkg.build?.productName || 'Nestify'
  const template = desktopPkg.build?.win?.artifactName
    || desktopPkg.build?.portable?.artifactName
    || `${productName}-v\${version}.exe`
  const fileName = template
    .replaceAll('${productName}', productName)
    .replaceAll('${version}', version)
    .replaceAll('${arch}', 'x64')
    .replaceAll('${ext}', 'exe')
  const releaseDir = resolve(desktopDir, desktopPkg.build?.directories?.output || 'release')
  const mingwBin = process.env.NESTIFY_MINGW_BIN || 'D:\\application\\mingw64\\bin'
  return {
    version,
    fileName,
    releaseDir,
    output: resolve(releaseDir, fileName),
    stageDir: resolve(desktopDir, 'src-tauri/target/single-file-' + process.pid),
    builtDir: resolve(desktopDir, 'src-tauri/target/x86_64-pc-windows-gnu/release'),
    cargoTargetDir: resolve(desktopDir, 'src-tauri/target'),
    gcc: resolve(mingwBin, 'gcc.exe'),
    windres: resolve(mingwBin, 'windres.exe'),
  }
}

function rcPath(path) {
  return path.replaceAll('\\', '\\\\')
}

export function removePackagingLeftovers(output) {
  const paths = readPackagingPaths()
  if (resolve(output) !== paths.output) throw new Error(`refusing to clean for an unexpected executable: ${output}`)
  const removed = []
  removeIfPresent(paths.stageDir, paths.cargoTargetDir, { allowExact: true, removed })
  const portableDir = resolve(paths.releaseDir, paths.fileName.replace(/\.exe$/i, ''))
  for (const candidate of [
    resolve(paths.releaseDir, 'WebView2Loader.dll'),
    resolve(paths.releaseDir, `Nestify_${paths.version}.exe`),
    portableDir,
  ]) {
    if (samePath(candidate, paths.output) || samePath(candidate, paths.releaseDir)) continue
    removeIfPresent(candidate, paths.releaseDir, { allowExact: false, removed })
  }
  if (!existsSync(paths.releaseDir)) return removed
  for (const entry of readdirSync(paths.releaseDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isPackagingLeftoverDir(entry.name)) continue
    const candidate = resolve(paths.releaseDir, entry.name)
    if (samePath(candidate, paths.output) || containsPath(candidate, paths.output)) continue
    removeIfPresent(candidate, paths.releaseDir, { allowExact: false, removed })
  }
  return removed
}

function isPackagingLeftoverDir(name) {
  const normalized = name.toLowerCase()
  return normalized === 'package-slim'
    || normalized === 'win-unpacked'
    || normalized === 'verify-unpacked'
    || normalized.startsWith('verify-pack')
    || normalized.startsWith('package-v')
}

function removeIfPresent(candidate, allowedRoot, { allowExact, removed }) {
  if (!existsSync(candidate)) return
  const target = assertDeletable(candidate, allowedRoot, allowExact)
  rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 })
  removed.push(target)
}

function assertDeletable(candidate, allowedRoot, allowExact) {
  const target = resolve(candidate)
  const root = resolve(allowedRoot)
  if (isProtected(target) || !within(root, target, allowExact)) {
    throw new Error(`refusing to delete ${target}`)
  }
  const realTarget = realpathSync(target)
  const realRoot = realpathSync(root)
  if (isProtected(realTarget) || !within(realRoot, realTarget, allowExact)) {
    throw new Error(`refusing to delete ${realTarget}`)
  }
  return realTarget
}

function isProtected(target) {
  const protectedPaths = [repoRoot, desktopDir, resolve(desktopDir, 'src-tauri/target'), resolve(desktopDir, 'release')]
  const normalizedTarget = normalizePath(target)
  return protectedPaths.some((path) => normalizePath(path) === normalizedTarget)
}

function within(parent, candidate, allowExact) {
  const rel = relative(resolve(parent), resolve(candidate))
  if (rel === '') return allowExact
  return !rel.startsWith('..') && !isAbsolute(rel)
}

function containsPath(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function samePath(left, right) {
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(path) {
  return resolve(path).replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()
}
