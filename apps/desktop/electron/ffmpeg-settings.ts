import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { configureBundledMediaTools, resolveBundledTool } from './media-tools'
import { appState } from './state'

const FFMPEG_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const FFPROBE_NAME = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

export function applyFfmpegDirectory(directory: string | null): void {
  if (directory) {
    const ffmpegPath = resolveTool(directory, FFMPEG_NAME)
    const ffprobePath = resolveTool(directory, FFPROBE_NAME)
    if (ffmpegPath && ffprobePath) {
      process.env.NESTIFY_FFMPEG_PATH = ffmpegPath
      process.env.NESTIFY_FFPROBE_PATH = ffprobePath
      appState.runtime?.resetMediaMergeWorker()
      return
    }
  }
  configureBundledMediaTools()
  appState.runtime?.resetMediaMergeWorker()
}

export async function testFfmpegDirectory(directory: string | null): Promise<{
  ok: boolean
  message: string
  ffmpegVersion: string | null
  ffprobeVersion: string | null
}> {
  const ffmpegPath = directory ? resolveTool(directory, FFMPEG_NAME) : resolveBundledTool(FFMPEG_NAME)
  const ffprobePath = directory ? resolveTool(directory, FFPROBE_NAME) : resolveBundledTool(FFPROBE_NAME)
  if (!ffmpegPath || !ffprobePath) {
    return {
      ok: false,
      message: directory ? '所选目录里没有同时找到 ffmpeg 和 ffprobe' : '内置 FFmpeg 不可用',
      ffmpegVersion: null,
      ffprobeVersion: null,
    }
  }
  try {
    const [ffmpegVersion, ffprobeVersion] = await Promise.all([
      readVersion(ffmpegPath),
      readVersion(ffprobePath),
    ])
    return {
      ok: true,
      message: `连接成功：FFmpeg ${ffmpegVersion}，FFprobe ${ffprobeVersion}`,
      ffmpegVersion,
      ffprobeVersion,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'FFmpeg 测试失败',
      ffmpegVersion: null,
      ffprobeVersion: null,
    }
  }
}

function resolveTool(directory: string, executable: string): string | null {
  const direct = join(directory, executable)
  const nested = join(directory, 'bin', executable)
  if (isUsableFile(direct)) return direct
  if (isUsableFile(nested)) return nested
  return null
}

function isUsableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
  } catch {
    return false
  }
}

function readVersion(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('FFmpeg 测试超时'))
    }, 8_000)
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`${path} 无法启动（退出码 ${code ?? '未知'}）`))
        return
      }
      const version = output.split(/\r?\n/, 1)[0]?.trim()
      resolve(version || '未知版本')
    })
  })
}
