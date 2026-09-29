import { existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { readPackagingPaths, removePackagingLeftovers } from './stage-tauri-exe.mjs'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const desktopDir = resolve(dirname(scriptPath), '..')

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === resolve(scriptPath).toLowerCase()

if (invokedDirectly) {
  buildSingleExe()
}

function buildSingleExe() {
  const build = spawnSync('npm', ['run', 'build:tauri'], {
    cwd: desktopDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status ?? 1)

  const { output } = readPackagingPaths()
  const outputStat = existsSync(output) ? statSync(output) : null
  if (!outputStat?.isFile() || outputStat.size <= 0) {
    throw new Error(`single-file executable was not written: ${output}`)
  }

  const removed = removePackagingLeftovers(output)
  for (const path of removed) console.log(`removed ${path}`)

  const after = statSync(output)
  if (!after.isFile() || after.size !== outputStat.size) {
    throw new Error(`cleanup removed or changed the single-file executable: ${output}`)
  }
  console.log(output)
}
