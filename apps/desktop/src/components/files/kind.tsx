import {
  Braces,
  Database,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FileCog,
  Presentation,
} from 'lucide-react'

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic', 'avif',
])
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg', 'ts', 'm2ts',
])
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'wma'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso'])
const DOCUMENT_EXTENSIONS = new Set([
  // Word and other text document formats.
  'pdf', 'txt', 'md', 'markdown', 'rtf', 'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm',
  'odt', 'nfo', 'wps', 'wpsx', 'pages', 'pub', 'xps',
])
const SPREADSHEET_EXTENSIONS = new Set([
  // Excel, OpenDocument, and interchange spreadsheet formats.
  'csv', 'tsv', 'xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm', 'xlam', 'ods', 'fods', 'numbers',
])
const PRESENTATION_EXTENSIONS = new Set([
  // PowerPoint, OpenDocument, and other presentation formats.
  'ppt', 'pptx', 'pptm', 'pot', 'potx', 'potm', 'pps', 'ppsx', 'ppsm', 'odp', 'otp', 'key',
])
const SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'vtt', 'sub'])
const CODE_EXTENSIONS = new Set([
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'java', 'kt', 'kts', 'go', 'rs', 'swift',
  'm', 'mm', 'php', 'rb', 'lua', 'pl', 'py', 'pyw', 'js', 'jsx', 'ts', 'tsx', 'vue',
  'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'sql', 'sh', 'bash', 'zsh',
  'fish', 'ps1', 'bat', 'cmd',
])
const CONFIG_EXTENSIONS = new Set([
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'xml', 'properties',
])
const FONT_EXTENSIONS = new Set(['ttf', 'otf', 'woff', 'woff2', 'eot'])
const DATABASE_EXTENSIONS = new Set(['db', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'dump'])
const INSTALLER_EXTENSIONS = new Set(['exe', 'msi', 'dmg', 'deb', 'rpm', 'app'])

export function kindFromPath(path: string | null | undefined): string {
  if (!path) return 'unknown'
  const normalized = path.replace(/[\\/]+$/, '')
  const name = normalized.split(/[\\/]/).pop() ?? normalized
  const lowerName = name.toLowerCase()
  if (lowerName === 'dockerfile' || lowerName === 'makefile') return 'code'
  const dot = lowerName.lastIndexOf('.')
  if (dot < 1 || dot === lowerName.length - 1) return 'file'
  const extension = lowerName.slice(dot + 1)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive'
  if (SUBTITLE_EXTENSIONS.has(extension)) return 'subtitle'
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  if (CONFIG_EXTENSIONS.has(extension) || ['.env', '.gitignore', '.gitattributes'].includes(lowerName)) return 'config'
  if (SPREADSHEET_EXTENSIONS.has(extension)) return 'spreadsheet'
  if (PRESENTATION_EXTENSIONS.has(extension)) return 'presentation'
  if (FONT_EXTENSIONS.has(extension)) return 'font'
  if (DATABASE_EXTENSIONS.has(extension)) return 'database'
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document'
  if (INSTALLER_EXTENSIONS.has(extension)) return 'installer'
  return 'file'
}

export function KindIcon({ kind }: { kind: string }) {
  const base = 'h-4 w-4 shrink-0'
  if (kind === 'dir') return <Folder className={`${base} text-amber-500`} />
  if (kind === 'video') return <FileVideo className={`${base} text-rose-500`} />
  if (kind === 'image') return <FileImage className={`${base} text-sky-500`} />
  if (kind === 'audio') return <FileAudio className={`${base} text-violet-500`} />
  if (kind === 'archive') return <FileArchive className={`${base} text-orange-500`} />
  if (kind === 'code') return <FileCode2 className={`${base} text-blue-600`} />
  if (kind === 'config') return <FileCog className={`${base} text-slate-500`} />
  if (kind === 'spreadsheet') return <FileSpreadsheet className={`${base} text-emerald-600`} />
  if (kind === 'presentation') return <Presentation className={`${base} text-orange-600`} />
  if (kind === 'font') return <FileType className={`${base} text-pink-500`} />
  if (kind === 'database') return <Database className={`${base} text-cyan-600`} />
  if (kind === 'document' || kind === 'subtitle') return <FileText className={`${base} text-slate-600`} />
  if (kind === 'installer') return <Braces className={`${base} text-indigo-500`} />
  return <FileQuestion className={`${base} text-muted-foreground`} />
}
