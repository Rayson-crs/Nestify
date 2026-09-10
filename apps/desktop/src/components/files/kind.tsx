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
