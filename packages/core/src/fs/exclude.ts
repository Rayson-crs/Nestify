export const DEFAULT_EXCLUDE_NAMES = [
  '$RECYCLE.BIN',
  'System Volume Information',
  '.git',
  'node_modules',
  '__pycache__',
  '.nestify-quarantine',
  'Thumbs.db',
  'desktop.ini',
]

export interface ExcludeSpec {
  names?: string[]
  globs?: string[]
}

export interface Excluder {
  shouldSkip(fullPath: string, name: string, isDir: boolean): boolean
}

const WIN = process.platform === 'win32'

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/')
  let pattern = ''
  for (let i = 0; i < normalized.length; ) {
    if (normalized.startsWith('**/', i)) {
      pattern += '(?:.*/)?'
      i += 3
      continue
    }
    if (normalized[i] === '*' && normalized[i + 1] === '*') {
      pattern += '.*'
      i += 2
      continue
    }
    if (normalized[i] === '*') {
      pattern += '[^/]*'
      i += 1
      continue
    }
    if (normalized[i] === '?') {
      pattern += '[^/]'
      i += 1
      continue
    }
    pattern += escapeRegExp(normalized[i]!)
    i += 1
  }
  return new RegExp(`^${pattern}$`, WIN ? 'i' : '')
}

function segments(fullPath: string): string[] {
  return fullPath.split(/[\\/]+/).filter((part) => part.length > 0 && part !== '.' && !part.endsWith(':'))
}

export function createExcluder(spec: ExcludeSpec = {}): Excluder {
  const rawNames = spec.names?.length ? spec.names : DEFAULT_EXCLUDE_NAMES
  const names = new Set(WIN ? rawNames.map((item) => item.toLowerCase()) : rawNames)
  const globs = (spec.globs ?? []).map(globToRegExp)

  return {
    shouldSkip(fullPath: string, name: string, _isDir: boolean): boolean {
      const key = WIN ? name.toLowerCase() : name
      if (names.has(key)) return true
      for (const part of segments(fullPath)) {
        if (names.has(WIN ? part.toLowerCase() : part)) return true
      }
      if (globs.length === 0) return false
      const slashPath = fullPath.replace(/\\/g, '/')
      return globs.some((pattern) => pattern.test(slashPath) || pattern.test(name))
    },
  }
}
