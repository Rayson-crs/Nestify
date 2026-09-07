import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))

const workspaceAlias = {
  '@nestify/core': resolve(root, '../../packages/core/src/index.ts'),
  '@nestify/shared': resolve(root, '../../packages/shared/src/index.ts'),
  '@nestify/rules': resolve(root, '../../packages/rules/src/index.ts'),
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@nestify/core', '@nestify/shared', '@nestify/rules', 'yaml'],
      }),
    ],
    resolve: {
      alias: workspaceAlias,
    },
    build: {
      outDir: 'dist-electron',
      sourcemap: false,
      lib: {
        entry: resolve(root, 'electron/main.ts'),
      },
      rollupOptions: {
        output: {
          entryFileNames: 'main.js',
          format: 'es',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      lib: {
        entry: resolve(root, 'electron/preload.ts'),
      },
      rollupOptions: {
        output: {
          entryFileNames: 'preload.js',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root,
    base: './',
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
      },
    },
    plugins: [react()],
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: resolve(root, 'index.html'),
      },
    },
  },
})
