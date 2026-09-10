import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const electronDir = dirname(fileURLToPath(import.meta.url))

export function resolvePreload(): string {
  return join(electronDir, 'preload.cjs')
}

export function resolveQueryWorker(): string {
  return resolveWorkerBundle('query-worker.mjs')
}

export function resolveWriterWorker(): string {
  return resolveWorkerBundle('writer-worker.mjs')
}

function resolveWorkerBundle(name: string): string {
  const packaged = join(app.getAppPath(), 'dist-electron', name)
  if (existsSync(packaged)) return packaged
  const local = join(electronDir, name)
  return local
}

export function resolveRendererIndex(): string {
  return join(electronDir, '..', 'dist', 'index.html')
}

export function resolveSpotlightRendererIndex(): string {
  return join(electronDir, '..', 'dist', 'spotlight.html')
}

export function resolveAppIcon(): string {
  const packaged = join(process.resourcesPath, 'resources', 'nestify-icon.ico')
  if (app.isPackaged && existsSync(packaged)) return packaged
  const packagedPng = join(process.resourcesPath, 'resources', 'nestify-icon.png')
  if (app.isPackaged && existsSync(packagedPng)) return packagedPng
  const local = join(app.getAppPath(), 'resources', 'nestify-icon.ico')
  if (existsSync(local)) return local
  return join(app.getAppPath(), 'resources', 'nestify-icon.png')
}

export function resolveBundledConfigDir(): string {
  if (process.env.NESTIFY_CONFIG_DIR) return process.env.NESTIFY_CONFIG_DIR
  const packaged = join(process.resourcesPath, 'config')
  if (app.isPackaged && existsSync(join(packaged, 'app.default.yaml'))) return packaged
  const seeds = [
    join(process.cwd(), 'config'),
    join(process.cwd(), '..', 'config'),
    join(process.cwd(), '..', '..', 'config'),
    join(app.getAppPath(), 'config'),
    join(app.getAppPath(), '..', 'config'),
    join(app.getAppPath(), '..', '..', 'config'),
  ]
  for (const dir of seeds) {
    if (existsSync(join(dir, 'app.default.yaml'))) return dir
  }
  return join(process.cwd(), 'config')
}

export function rendererFailureUrl(title: string, details: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(renderErrorPage(title, details))}`
}

export function renderErrorPage(title: string, details: string): string {
  const escapedTitle = escapeHtml(title)
  const escapedDetails = escapeHtml(details)
  return `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><title>${escapedTitle}</title>
    <style>
      body { margin: 0; padding: 32px; color: hsl(222.2 47.4% 11.2%); background: #ffffff; font: 14px/1.5 system-ui, sans-serif; }
      main { max-width: 900px; margin: 0 auto; }
      h1 { font-size: 22px; font-weight: 600; }
      pre { white-space: pre-wrap; color: hsl(0 100% 50%); background: hsl(210 40% 96.1%); padding: 16px; border: 1px solid hsl(214.3 31.8% 91.4%); border-radius: 6px; }
    </style>
  </head>
  <body><main><h1>${escapedTitle}</h1><pre>${escapedDetails}</pre></main></body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
}
