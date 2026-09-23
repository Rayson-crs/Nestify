import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import Module from 'node:module'
import { join } from 'node:path'

const sharpPackage = '@img/sharp-win32-x64'
const nodeRequire = createRequire(import.meta.url)

/**
 * Sharp resolves its native binding with a dynamic package require. The main
 * bundle externalizes sharp, while the portable build keeps only the Windows
 * runtime beside the app, so that package name has to resolve before import.
 */
export function configureSharpRuntime(resourcesPath = defaultResourcesPath()): void {
  if (canLoadSharp()) return
  const root = join(resourcesPath, 'sharp', 'node_modules', sharpPackage)
  const nativeBinding = join(root, 'lib', 'sharp-win32-x64.node')
  if (!existsSync(nativeBinding)) return

  const moduleWithResolve = Module as unknown as {
    _resolveFilename: (request: string, parent: unknown, isMain: boolean, options: unknown) => string
  }
  const originalResolve = moduleWithResolve._resolveFilename
  moduleWithResolve._resolveFilename = function resolveSharpRuntime(request, parent, isMain, options) {
    if (request === sharpPackage || request.startsWith(`${sharpPackage}/`)) {
      return originalResolve.call(this, packagedSharpRequest(root, request), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }
}

function canLoadSharp(): boolean {
  try {
    nodeRequire('sharp')
    return true
  } catch {
    return false
  }
}

function packagedSharpRequest(root: string, request: string): string {
  if (request === sharpPackage) return root
  const subpath = request.slice(sharpPackage.length + 1)
  if (subpath === 'sharp.node') return join(root, 'lib', 'sharp-win32-x64.node')
  if (subpath === 'package') return join(root, 'package.json')
  if (subpath === 'versions') return join(root, 'versions.json')
  return join(root, subpath)
}

function defaultResourcesPath(): string {
  return process.resourcesPath
}
