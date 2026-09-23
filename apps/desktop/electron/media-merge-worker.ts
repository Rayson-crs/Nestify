import { parentPort, workerData } from 'node:worker_threads'
import type {
  MediaMergeDuration,
  MediaMergePlan,
  MediaMergePlanInput,
  MediaMergeProgress,
  MediaMergeTimeline,
  MediaMergeWaveform,
} from '@nestify/shared'
import { enrichMediaMergePlan } from '../../../packages/core/src/media/analysis.ts'
import { MediaMergeCancelledError, MediaMergeInterruptedError } from '../../../packages/core/src/media/errors.ts'
import { executeMediaMerge } from '../../../packages/core/src/media/executor.ts'
import {
  configureMediaToolPaths,
  extractAudioWaveform,
  extractVideoTimelineFrames,
  probeVideo,
} from '../../../packages/core/src/media/ffmpeg.ts'
import { readQuickVideoDuration } from '../../../packages/core/src/media/quick-duration.ts'
import { buildMediaMergePlan } from '../../../packages/core/src/media/plan.ts'
import type { MediaMergeResumeInput } from '../../../packages/core/src/media/resume.ts'

const port = parentPort
if (!port) throw new Error('media-merge-worker requires a worker parent port')

const mediaTools = (workerData as {
  mediaTools?: { ffmpegPath?: string; ffprobePath?: string }
} | undefined)?.mediaTools
configureMediaToolPaths(mediaTools ?? {})

type WorkerRequest =
  | { id: number; type: 'plan'; input: MediaMergePlanInput }
  | { id: number; type: 'execute'; input: WorkerExecuteInput }
  | { id: number; type: 'duration'; input: { path: string } }
  | { id: number; type: 'timeline'; input: { path: string } }
  | { id: number; type: 'waveform'; input: { path: string } }
  | { id: number; type: 'cancel'; jobId: string }

interface WorkerExecuteInput {
  jobId: string
  plan: MediaMergePlan
  workspacePath: string
  resume?: MediaMergeResumeInput
}

const controllers = new Map<string, AbortController>()
const MAX_PROBE_JOBS = 4
let activeProbeJobs = 0
const probeWaiters: Array<() => void> = []

port.on('message', (message: WorkerRequest) => {
  if (message.type === 'cancel') {
    controllers.get(message.jobId)?.abort(new MediaMergeCancelledError())
    return
  }
  const run = () => handle(message).finally(() => {
    if (message.type === 'duration' || message.type === 'timeline' || message.type === 'waveform') {
      activeProbeJobs -= 1
      probeWaiters.shift()?.()
    }
  })
  if (message.type !== 'duration' && message.type !== 'timeline' && message.type !== 'waveform') {
    void run().then(settle(message), fail(message))
    return
  }
  const start = () => {
    activeProbeJobs += 1
    void run().then(settle(message), fail(message))
  }
  if (activeProbeJobs < MAX_PROBE_JOBS) start()
  else probeWaiters.push(start)
})

function settle(message: Exclude<WorkerRequest, { type: 'cancel' }>) {
  return (result: unknown) => port.postMessage({ id: message.id, ok: true, result })
}

function fail(message: Exclude<WorkerRequest, { type: 'cancel' }>) {
  return (error: unknown) => port.postMessage({
    id: message.id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    interrupted: error instanceof MediaMergeInterruptedError,
    cancelled: error instanceof MediaMergeCancelledError,
  })
}

async function handle(message: Exclude<WorkerRequest, { type: 'cancel' }>): Promise<unknown> {
  if (message.type === 'plan') return enrichMediaMergePlan(await buildMediaMergePlan(message.input))
  if (message.type === 'duration') return readDuration(message.input.path)
  if (message.type === 'timeline') return readTimeline(message.input.path)
  if (message.type === 'waveform') return readWaveform(message.input.path)
  return runExecute(message.input)
}

async function runExecute(input: WorkerExecuteInput): Promise<{ outputPath: string }> {
  const controller = new AbortController()
  controllers.set(input.jobId, controller)
  try {
    return await executeMediaMerge({
      jobId: input.jobId,
      plan: input.plan,
      workspacePath: input.workspacePath,
      resume: input.resume,
      signal: controller.signal,
      onProgress: (progress) => port.postMessage({ type: 'progress', jobId: input.jobId, progress }),
    })
  } finally {
    controllers.delete(input.jobId)
  }
}

async function readDuration(path: string): Promise<MediaMergeDuration> {
  const quick = await readQuickVideoDuration(path)
  if (quick != null) return { durationSeconds: quick, error: null }
  const probe = await probeVideo(path)
  return { durationSeconds: probe.durationSeconds, error: null }
}

async function readTimeline(path: string): Promise<MediaMergeTimeline> {
  const extracted = await extractVideoTimelineFrames(path, { count: 8 })
  return {
    frames: extracted.frames.map((frame) => ({
      timeSeconds: frame.timeSeconds,
      dataUrl: `data:image/jpeg;base64,${frame.data.toString('base64')}`,
    })),
    durationSeconds: extracted.durationSeconds,
    error: null,
  }
}

async function readWaveform(path: string): Promise<MediaMergeWaveform> {
  const result = await extractAudioWaveform(path, { peakCount: 180 })
  return {
    peaks: result.peaks,
    sampleRate: result.sampleRate,
    durationSeconds: result.durationSeconds,
    error: null,
  }
}
