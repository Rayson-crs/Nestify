import { app } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface BundledTool {
  envName: 'NESTIFY_FFMPEG_PATH' | 'NESTIFY_FFPROBE_PATH'
  executable: string
}

const bundledTools: readonly BundledTool[] = [
  { envName: 'NESTIFY_FFMPEG_PATH', executable: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg' },
  { envName: 'NESTIFY_FFPROBE_PATH', executable: process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe' },
]

const electronDir = dirname(fileURLToPath(import.meta.url))

export function configureBundledMediaTools(): Record<string, string | false> {
  const result: Record<string, string | false> = {}
  for (const tool of bundledTools) {
    const configured = resolveConfiguredTool(process.env[tool.envName], tool.executable)
    const path = configured ?? resolveBundledTool(tool.executable)
    if (path) process.env[tool.envName] = path
    else delete process.env[tool.envName]
    result[tool.envName] = path ?? false
  }
  return result
}

function resolveBundledTool(executable: string): string | null {
  const candidates = [
    join(process.resourcesPath, 'resources', 'ffmpeg', executable),
    join(process.resourcesPath, 'ffmpeg', executable),
    join(app.getAppPath(), 'resources', 'ffmpeg', executable),
    join(app.getAppPath(), 'apps', 'desktop', 'resources', 'ffmpeg', executable),
    join(electronDir, '..', '..', 'resources', 'ffmpeg', executable),
    join(electronDir, '..', 'resources', 'ffmpeg', executable),
    join(process.cwd(), 'resources', 'ffmpeg', executable),
    join(process.cwd(), 'apps', 'desktop', 'resources', 'ffmpeg', executable),
  ]
  return candidates.find(isUsableFile) ?? null
}

function resolveConfiguredTool(value: string | undefined, executable: string): string | null {
  if (!value) return null
  if (value.toLowerCase().endsWith(executable.toLowerCase()) && isUsableFile(value)) return value
  const nested = join(value, executable)
  return isUsableFile(nested) ? nested : null
}

function isUsableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
  } catch {
    return false
  }
}
