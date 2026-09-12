import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin, type Plugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))

const workspaceAlias = {
  '@nestify/core': resolve(root, '../../packages/core/src/index.ts'),
  '@nestify/shared': resolve(root, '../../packages/shared/src/index.ts'),
  '@nestify/rules': resolve(root, '../../packages/rules/src/index.ts'),
}

/**
 * 按环境注入 CSP meta，消除 Electron "Insecure Content-Security-Policy" 警告：
 *   dev  —— 允许 Vite HMR（ws://localhost）与 React refresh 的 inline script；
 *   prod —— 锁死到 'self' + data:/blob: 图片 + nestify-thumbnail 自定义协议。
 * 注意必须在 app ready 前把 nestify-thumbnail 注册为特权协议（main.ts 已做），
 * 否则 CSP 允许了也加载不出缩略图。
 */
function cspPlugin(): Plugin {
  const meta = (isDev: boolean) => {
    const policy = [
      "default-src 'self'",
      isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: nestify-thumbnail:",
      "font-src 'self' data:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      isDev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join('; ')
    return `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  }
  return {
    name: 'nestify:csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const tag = meta(Boolean(ctx.server))
        if (/<meta\s+http-equiv="Content-Security-Policy"/i.test(html)) return html
        return html.replace('</title>', `</title>\n    ${tag}`)
      },
    },
  }
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
      // Worker bundles share this directory; the main-process build must not remove them.
      emptyOutDir: false,
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
          entryFileNames: 'preload.cjs',
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
        '@nestify/assistant': resolve(root, '../../packages/core/src/assistant/index.ts'),
      },
    },
    plugins: [react(), cspPlugin()],
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
  },
})
