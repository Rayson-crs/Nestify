export function pathCrumbs(path: string): Array<{ label: string; path: string }> {
  const normalized = path.replace(/\\/g, '/')
  const prefix = normalized.startsWith('//') ? '//' : ''
  const parts = normalized.split('/').filter(Boolean)
  return parts.map((part, index) => {
    const isDrive = index === 0 && /^[A-Za-z]:$/.test(part)
    return {
      label: isDrive ? `${part}/` : part,
      path: `${prefix}${parts.slice(0, index + 1).join('/')}${isDrive ? '/' : ''}`,
    }
  })
}

export function normalizeDirectoryPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isWithinDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizeDirectoryPath(path).toLowerCase()
  const normalizedDirectory = normalizeDirectoryPath(directory).toLowerCase()
  return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`)
}

export function rootCrumb(path: string): { label: string; path: string } {
  const normalized = normalizeDirectoryPath(path)
  const parts = normalized.split('/').filter(Boolean)
  const last = parts[parts.length - 1]
  if (parts.length === 1 && /^[A-Za-z]:$/.test(last)) return { label: `${last}/`, path: `${normalized}/` }
  return { label: last || normalized, path: normalized }
}

export function libraryPathCrumbs(path: string, rootPath: string | null): Array<{ label: string; path: string }> {
  if (!rootPath) return pathCrumbs(path)
  const normalizedPath = normalizeDirectoryPath(path)
  const normalizedRoot = normalizeDirectoryPath(rootPath)
  if (!isWithinDirectory(normalizedPath, normalizedRoot)) return [rootCrumb(rootPath)]

  const root = rootCrumb(rootPath)
  const relativeParts = normalizedPath
    .slice(normalizedRoot.length)
    .split('/')
    .filter(Boolean)
  const crumbs = [root]
  let current = normalizedRoot
  for (const part of relativeParts) {
    current = `${current}/${part}`
    crumbs.push({ label: part, path: current })
  }
  return crumbs
}
