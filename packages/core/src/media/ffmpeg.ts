import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { MediaMergeCancelledError, MediaMergeInterruptedError } from './errors.ts'

export interface FfmpegProbeResult {
  durationSeconds: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  videoCodec: string | null
  audioCodec: string | null
  videoProfile: string | null
  audioProfile: string | null
  pixelFormat: string | null
  sampleRate: number | null
  audioChannels: number | null
  videoTimeBase: string | null
}

export interface FfmpegRunOptions {
  signal?: AbortSignal
  onProgress?: (progress: { seconds: number }) => void
}

interface ProbePayload {
  format?: { duration?: string }
  streams?: Array<{
    codec_type?: string
    duration?: string
    codec_name?: string
    profile?: string
    pix_fmt?: string
    sample_rate?: string
    channels?: number
    time_base?: string
    width?: number
    height?: number
    avg_frame_rate?: string
  }>
}

export interface MediaMergeTimelineFrameData {
  timeSeconds: number
  data: Buffer
}

let configuredFfmpegPath: string | undefined
let configuredFfprobePath: string | undefined

export function configureMediaToolPaths(paths: {
  ffmpegPath?: string | null
  ffprobePath?: string | null
}): void {
  configuredFfmpegPath = paths.ffmpegPath ?? undefined
  configuredFfprobePath = paths.ffprobePath ?? undefined
}

export function findFfmpegPath(extraPaths: readonly string[] = []): string | null {
  return findExecutable('ffmpeg', [
    configuredFfmpegPath,
    process.env.NESTIFY_FFMPEG_PATH,
    ...extraPaths,
    ...(process.env.PATH ?? '').split(delimiter),
  ])
}

export function findFfprobePath(extraPaths: readonly string[] = []): string | null {
  return findExecutable('ffprobe', [
    configuredFfprobePath,
    process.env.NESTIFY_FFPROBE_PATH,
    ...extraPaths,
    ...(process.env.PATH ?? '').split(delimiter),
  ])
}

export async function probeVideo(
  path: string,
  options: { ffprobePath?: string | null; signal?: AbortSignal } = {},
): Promise<FfmpegProbeResult> {
  const { probeMediaInput } = await import('./image-clip-probe.ts')
  const imageProbe = await probeMediaInput(path, options.signal)
  if (imageProbe) return imageProbe
  const ffprobePath = options.ffprobePath ?? findFfprobePath()
  if (!ffprobePath) throw new Error('未找到可用 ffprobe，请安装 FFmpeg 或设置 NESTIFY_FFPROBE_PATH')
  const stdout = await runProcess(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { signal: options.signal },
  )
  let payload: ProbePayload
  try {
    payload = JSON.parse(stdout) as ProbePayload
  } catch {
    throw new Error(`无法解析视频信息：${path}`)
  }
  const video = payload.streams?.find((stream) => stream.codec_type === 'video')
  if (!video?.width || !video?.height) throw new Error(`视频没有可用的视频流：${path}`)
  const audio = payload.streams?.find((stream) => stream.codec_type === 'audio')
  const duration = Number(payload.format?.duration ?? video.duration ?? Number.NaN)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`无法读取视频时长：${path}`)
  return {
    durationSeconds: duration,
    width: video.width,
    height: video.height,
    fps: parseFrameRate(video.avg_frame_rate),
    hasAudio: payload.streams?.some((stream) => stream.codec_type === 'audio') ?? false,
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    videoProfile: video.profile ?? null,
    audioProfile: audio?.profile ?? null,
    pixelFormat: video.pix_fmt ?? null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    audioChannels: audio?.channels ?? null,
    videoTimeBase: video.time_base ?? null,
  }
}

