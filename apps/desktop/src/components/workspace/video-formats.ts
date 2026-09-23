import type { MediaMergeVideoFormat } from '@/lib/ipc'

export const VIDEO_OUTPUT_FORMATS: ReadonlyArray<{
  value: MediaMergeVideoFormat
  label: string
  description: string
}> = [
  { value: 'mp4', label: 'MP4', description: '最通用。H.264 + AAC，手机、网页和常见播放器都能直接打开，也是快速流复制的输出格式。' },
  { value: 'mov', label: 'MOV', description: 'QuickTime 容器，编码与 MP4 相同。适合交给剪辑软件，体积和兼容性接近 MP4。' },
  { value: 'mkv', label: 'MKV', description: 'Matroska 容器，适合本地存档。可容纳多种编码，部分手机和网页播放器不能直接打开。' },
  { value: 'webm', label: 'WebM', description: '网页向格式，使用 VP9 + Opus。兼容现代浏览器，编码比 H.264 慢，旧播放器支持较差。' },
  { value: 'avi', label: 'AVI', description: '老式容器，使用 MPEG-4 + MP3。老设备容易打开，但体积更大，不适合新的剪辑流程。' },
  { value: 'ts', label: 'TS', description: 'MPEG 传输流。适合广播、录制和继续封装，普通播放没问题，直接分享不如 MP4 方便。' },
]
