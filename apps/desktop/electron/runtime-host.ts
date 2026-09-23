import { NestifyRuntime } from '@nestify/core'
import { logStartup, type StartupLog } from './log'
import { resolveBundledConfigDir, resolveMediaMergeWorker } from './paths'
import { appState } from './state'
import { MediaMergeWorkerClient } from './media-merge-worker-client'

export function getRuntime(onStartupLog: StartupLog = logStartup): NestifyRuntime {
  if (!appState.runtime) {
    appState.runtime = new NestifyRuntime({
      bundledConfigDir: resolveBundledConfigDir(),
      mediaMergeWorkerPath: resolveMediaMergeWorker(),
      mediaMergeWorkerFactory: (workerPath) => new MediaMergeWorkerClient(workerPath, {
        ffmpegPath: process.env.NESTIFY_FFMPEG_PATH,
        ffprobePath: process.env.NESTIFY_FFPROBE_PATH,
      }),
      onStartupLog,
      fileSync: false,
    })
  }
  return appState.runtime
}
