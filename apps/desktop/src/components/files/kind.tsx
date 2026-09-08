import { FileArchive, FileAudio, FileImage, FileQuestion, FileText, FileVideo, Folder } from 'lucide-react'

export function KindIcon({ kind }: { kind: string }) {
  const className = 'h-4 w-4 shrink-0 text-muted-foreground'
  if (kind === 'dir') return <Folder className={className} />
  if (kind === 'video') return <FileVideo className={className} />
  if (kind === 'image') return <FileImage className={className} />
  if (kind === 'audio') return <FileAudio className={className} />
  if (kind === 'archive') return <FileArchive className={className} />
  if (kind === 'document' || kind === 'subtitle') return <FileText className={className} />
  return <FileQuestion className={className} />
}
