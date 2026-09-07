/// <reference types="vite/client" />

import type { NestifyApi } from './lib/ipc'

declare global {
  interface Window {
    nestify: NestifyApi
  }
}

export {}
