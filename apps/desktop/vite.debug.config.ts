import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const root = __dirname

/** Browser-only Vite config. It does not start the desktop shell. */
export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      '@nestify/media-order': resolve(root, '../../packages/core/src/media/order.ts'),
    },
  },
  plugins: [react()],
  build: {
    outDir: 'dist-browser',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        spotlight: resolve(root, 'spotlight.html'),
      },
    },
  },
})
