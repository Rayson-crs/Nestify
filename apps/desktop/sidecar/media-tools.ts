import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sidecarDir = dirname(fileURLToPath(import.meta.url))
const executable = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

export function configureBundledMediaTools(): Record<string, string | false> {
  const result: Record<string, string | false> = {}
  for (const [envName, name] of [
    ['NESTIFY_FFMPEG_PATH', 'ffmpeg'],
    ['NESTIFY_FFPROBE_PATH', 'ffprobe'],
  ] as const) {
    const path = resolveConfiguredTool(process.env[envName], executable(name)) ?? resolveBundledTool(executable(name))
    if (path) process.env[envName] = path
    else delete process.env[envName]
    result[envName] = path ?? false
  }
  return result
}

export function resolveBundledTool(name: string): string | null {
  const candidates = [
    join(process.env.NESTIFY_RESOURCE_DIR ?? '', 'ffmpeg', name),
    join(process.resourcesPath ?? '', 'resources', 'ffmpeg', name),
    join(process.resourcesPath ?? '', 'ffmpeg', name),
    join(sidecarDir, '..', 'resources', 'ffmpeg', name),
    join(process.cwd(), 'apps', 'desktop', 'resources', 'ffmpeg', name),
    join(process.cwd(), 'resources', 'ffmpeg', name),
  ]
  return candidates.find(isUsableFile) ?? null
}

function resolveConfiguredTool(value: string | undefined, name: string): string | null {
  if (!value) return null
  if (value.toLowerCase().endsWith(name.toLowerCase()) && isUsableFile(value)) return value
  const nested = join(value, name)
  return isUsableFile(nested) ? nested : null
}

function isUsableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
  } catch {
    return false
  }
}