export function streamCopyMergeReason(probes: readonly FfmpegProbeResult[]): string | null {
  if (probes.length < 2) return '流复制至少需要两个输入'
  const first = probes[0]!
  if (probes.some((probe) => probe.videoCodec !== 'h264')) {
    return '流复制要求所有输入都是 H.264 视频'
  }
  if (probes.some((probe) => probe.videoProfile !== first.videoProfile)) {
    return '视频 H.264 profile 不一致'
  }
  if (probes.some((probe) => probe.pixelFormat !== first.pixelFormat)) {
    return '视频像素格式不一致'
  }
  if (probes.some((probe) => probe.videoTimeBase !== first.videoTimeBase)) {
    return '视频 timebase 不一致'
  }
  if (probes.some((probe) => probe.width !== first.width || probe.height !== first.height)) {
    return '视频分辨率不一致'
  }
  if (probes.some((probe) => Math.abs(probe.fps - first.fps) > 0.01)) {
    return '视频帧率不一致'
  }
  const audioStreams = probes.filter((probe) => probe.hasAudio)
  if (audioStreams.length !== probes.length && audioStreams.length > 0) {
    return '部分输入没有音频流'
  }
  if (audioStreams.length > 0) {
    const firstAudio = audioStreams[0]!
    if (audioStreams.some((probe) => probe.audioCodec !== 'aac')) {
      return '流复制要求所有音频流都是 AAC'
    }
    if (audioStreams.some((probe) => probe.audioProfile !== firstAudio.audioProfile)) {
      return 'AAC profile 不一致'
    }
    if (audioStreams.some((probe) => probe.sampleRate !== firstAudio.sampleRate)) {
      return '音频采样率不一致'
    }
    if (audioStreams.some((probe) => probe.audioChannels !== firstAudio.audioChannels)) {
      return '音频声道数不一致'
    }
  }
  return null
}

export function canStreamCopyMerge(probes: readonly FfmpegProbeResult[]): boolean {
  return streamCopyMergeReason(probes) === null
}

export async function runFfmpeg(
  args: readonly string[],
  options: FfmpegRunOptions = {},
): Promise<void> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('未找到可用 FFmpeg，请安装 FFmpeg 或设置 NESTIFY_FFMPEG_PATH')
  await runProcess(ffmpegPath, ['-hide_banner', '-y', ...args], options, true)
}

export async function runFfmpegBinary(
  args: readonly string[],
  options: FfmpegRunOptions = {},
): Promise<Buffer> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('未找到可用 FFmpeg，请安装 FFmpeg 或设置 NESTIFY_FFMPEG_PATH')
  return runProcessBuffer(ffmpegPath, ['-hide_banner', '-y', ...args], options)
}

export async function extractVideoTimelineFrames(
  path: string,
  options: { count?: number; signal?: AbortSignal } = {},
): Promise<{ frames: MediaMergeTimelineFrameData[]; durationSeconds: number }> {
  const count = Math.max(4, Math.min(12, Math.trunc(options.count ?? 10)))
  const ffprobePath = findFfprobePath()
  const probe = await probeVideo(path, { ffprobePath, signal: options.signal })
  const frames: MediaMergeTimelineFrameData[] = []
  const durationSeconds = probe.durationSeconds
  for (let index = 0; index < count; index += 1) {
    const timeSeconds = Math.max(0, (durationSeconds * (index + 0.5)) / count)
    const data = await runFfmpegBinary([
      '-ss', timeSeconds.toFixed(3),
      '-i', path,
      '-frames:v', '1',
      '-vf', 'scale=160:-2:force_original_aspect_ratio=decrease',
      '-q:v', '4',
      '-f', 'image2',
      '-c:v', 'mjpeg',
      'pipe:1',
    ], { signal: options.signal })
    if (data.length > 0) frames.push({ timeSeconds, data })
  }
  return { frames, durationSeconds }
}

export async function extractAudioWaveform(
  path: string,
  options: { peakCount?: number; signal?: AbortSignal } = {},
): Promise<{ peaks: number[]; sampleRate: number; durationSeconds: number; hasAudio: boolean }> {
  const peakCount = Math.max(32, Math.min(600, Math.trunc(options.peakCount ?? 160)))
  const ffprobePath = findFfprobePath()
  const probe = await probeVideo(path, { ffprobePath, signal: options.signal })
  if (!probe.hasAudio) {
    return { peaks: [], sampleRate: probe.sampleRate ?? 0, durationSeconds: probe.durationSeconds, hasAudio: false }
  }
  const sampleRate = 8_000
  const pcm = await runFfmpegBinary([
    '-i', path,
    '-vn',
    '-ac', '1',
    '-ar', String(sampleRate),
    '-f', 's16le',
    '-c:a', 'pcm_s16le',
    'pipe:1',
  ], { signal: options.signal })
  const samples = Math.floor(pcm.length / 2)
  if (samples === 0) {
    return { peaks: [], sampleRate, durationSeconds: probe.durationSeconds, hasAudio: true }
  }
  const peaks = new Array<number>(Math.min(peakCount, samples)).fill(0)
  const samplesPerPeak = samples / peaks.length
  for (let index = 0; index < samples; index += 1) {
    const value = pcm.readInt16LE(index * 2) / 32_768
    const peakIndex = Math.min(peaks.length - 1, Math.floor(index / samplesPerPeak))
    peaks[peakIndex] = Math.max(peaks[peakIndex]!, Math.abs(value))
  }
  const maxPeak = Math.max(...peaks)
  const normalized = maxPeak > 0 ? peaks.map((peak) => Math.round((peak / maxPeak) * 1_000) / 1_000) : peaks
  return { peaks: normalized, sampleRate, durationSeconds: probe.durationSeconds, hasAudio: true }
}

