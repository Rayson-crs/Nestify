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

export function scanPathAliases(input: string): string[] {
  const trimmed = input.trim()
  if (!trimmed) return []
  const normalized = normalizeScanPath(trimmed)
  const slash = trimmed.replace(/\\/g, '/')
  const slashTrimmed = slash.replace(/\/+$/, '') || slash
  const values = [trimmed, normalized, slash, slashTrimmed]
  if (/^[A-Za-z]:$/.test(slashTrimmed) || /^[A-Za-z]:\\?$/.test(normalized)) {
    const letter = (slashTrimmed[0] ?? normalized[0] ?? 'C').toUpperCase()
    const drive = `${letter}:`
    const driveLower = `${letter.toLowerCase()}:`
    values.push(drive, driveLower, `${drive}/`, `${driveLower}/`, `${drive}\\`, `${driveLower}\\`)
  }
  return [...new Set(values.filter(Boolean))]
}

export function parentPathMatchValues(input: string): string[] {
  const values = new Set<string>()
  for (const alias of scanPathAliases(input)) {
    const slash = alias.replace(/\\/g, '/')
    const trimmed = slash.replace(/\/+$/, '') || slash
    values.add(slash)
    values.add(trimmed)
    if (/^[A-Za-z]:$/.test(trimmed)) values.add(`${trimmed}/`)
  }
  return [...values].filter(Boolean)
}

export function parentScanPath(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (isUncPath(trimmed)) {
    const value = trimmed.replace(/\//g, '\\')
    const stripped = trimTrailingSeps(value, '\\')
    const parts = stripped.split('\\').filter(Boolean)
    if (parts.length <= 2) return null
    return `\\\\${parts.slice(0, -1).join('\\')}`
  }

  const slash = trimmed.replace(/\\/g, '/')
  const collapsed = slash.replace(/\/+$/, '') || slash
  if (collapsed === '/' || /^[A-Za-z]:$/.test(collapsed)) return null
  const idx = collapsed.lastIndexOf('/')
  if (idx < 0) return null
  let parent = collapsed.slice(0, idx)
  if (parent === '') return '/'
  if (/^[A-Za-z]:$/.test(parent)) parent = `${parent}/`
  const keepBackslash = trimmed.includes('\\') || (WIN && /^[A-Za-z]:/.test(parent))
  if (!keepBackslash) return parent
  if (/^[A-Za-z]:\/$/.test(parent)) return `${parent[0]}:\\`
  return parent.replace(/\//g, '\\')
}

export function directoryNameOf(path: string): string {
  const normalized = normalizeScanPath(path) || path.trim()
  if (!normalized) return path
  if (normalized === '/') return '/'
  if (/^[A-Za-z]:\\$/.test(normalized) || /^[A-Za-z]:\/$/.test(normalized)) return normalized
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

export function pathDepthOf(path: string): number {
  const normalized = normalizeScanPath(path) || path.trim()
  if (!normalized || normalized === '/') return 0
  if (/^[A-Za-z]:\\$/.test(normalized) || /^[A-Za-z]:\/$/.test(normalized) || /^[A-Za-z]:$/.test(normalized)) {
    return 0
  }
  if (isUncPath(normalized)) {
    return Math.max(0, normalized.split('\\').filter(Boolean).length - 2)
  }
  return Math.max(0, normalized.split(/[\\/]/).filter(Boolean).length - 1)
}

function comparablePath(path: string): string {
  const normalized = normalizeScanPath(path) || path.trim()
  const slash = normalized.includes('\\') || /^[A-Za-z]:/.test(normalized)
    ? normalized.replaceAll('/', '\\')
    : normalized
  return slash.toLowerCase()
}

export function isPathWithinRoot(path: string, root: string): boolean {
  const nPath = comparablePath(path)
  const nRoot = comparablePath(root)
  if (!nPath || !nRoot) return false
  if (nPath === nRoot) return true
  if (!nPath.includes('\\') && !nRoot.includes('\\')) {
    const prefix = nRoot.endsWith('/') ? nRoot : `${nRoot}/`
    return nPath.startsWith(prefix)
  }
  const prefix = nRoot.endsWith('\\') ? nRoot : `${nRoot}\\`
  return nPath.startsWith(prefix)
}

export function relPathUnderRoot(path: string, root: string): string {
  if (!isPathWithinRoot(path, root)) return ''
  const nPath = normalizeScanPath(path) || path.trim()
  const nRoot = normalizeScanPath(root) || root.trim()
  if (!nPath || !nRoot || comparablePath(nPath) === comparablePath(nRoot)) return ''
  const sep = nPath.includes('\\') || nRoot.includes('\\') ? '\\' : '/'
  const prefix = nRoot.endsWith(sep) ? nRoot : `${nRoot}${sep}`
  if (nPath.length >= prefix.length && nPath.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
    return nPath.slice(prefix.length).replace(/\\/g, '/')
  }
  return ''
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
