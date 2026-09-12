import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { externalizeDepsPlugin } from 'electron-vite'

const root = dirname(fileURLToPath(import.meta.url))
const workspaceAlias = {
  '@nestify/core': resolve(root, '../../packages/core/src/index.ts'),
  '@nestify/shared': resolve(root, '../../packages/shared/src/index.ts'),
  '@nestify/rules': resolve(root, '../../packages/rules/src/index.ts'),
}

export default defineConfig({
  plugins: [externalizeDepsPlugin({ exclude: ['@nestify/core', '@nestify/shared', '@nestify/rules', 'yaml'] })],
  resolve: { alias: workspaceAlias },
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    target: 'node22',
    rollupOptions: {
      input: {
        'walk-worker': resolve(root, '../../packages/core/src/fs/walk-worker.ts'),
        'query-worker': resolve(root, 'electron/query-worker.ts'),
        'writer-worker': resolve(root, 'electron/writer-worker.ts'),
        'library-removal-worker': resolve(root, 'electron/library-removal-worker.ts'),
      },
      external: [/^node:/],
      output: {
        entryFileNames: '[name].mjs',
        format: 'es',
      },
    },
  },
})
