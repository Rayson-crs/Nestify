import { isAbsolute } from 'node:path'

const WIN = process.platform === 'win32'

export function isUncPath(input: string): boolean {
  return input.startsWith('\\\\') || input.startsWith('//')
}

function trimTrailingSeps(value: string, sep: string): string {
  let end = value.length
  while (end > 1 && value[end - 1] === sep) end -= 1
  return value.slice(0, end)
}

export function normalizeScanPath(input: string): string {
  let value = input.trim()
  if (!value) return value

  if (WIN) {
    value = value.replace(/\//g, '\\')
    if (isUncPath(value)) {
      const stripped = trimTrailingSeps(value, '\\')
      const parts = stripped.split('\\').filter(Boolean)
      if (parts.length <= 2) return `\\\\${parts.join('\\')}`
      return stripped
    }
    if (/^[A-Za-z]:\\?$/.test(value)) {
      return `${value[0]}:\\`
    }
    return trimTrailingSeps(value, '\\')
  }

  if (value === '/') return '/'
  return trimTrailingSeps(value, '/')
}

export function toLongPath(path: string): string {
  if (!WIN) return path
  const normalized = path.replace(/\//g, '\\')
  if (normalized.startsWith('\\\\?\\')) return normalized
  if (isUncPath(normalized)) return normalized
  if (isAbsolute(normalized) && normalized.length > 240) {
    return `\\\\?\\${normalized}`
  }
  return normalized
}

export function splitName(name: string): { stem: string; ext: string } {
  if (!name || name === '.' || name === '..') return { stem: name, ext: '' }
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0) return { stem: name, ext: '' }
  const extBody = name.slice(lastDot + 1)
  if (!extBody) return { stem: name, ext: '' }
  return {
    stem: name.slice(0, lastDot),
    ext: `.${extBody.toLowerCase()}`,
  }
}
