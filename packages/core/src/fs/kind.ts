import type { EntryKind } from '@nestify/shared'
import { splitName } from './path.ts'

const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.avif'])
const VIDEO = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m2ts'])
const AUDIO = new Set(['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.wma'])
const ARCHIVE = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.iso'])
const SUBTITLE = new Set(['.srt', '.ass', '.vtt', '.sub'])
const DOCUMENT = new Set(['.pdf', '.txt', '.md', '.doc', '.docx', '.nfo'])
const INSTALLER = new Set(['.exe', '.msi'])

export function classifyKind(name: string, isDir: boolean): EntryKind {
  if (isDir) return 'dir'
  if (!name) return 'unknown'
  const ext = splitName(name).ext
  if (IMAGE.has(ext)) return 'image'
  if (VIDEO.has(ext)) return 'video'
  if (AUDIO.has(ext)) return 'audio'
  if (ARCHIVE.has(ext)) return 'archive'
  if (SUBTITLE.has(ext)) return 'subtitle'
  if (DOCUMENT.has(ext)) return 'document'
  if (INSTALLER.has(ext)) return 'installer'
  return 'file'
}
