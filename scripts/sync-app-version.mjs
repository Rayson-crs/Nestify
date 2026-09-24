import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPkgPath = resolve(rootDir, 'package.json')
const desktopPkgPath = resolve(rootDir, 'apps/desktop/package.json')
const tauriConfigPath = resolve(rootDir, 'apps/desktop/src-tauri/tauri.conf.json')
const cargoPath = resolve(rootDir, 'apps/desktop/src-tauri/Cargo.toml')

const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
const version = typeof rootPkg.version === 'string' ? rootPkg.version.trim() : ''
if (!version) {
  throw new Error(`missing version in ${rootPkgPath}`)
}

const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, 'utf8'))
if (desktopPkg.version !== version) {
  desktopPkg.version = version
  writeFileSync(desktopPkgPath, `${JSON.stringify(desktopPkg, null, 2)}\n`)
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))
if (tauriConfig.version !== version) {
  tauriConfig.version = version
  writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`)
}

const cargo = readFileSync(cargoPath, 'utf8')
const nextCargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
if (nextCargo !== cargo) writeFileSync(cargoPath, nextCargo)
process.stdout.write(`app version ${version}\n`)
