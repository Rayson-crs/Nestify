import fs from 'node:fs'
const p = 'apps/desktop/src/components/files/FileTreePane.tsx'
let s = fs.readFileSync(p, 'utf8')
if (!s.includes("import { Loader2 } from 'lucide-react'")) throw new Error('unexpected tree pane import')
s = s.replace("import { Loader2 } from 'lucide-react'", "import { ChevronRight, Loader2 } from 'lucide-react'")
s = s.replace('{index > 0 ? <span className="text-muted-foreground">/</span> : null}', '{index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}')
fs.writeFileSync(p, s.replaceAll('\r\n', '\n'))
console.log('restored chevron')