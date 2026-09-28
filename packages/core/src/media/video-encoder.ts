import { spawn } from 'node:child_process'
import { findFfmpegPath } from './ffmpeg.ts'

export type VideoEncoderChoice = {
  id: 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264' | 'libvpx-vp9' | 'mpeg4'
  args: string[]
  inputArgs?: string[]
  hwaccel?: 'cuda' | null
  preset?: string
}

export type HardwareEncoderId = 'h264_nvenc' | 'h264_qsv' | 'h264_amf'

type EncoderSettings = {
  format?: string
  quality?: 'standard' | 'high'
  ffmpegPath?: string | null
}

type EncoderProbe = {
  ffmpeg?: string | null
  listEncoders?: () => Promise<string>
  initializes?: (encoder: HardwareEncoderId) => Promise<boolean>
  initializesHwaccel?: (encoder: HardwareEncoderId) => Promise<boolean>
}

let cached: { at: number; choice: VideoEncoderChoice | null; format: string; quality: string; ffmpegPath: string | null } | null = null
const CACHE_MS = 5 * 60 * 1000
let encoderProbe: EncoderProbe | null = null

export function resetVideoEncoderCache(): void {
  cached = null
}

export function setVideoEncoderProbeForTests(probe: EncoderProbe | null): void {
  encoderProbe = probe
  cached = null
}

export async function resolveVideoEncoder(settings: EncoderSettings): Promise<VideoEncoderChoice> {
  const format = settings.format ?? 'mp4'
  const quality = settings.quality ?? 'standard'
  if (format === 'webm') {
    return {
      id: 'libvpx-vp9',
      args: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', quality === 'high' ? '2' : '5', '-b:v', '0', '-crf', quality === 'high' ? '28' : '34', '-pix_fmt', 'yuv420p'],
    }
  }
  if (format === 'avi') {
    return { id: 'mpeg4', args: ['-c:v', 'mpeg4', '-q:v', quality === 'high' ? '3' : '5', '-pix_fmt', 'yuv420p'] }
  }
  const ffmpegPath = settings.ffmpegPath ?? findFfmpegPath()
  if (
    cached
    && cached.format === format
    && cached.quality === quality
    && cached.ffmpegPath === ffmpegPath
    && Date.now() - cached.at < CACHE_MS
    && cached.choice
  ) {
    return cached.choice
  }
  const choice = await detectHardwareEncoder(quality, ffmpegPath).catch(() => cpuEncoder(quality))
  cached = { at: Date.now(), choice, format, quality, ffmpegPath }
  return choice
}

function cpuEncoder(quality: string): VideoEncoderChoice {
  return {
    id: 'libx264',
    args: ['-c:v', 'libx264', '-preset', quality === 'high' ? 'medium' : 'veryfast', '-crf', quality === 'high' ? '18' : '23', '-pix_fmt', 'yuv420p'],
  }
}

async function detectHardwareEncoder(quality: string, configuredFfmpeg: string | null): Promise<VideoEncoderChoice> {
  const ffmpeg = encoderProbe?.ffmpeg === undefined ? configuredFfmpeg : encoderProbe.ffmpeg
  if (!ffmpeg) return cpuEncoder(quality)
  const listed = encoderProbe?.listEncoders
    ? await encoderProbe.listEncoders().catch(() => '')
    : await runText(ffmpeg, ['-hide_banner', '-encoders']).catch(() => '')
  const cq = quality === 'high' ? '19' : '23'
  const candidates: Array<{ id: HardwareEncoderId; args: string[] }> = [
    { id: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-preset', quality === 'high' ? 'p4' : 'p1', '-rc', 'vbr', '-cq', cq, '-pix_fmt', 'yuv420p'] },
    { id: 'h264_qsv', args: ['-c:v', 'h264_qsv', '-preset', quality === 'high' ? 'medium' : 'veryfast', '-global_quality', cq, '-pix_fmt', 'nv12'] },
    { id: 'h264_amf', args: ['-c:v', 'h264_amf', '-quality', quality === 'high' ? 'quality' : 'speed', '-rc', 'cqp', '-qp_i', cq, '-qp_p', cq, '-pix_fmt', 'yuv420p'] },
  ]
  for (const candidate of candidates) {
    if (!listed.includes(candidate.id)) continue
    const usable = encoderProbe?.initializes
      ? await encoderProbe.initializes(candidate.id).catch(() => false)
      : await encoderInitializes(ffmpeg, candidate.id)
    if (!usable) continue
    if (candidate.id !== 'h264_nvenc') return { id: candidate.id, args: candidate.args, preset: presetOf(candidate.args) }
    const preset = quality === 'high' ? 'p4' : 'p1'
    const hwaccel = encoderProbe?.initializesHwaccel
      ? await encoderProbe.initializesHwaccel(candidate.id).catch(() => false)
      : await cudaDecodeInitializes(ffmpeg)
    return hwaccel
      ? { id: candidate.id, args: candidate.args, inputArgs: ['-hwaccel', 'cuda'], hwaccel: 'cuda', preset }
      : { id: candidate.id, args: candidate.args, hwaccel: null, preset }
  }
  return cpuEncoder(quality)
}

function presetOf(args: readonly string[]): string | undefined {
  const index = args.indexOf('-preset')
  return index >= 0 ? args[index + 1] : undefined
}

async function encoderInitializes(ffmpeg: string, encoder: string): Promise<boolean> {
  const result = await runStatus(ffmpeg, ['-hide_banner', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1', '-frames:v', '1', '-c:v', encoder, '-f', 'null', '-']).catch(() => ({ code: 1, output: '' }))
  return result.code === 0
}

async function cudaDecodeInitializes(ffmpeg: string): Promise<boolean> {
  const result = await runStatus(ffmpeg, [
    '-hide_banner',
    '-hwaccel', 'cuda',
    '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
    '-frames:v', '1',
    '-f', 'null', '-',
  ]).catch(() => ({ code: 1, output: '' }))
  return result.code === 0
}

export function vendorFromText(text: string): 'nvidia' | 'intel' | 'amd' | null {
  const value = text.toLowerCase()
  if (value.includes('nvidia') || value.includes('geforce') || value.includes('quadro')) return 'nvidia'
  if (value.includes('amd') || value.includes('radeon')) return 'amd'
  if (value.includes('intel') || value.includes('arc ') || value.includes('uhd') || value.includes('iris')) return 'intel'
  return null
}

function runText(command: string, args: string[]): Promise<string> {
  return runStatus(command, args).then((result) => result.output)
}

function runStatus(command: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('encoder probe timed out'))
    }, 8_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output = (output + chunk).slice(-24_000) })
    child.stderr.on('data', (chunk: string) => { output = (output + chunk).slice(-24_000) })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, output })
    })
  })
}
