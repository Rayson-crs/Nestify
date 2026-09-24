import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'

const desktopDir = fileURLToPath(new URL('..', import.meta.url))
const tauriDir = fileURLToPath(new URL('../src-tauri/', import.meta.url))
const target = process.env.NESTIFY_TAURI_TARGET ?? 'x86_64-pc-windows-gnu'
const env = { ...process.env }

const viteBin = [
  fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
  fileURLToPath(new URL('../../../node_modules/vite/bin/vite.js', import.meta.url)),
].find((path) => existsSync(path))

if (!viteBin) {
  console.error('vite was not found. Run npm install from the repository root.')
  process.exit(1)
}

const children = []
let shuttingDown = false

await start()

async function start() {
  const renderer = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: desktopDir,
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
  children.push(renderer)
  renderer.on('exit', (code, signal) => {
    if (shuttingDown) return
    shutdown(code ?? (signal ? 1 : 0))
  })

  try {
    await waitForPort(5173, 60_000)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    shutdown(1)
    return
  }
  if (shuttingDown) return

  const shell = spawn('cargo', ['+stable-x86_64-pc-windows-gnu', 'run', '--target', target], {
    cwd: tauriDir,
    env,
    stdio: 'inherit',
    windowsHide: false,
  })
  children.push(shell)
  shell.on('exit', (code, signal) => {
    if (shuttingDown) return
    shutdown(code ?? (signal ? 1 : 0))
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0))
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  setTimeout(() => process.exit(code), 300)
}

function waitForPort(port, timeoutMs) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect({ host: '127.0.0.1', port }, () => {
        socket.end()
        resolve()
      })
      socket.on('error', () => {
        socket.destroy()
        if (Date.now() - started > timeoutMs) reject(new Error(`renderer did not listen on 127.0.0.1:${port}`))
        else setTimeout(attempt, 300)
      })
    }
    attempt()
  })
}
