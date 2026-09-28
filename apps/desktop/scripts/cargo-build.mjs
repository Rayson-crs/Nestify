import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const desktopDir = new URL('..', import.meta.url)
const target = process.env.NESTIFY_TAURI_TARGET ?? 'x86_64-pc-windows-gnu'
const rustupCargo = process.platform === 'win32'
  ? join(homedir(), '.cargo', 'bin', 'cargo.exe')
  : 'cargo'
const hasRustup = existsSync(rustupCargo)
const cargo = process.env.NESTIFY_CARGO || (hasRustup ? rustupCargo : 'cargo')
const env = { ...process.env }

if (hasRustup) {
  env.PATH = `${join(homedir(), '.cargo', 'bin')};${env.PATH ?? ''}`
}

const mingwBin = process.env.NESTIFY_MINGW_BIN || 'D:\\application\\mingw64\\bin'
if (process.platform === 'win32' && existsSync(join(mingwBin, 'windres.exe'))) {
  env.PATH = `${mingwBin};${env.PATH ?? ''}`
}

const result = spawnSync(cargo, [
  ...(hasRustup ? ['+stable-x86_64-pc-windows-gnu'] : []),
  'build',
  '--release',
  '--target',
  target,
  '--manifest-path',
  'src-tauri/Cargo.toml',
], {
  cwd: desktopDir,
  env,
  stdio: 'inherit',
  windowsHide: true,
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
