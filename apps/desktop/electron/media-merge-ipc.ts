import { dialog, ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import type {
  MediaMergePlan,
  MediaMergePlanInput,
  MediaMergeSelectedFile,
  MediaMergeDuration,
  MediaMergeTimeline,
  MediaMergeWaveform,
} from '@nestify/shared'
import { mediaPreviewUrl } from './media-protocol'
import { getRuntime } from './runtime-host'
import { appState, IMAGE_EXT, MAX_IMAGE_PREVIEW, VIDEO_EXT } from './state'
import { mimeForImage } from './thumbnails'

export function registerMediaMergeIpc(): void {
  getRuntime().onMediaMergeProgress((progress) => {
    const window = appState.mainWindow
    if (window && !window.isDestroyed()) window.webContents.send('mediaMerge.progress', progress)
  })

  ipcMain.handle('mediaMerge.selectFiles', async () => {
    const parent = appState.mainWindow
    if (parent && !parent.isDestroyed()) {
      if (parent.isMinimized()) parent.restore()
      parent.show()
      parent.focus()
    }
    const result = await dialog.showOpenDialog(parent ?? undefined, {
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        {
          name: '可合并媒体',
          extensions: [...IMAGE_EXT, ...VIDEO_EXT].map((extension) => extension.replace(/^\./, '')),
        },
      ],
    })
    if (result.canceled) return { files: [] }

    const files: MediaMergeSelectedFile[] = []
    for (const path of Array.from(new Set(result.filePaths))) {
      const info = await stat(path)
      const extension = extname(path).toLowerCase()
      if (!isAbsolute(path) || !info.isFile() || (!IMAGE_EXT.has(extension) && !VIDEO_EXT.has(extension))) {
        throw new Error('只能选择本地图片或视频文件')
      }
      files.push({
        path,
        kind: IMAGE_EXT.has(extension) ? 'image' : 'video',
        size: info.size,
        mtime: info.mtimeMs,
      })
    }
    return { files }
  })

  ipcMain.handle(
    'mediaMerge.buildPlan',
    async (_event, input: MediaMergePlanInput) => getRuntime().buildMediaMergePlan(input),
  )

  ipcMain.handle(
    'mediaMerge.start',
    async (_event, input: { plan: MediaMergePlan }) => getRuntime().startMediaMerge(input.plan),
  )

  ipcMain.handle(
    'mediaMerge.cancel',
    async (_event, input: { jobId: string }) => getRuntime().cancelMediaMerge(input.jobId),
  )

  ipcMain.handle(
    'mediaMerge.resume',
    async (_event, input: { jobId: string }) => getRuntime().resumeMediaMerge(input.jobId),
  )

  ipcMain.handle('mediaMerge.progress', (_event, input: { jobId: string }) => {
    const progress = getRuntime().getMediaMergeProgress(input.jobId)
    if (!progress) throw new Error(`媒体合并任务不存在：${input.jobId}`)
    return progress
  })

  ipcMain.handle(
    'mediaMerge.preview',
    async (_event, input: { path: string; selectedPaths: string[] }) => {
      const selected = new Set(input.selectedPaths)
      if (!selected.has(input.path)) return { kind: 'none' as const }
      try {
        const extension = extname(input.path).toLowerCase()
        if (IMAGE_EXT.has(extension)) {
          const info = await stat(input.path)
          if (info.size > MAX_IMAGE_PREVIEW) return { kind: 'too-large' as const }
          const buf = await readFile(input.path)
          return {
            kind: 'image' as const,
            dataUrl: `data:${mimeForImage(extension)};base64,${buf.toString('base64')}`,
          }
        }
        if (VIDEO_EXT.has(extension)) {
          const info = await stat(input.path)
          if (!info.isFile()) return { kind: 'none' as const }
          return { kind: 'video' as const, src: mediaPreviewUrl(input.path) }
        }
      } catch {
        return { kind: 'none' as const }
      }
      return { kind: 'none' as const }
    },
  )

  ipcMain.handle(
    'mediaMerge.timeline',
    async (_event, input: { path: string; selectedPaths: string[] }): Promise<MediaMergeTimeline> =>
      getRuntime().getMediaMergeTimeline(input),
  )

  ipcMain.handle(
    'mediaMerge.waveform',
    async (_event, input: { path: string; selectedPaths: string[] }): Promise<MediaMergeWaveform> =>
      getRuntime().getMediaMergeWaveform(input),
  )

  ipcMain.handle(
    'mediaMerge.duration',
    async (_event, input: { path: string; selectedPaths: string[] }): Promise<MediaMergeDuration> =>
      getRuntime().getMediaMergeDuration(input),
  )
}