function findExecutable(name: 'ffmpeg' | 'ffprobe', candidates: Array<string | undefined>): string | null {
  const executable = process.platform === 'win32' ? `${name}.exe` : name
  for (const candidate of candidates) {
    if (!candidate) continue
    const path = candidate.toLowerCase().endsWith(executable.toLowerCase())
      ? candidate
      : join(candidate, executable)
    if (existsSync(path)) return path
  }
  return null
}

function runProcess(
  command: string,
  args: readonly string[],
  options: FfmpegRunOptions,
  parseProgress = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(options.signal))
      return
    }

    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let lastEmittedSeconds = Number.NaN

    const abort = () => child.kill()
    options.signal?.addEventListener('abort', abort, { once: true })
    const cleanupSignal = () => options.signal?.removeEventListener('abort', abort)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (parseProgress) {
        parseFfmpegProgress(chunk, options, (seconds) => {
          if (!Number.isFinite(lastEmittedSeconds) || seconds - lastEmittedSeconds >= 0.25) {
            lastEmittedSeconds = seconds
            options.onProgress?.({ seconds })
          }
        })
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16 * 1024)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanupSignal()
      reject(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanupSignal()
      if (options.signal?.aborted) {
        reject(abortError(options.signal))
        return
      }
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(
        `FFmpeg 执行失败（退出码 ${code ?? signal ?? 'unknown'}）：${compactError(stderr)}`,
      ))
    })
  })
}

function runProcessBuffer(
  command: string,
  args: readonly string[],
  options: FfmpegRunOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(options.signal))
      return
    }
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false
    const abort = () => child.kill()
    options.signal?.addEventListener('abort', abort, { once: true })
    const cleanupSignal = () => options.signal?.removeEventListener('abort', abort)

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16 * 1024)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanupSignal()
      reject(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanupSignal()
      if (options.signal?.aborted) {
        reject(abortError(options.signal))
        return
      }
      if (code === 0) {
        resolve(Buffer.concat(chunks))
        return
      }
      reject(new Error(
        `FFmpeg 执行失败（退出码 ${code ?? signal ?? 'unknown'}）：${compactError(stderr)}`,
      ))
    })
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof MediaMergeInterruptedError
    ? signal.reason
    : new MediaMergeCancelledError()
}

function parseFfmpegProgress(
  chunk: string,
  options: FfmpegRunOptions,
  update: (seconds: number) => void,
): void {
  for (const line of chunk.split(/\r?\n/)) {
    const match = line.match(/^(?:out_time_us|out_time_ms)=(\d+)$/)
    if (!match) continue
    const raw = Number(match[1])
    if (!Number.isFinite(raw)) continue
    const microseconds = line.startsWith('out_time_us') ? raw : raw * 1000
    const seconds = microseconds / 1_000_000
    update(seconds)
  }
}

function compactError(stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return '没有返回错误详情'
  const relevant = lines.filter((line) => (
    /error|invalid|failed|matches no streams|do not match|not found|nothing was written/i.test(line)
  ))
  const selected = relevant.length > 0 ? relevant : lines.slice(-3)
  return [...new Set(selected)].slice(-6).join(' | ')
}

function parseFrameRate(value: string | undefined): number {
  if (!value) return 30
  const [ numerator, denominator] = value.split('/')
  const parsed = Number(numerator) / (denominator ? Number(denominator) : 1)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30
}
