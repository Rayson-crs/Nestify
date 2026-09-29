import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const workspaceAlias = {
  '@nestify/core': resolve(root, '../../packages/core/src/index.ts'),
  '@nestify/shared': resolve(root, '../../packages/shared/src/index.ts'),
  '@nestify/rules': resolve(root, '../../packages/rules/src/index.ts'),
}
const externalIds = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  'sharp',
  'yaml',
])

export default defineConfig({
  resolve: { alias: workspaceAlias },
  build: {
    modulePreload: false,
    outDir: 'dist-runtime',
    emptyOutDir: false,
    target: 'node22',
    rollupOptions: {
      input: {
        sidecar: resolve(root, 'sidecar/main.ts'),
        'walk-worker': resolve(root, '../../packages/core/src/fs/walk-worker.ts'),
        'query-worker': resolve(root, 'runtime/query-worker.ts'),
        'preview-worker': resolve(root, 'runtime/preview-worker.ts'),
        'writer-worker': resolve(root, 'runtime/writer-worker.ts'),
        'scan-worker': resolve(root, 'runtime/scan-worker.ts'),
        'task-worker': resolve(root, 'runtime/task-worker.ts'),
        'library-removal-worker': resolve(root, 'runtime/library-removal-worker.ts'),
        'media-merge-worker': resolve(root, 'runtime/media-merge-worker.ts'),
      },
      external: (id) => externalIds.has(id) || id.startsWith('node:'),
      output: {
        entryFileNames: '[name].mjs',
        format: 'es',
      },
    },
  },
})
