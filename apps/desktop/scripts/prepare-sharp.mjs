import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(desktopRoot, '../..')
const destination = resolve(desktopRoot, 'resources/sharp/node_modules')
const packages = [
  ['sharp', resolve(repoRoot, 'node_modules/sharp')],
  ['@img/colour', resolve(repoRoot, 'node_modules/@img/colour')],
  ['detect-libc', resolve(repoRoot, 'node_modules/detect-libc')],
  ['semver', resolve(repoRoot, 'node_modules/sharp/node_modules/semver')],
  ['@img/sharp-win32-x64', resolve(repoRoot, 'node_modules/@img/sharp-win32-x64')],
]

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })

for (const [name, source] of packages) {
  const target = resolve(destination, name)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !path.split(/[\\/]/).includes('src') && !path.endsWith('.md'),
  })
}

console.log(`Prepared sharp runtime at ${destination}`)
