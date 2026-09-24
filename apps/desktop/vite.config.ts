import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const appVersion = JSON.parse(readFileSync(resolve(root, '../../package.json'), 'utf8')).version as string

export default defineConfig({
  root,
  base: './',
  define: {
    __APP_NAME__: JSON.stringify('Nestify'),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      '@nestify/assistant': resolve(root, '../../packages/core/src/assistant/index.ts'),
      '@nestify/media-order': resolve(root, '../../packages/core/src/media/order.ts'),
    },
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        spotlight: resolve(root, 'spotlight.html'),
      },
    },
  },
})
