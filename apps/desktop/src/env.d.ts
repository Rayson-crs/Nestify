import type { NestifyApi } from './lib/ipc'

export type { Collision, NestifyApi } from './lib/ipc'

declare global {
  interface Window {
    nestify: NestifyApi
  }
}

export {}
