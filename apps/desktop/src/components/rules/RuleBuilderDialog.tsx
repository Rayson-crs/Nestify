import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { MagicParameterInput } from './MagicParameterInput'

const PLACEHOLDERS = ['name', 'stem', 'filename', 'ext', 'parent', 'grandparent', 'ancestor(-1)', 'path', 'relPath', 'size', 'kind', 'is_dir', 'depth', 'children.count', 'children.file_count', 'children.dir_count', 'children.useful_file_count', 'children.video_count', 'children.image_count', 'seq', 'parent_seq', 'date_created', 'date_modified', 'now'] as const
type PlaceholderName = (typeof PLACEHOLDERS)[number]
const PLACEHOLDER_LABELS: Record<PlaceholderName, string> = {
  name: '文件名（不含扩展名）', stem: '文件主干名', filename: '完整文件名', ext: '扩展名', parent: '所在目录', grandparent: '上级目录', 'ancestor(-1)': '当前路径名称', path: '完整路径', relPath: '相对路径', size: '文件大小（字节）', kind: '文件类型', is_dir: '是否为目录', depth: '目录层级', 'children.count': '子项数量', 'children.file_count': '文件数量', 'children.dir_count': '目录数量', 'children.useful_file_count': '有效文件数量', 'children.video_count': '视频数量', 'children.image_count': '图片数量', seq: '当前序号', parent_seq: '目录内序号', date_created: '创建时间', date_modified: '修改时间', now: '当前时间',
}
type SearchField = 'text' | 'phrase' | 'ext' | 'kind' | 'parent' | 'path' | 'size' | 'mtime' | 'depth' | 'date_pattern' | 'name_date' | 'path_date' | 'has' | 'dup'
type Joiner = 'AND' | 'OR'
type SearchPart = { id: number; field: SearchField; operator: string; value: string; joiner: Joiner }
const SEARCH_FIELDS: Array<{ value: SearchField; label: string; hint: string }> = [
  { value: 'text', label: '文件名包含', hint: '输入文件名中的关键词' }, { value: 'phrase', label: '完整短语', hint: '匹配连续文字，可包含空格' }, { value: 'ext', label: '扩展名', hint: '例如 mp4 或 jpg' }, { value: 'kind', label: '类型', hint: 'file、dir、image、video' }, { value: 'parent', label: '所在目录', hint: '目录名称或路径片段' }, { value: 'path', label: '路径包含', hint: '完整路径或相对路径片段' }, { value: 'size', label: '文件大小', hint: '例如 >10MB、1MB..2MB' }, { value: 'mtime', label: '修改时间', hint: '例如 >=2025-01-01' }, { value: 'depth', label: '目录层级', hint: '例如 <=3' }, { value: 'date_pattern', label: '名称或路径中的日期格式', hint: '不知道具体日期时，例如 yyyy-MM-dd' }, { value: 'name_date', label: '名称中的日期格式', hint: '例如 yyyy-mm-dd 或 yyyymmdd' }, { value: 'path_date', label: '路径中的日期格式', hint: '例如 yyyy-mm-dd 或 yyyy' }, { value: 'has', label: '附带内容', hint: 'subtitle' }, { value: 'dup', label: '重复文件', hint: 'true 或 false' },
]
const COMPARISON_FIELDS = new Set<SearchField>(['size', 'mtime', 'depth'])
const quote = (value: string) => /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
const partSyntax = (part: SearchPart) => part.field === 'text'
  ? (/^[a-z_]+:/.test(part.value.trim()) ? part.value.trim() : quote(part.value))
  : part.field === 'phrase'
    ? `"${part.value.replaceAll('"', '\\"')}"`
    : `${part.field}:${COMPARISON_FIELDS.has(part.field) ? part.operator : ''}${quote(part.value)}`
const defaultPart = (id: number): SearchPart => ({ id, field: 'text', operator: '', value: '', joiner: 'AND' })

