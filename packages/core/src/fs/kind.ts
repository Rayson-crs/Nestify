import type { EntryKind } from '@nestify/shared'
import { splitName } from './path.ts'

// Keep aligned with apps/desktop/runtime/media-extensions.ts.
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.avif'])
const VIDEO = new Set([
  '.mp4', '.m4v', '.mkv', '.avi', '.mov', '.wmv', '.asf', '.flv', '.webm',
  '.ts', '.mts', '.m2ts', '.mpg', '.mpeg', '.vob', '.3gp', '.3g2', '.ogv', '.f4v',
])
const AUDIO = new Set(['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.wma'])
const ARCHIVE = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.iso'])
const SUBTITLE = new Set(['.srt', '.ass', '.vtt', '.sub'])
const DOCUMENT = new Set(['.pdf', '.txt', '.md', '.doc', '.docx', '.nfo'])
const CODE = new Set([
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.cs', '.java', '.kt', '.kts', '.go', '.rs',
  '.swift', '.m', '.mm', '.php', '.rb', '.lua', '.pl', '.py', '.pyw', '.js', '.jsx', '.ts',
  '.tsx', '.vue', '.svelte', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.sql',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.dockerfile',
])
const CONFIG = new Set([
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.env', '.xml',
  '.properties', '.editorconfig', '.gitignore', '.gitattributes', '.npmrc', '.eslintrc',
])
const SPREADSHEET = new Set(['.csv', '.tsv', '.xls', '.xlsx', '.ods'])
const PRESENTATION = new Set(['.ppt', '.pptx', '.odp', '.key'])
const FONT = new Set(['.ttf', '.otf', '.woff', '.woff2', '.eot'])
const DATABASE = new Set(['.db', '.sqlite', '.sqlite3', '.mdb', '.accdb', '.dump'])
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
  if (CODE.has(ext) || ['dockerfile', 'makefile'].includes(name.toLowerCase())) return 'code'
  if (CONFIG.has(ext) || ['.env', '.gitignore', '.gitattributes'].includes(name.toLowerCase())) return 'config'
  if (SPREADSHEET.has(ext)) return 'spreadsheet'
  if (PRESENTATION.has(ext)) return 'presentation'
  if (FONT.has(ext)) return 'font'
  if (DATABASE.has(ext)) return 'database'
  if (DOCUMENT.has(ext)) return 'document'
  if (INSTALLER.has(ext)) return 'installer'
  return 'file'
}
