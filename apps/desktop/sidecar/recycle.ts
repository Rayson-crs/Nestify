import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

export async function recyclePath(path: string): Promise<true> {
  const info = await stat(path)
  await runRecycleCommand(info.isDirectory(), path)
  return true
}

async function runRecycleCommand(directory: boolean, path: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('system recycle bin is only available on Windows')
  }
  const method = directory ? 'DeleteDirectory' : 'DeleteFile'
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${powershellQuote(path)}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
  ].join('; ')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `recycle bin command failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

function powershellQuote(value: string): string {
  return value.replaceAll("'", "''")
}