export function MagicWandInput({ mode, value, onApply, disabled, placeholder, leadingIcon, inputClassName }: { mode: 'search' | 'rename'; value: string; onApply: (value: string) => void; disabled?: boolean; placeholder?: string; leadingIcon?: ReactNode; inputClassName?: string }) {
  const [open, setOpen] = useState(false)
  return <><div className="relative min-w-0 flex-1">{leadingIcon ? <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground">{leadingIcon}</span> : null}<Input value={value} disabled={disabled} placeholder={placeholder} className={inputClassName ?? `${leadingIcon ? 'pl-9 ' : ''}pr-10`} onChange={(event) => onApply(event.target.value)} /><Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-9 w-9" title={mode === 'search' ? '可视化组装搜索条件' : '可视化组装改名模板'} disabled={disabled} onClick={() => setOpen(true)}><Sparkles className="h-4 w-4" /></Button></div><RuleBuilderDialog mode={mode} value={value} open={open} onOpenChange={setOpen} onApply={onApply} /></>
}

export function RuleBuilderDialog({ mode, value, open, onOpenChange, onApply }: { mode: 'search' | 'rename'; value: string; open: boolean; onOpenChange: (open: boolean) => void; onApply: (value: string) => void }) {
  return mode === 'search' ? <SearchRuleBuilder value={value} open={open} onOpenChange={onOpenChange} onApply={onApply} /> : <RenameRuleBuilder value={value} open={open} onOpenChange={onOpenChange} onApply={onApply} />
}

function SearchRuleBuilder({ value, open, onOpenChange, onApply }: { value: string; open: boolean; onOpenChange: (open: boolean) => void; onApply: (value: string) => void }) {
  const [parts, setParts] = useState<SearchPart[]>([defaultPart(1)])
  const [nextId, setNextId] = useState(2)
  const preview = useMemo(() => parts.filter((part) => part.value.trim()).map((part, index) => `${index > 0 ? ` ${part.joiner} ` : ''}${partSyntax(part)}`).join(''), [parts])
  useEffect(() => { if (open) { setParts([defaultPart(1)]); setNextId(2) } }, [open])
  const updatePart = (id: number, patch: Partial<SearchPart>) => setParts((current) => current.map((part) => part.id === id ? { ...part, ...patch } : part))
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />搜索规则组装</DialogTitle><DialogDescription>选择字段、填写条件，系统会生成可直接搜索的语法。</DialogDescription></DialogHeader><div className="space-y-4">{parts.map((part, index) => { const field = SEARCH_FIELDS.find((item) => item.value === part.field) ?? SEARCH_FIELDS[0]!; return <div key={part.id} className="grid gap-2 rounded-md border p-3"><div className="flex items-center gap-2">{index > 0 ? <Select value={part.joiner} onValueChange={(joiner) => updatePart(part.id, { joiner: joiner as Joiner })}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="AND">并且</SelectItem><SelectItem value="OR">或者</SelectItem></SelectContent></Select> : <span className="w-24 text-sm text-muted-foreground">条件 1</span>}<Select value={part.field} onValueChange={(next) => updatePart(part.id, { field: next as SearchField, operator: '' })}><SelectTrigger className="min-w-44 flex-1"><SelectValue /></SelectTrigger><SelectContent>{SEARCH_FIELDS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Button variant="ghost" size="icon" title="删除条件" disabled={parts.length === 1} onClick={() => setParts((current) => current.filter((item) => item.id !== part.id))}><Trash2 className="h-4 w-4" /></Button></div><div className="flex items-center gap-2">{COMPARISON_FIELDS.has(part.field) ? <Select value={part.operator || 'none'} onValueChange={(operator) => updatePart(part.id, { operator: operator === 'none' ? '' : operator })}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">等于</SelectItem>{[['>', '大于'], ['>=', '不少于'], ['<', '小于'], ['<=', '不超过'], ['=', '等于']].map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select> : null}<MagicParameterInput context="search" searchField={part.field} value={part.value} placeholder={field.hint} onChange={(next) => updatePart(part.id, { value: next })} /></div></div> })}<Button variant="outline" size="sm" onClick={() => { setParts((current) => [...current, defaultPart(nextId)]); setNextId((current) => current + 1) }}><Plus className="h-4 w-4" />添加条件</Button><Separator /><div className="space-y-2"><Label>生成结果</Label><Input readOnly value={preview} placeholder="填写条件后显示搜索语法" />{value ? <p className="text-xs text-muted-foreground">当前输入：{value}</p> : null}</div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!preview} onClick={() => { onApply(preview); onOpenChange(false) }}>应用规则</Button></DialogFooter></DialogContent></Dialog>
}

function RenameRuleBuilder({ value, open, onOpenChange, onApply }: { value: string; open: boolean; onOpenChange: (open: boolean) => void; onApply: (value: string) => void }) {
  const [template, setTemplate] = useState('{name}{ext}')
  useEffect(() => { if (open) setTemplate('{name}{ext}') }, [open])
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />改名模板组装</DialogTitle><DialogDescription>所有字段和处理函数都在同一个输入助手中。先插入字段，再选择字符处理函数，函数会按选择顺序作用于模板中的字段。</DialogDescription></DialogHeader><div className="space-y-4"><div className="grid gap-2"><Label>改名模板</Label><MagicParameterInput context="rename-template" value={template} placeholder="例如 {name.trim().upper()}{ext}" onChange={setTemplate} /></div><Separator /><div className="space-y-2"><Label>生成结果</Label><Input readOnly value={template} /><p className="text-xs text-muted-foreground">当前输入：{value || '未设置'}</p></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!template.trim()} onClick={() => { onApply(template); onOpenChange(false) }}>应用模板</Button></DialogFooter></DialogContent></Dialog>
}
