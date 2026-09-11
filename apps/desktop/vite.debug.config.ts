import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const root = __dirname

/** 纯浏览器调试用 Vite 配置（复刻 electron.vite.config.ts 的 renderer 段，不启动 Electron） */
export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
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
