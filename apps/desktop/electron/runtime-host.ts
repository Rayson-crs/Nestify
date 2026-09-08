import { NestifyRuntime } from '@nestify/core'
import { logStartup, type StartupLog } from './log'
import { resolveBundledConfigDir } from './paths'
import { appState } from './state'

export function getRuntime(onStartupLog: StartupLog = logStartup): NestifyRuntime {
  if (!appState.runtime) {
    appState.runtime = new NestifyRuntime({
      bundledConfigDir: resolveBundledConfigDir(),
      onStartupLog,
    })
  }
  return appState.runtime
}