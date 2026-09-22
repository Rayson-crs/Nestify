import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

interface BundledTool {
  envName: 'NESTIFY_FFMPEG_PATH' | 'NESTIFY_FFPROBE_PATH'
  executable: string
}

const bundledTools: readonly BundledTool[] = [
  { envName: 'NESTIFY_FFMPEG_PATH', executable: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg' },
  { envName: 'NESTIFY_FFPROBE_PATH', executable: process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe' },
]

export function configureBundledMediaTools(): Record<string, string | false> {
  const result: Record<string, string | false> = {}
  for (const tool of bundledTools) {
    const path = resolveBundledTool(tool.executable)
    if (path && !process.env[tool.envName]) process.env[tool.envName] = path
    result[tool.envName] = path ?? false
  }
  return result
}

function resolveBundledTool(executable: string): string | null {
  const packaged = join(process.resourcesPath, 'resources', 'ffmpeg', executable)
  if (app.isPackaged && existsSync(packaged)) return packaged
  const local = join(app.getAppPath(), 'resources', 'ffmpeg', executable)
  return existsSync(local) ? local : null
}
