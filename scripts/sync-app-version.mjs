import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPkgPath = resolve(rootDir, 'package.json')
const desktopPkgPath = resolve(rootDir, 'apps/desktop/package.json')

const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
const version = typeof rootPkg.version === 'string' ? rootPkg.version.trim() : ''
if (!version) {
  throw new Error(`missing version in ${rootPkgPath}`)
}

const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, 'utf8'))
if (desktopPkg.version === version) {
  process.stdout.write(`app version ${version}\n`)
  process.exit(0)
}

desktopPkg.version = version
writeFileSync(desktopPkgPath, `${JSON.stringify(desktopPkg, null, 2)}\n`)
process.stdout.write(`synced desktop version -> ${version}\n`)
