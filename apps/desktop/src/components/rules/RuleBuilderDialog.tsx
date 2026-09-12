import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  comparisonSearchFields,
  parseSearchQueryToParts,
  searchFieldDefinitions,
  searchPartSyntax,
  type AssistantContext,
} from '@nestify/assistant'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { MagicParameterInput } from './MagicParameterInput'

type Joiner = 'AND' | 'OR'
type SearchPart = { id: number; field: string; operator: string; value: string; joiner: Joiner }

const COMPARISON_FIELDS = comparisonSearchFields()
const defaultPart = (id: number): SearchPart => ({ id, field: 'text', operator: '', value: '', joiner: 'AND' })

export function MagicWandInput({
  mode,
  value,
  onApply,
  disabled,
  placeholder,
  leadingIcon,
  inputClassName,
  context,
}: {
  mode: 'search' | 'rename'
  value: string
  onApply: (value: string) => void
  disabled?: boolean
  placeholder?: string
  leadingIcon?: ReactNode
  inputClassName?: string
  context?: AssistantContext
}) {
  const [open, setOpen] = useState(false)
  const resolvedContext = context ?? (mode === 'rename' ? 'rename-template' : 'search')
  return (
    <>
      <MagicParameterInput
        context={resolvedContext}
        value={value}
        onChange={onApply}
        disabled={disabled}
        placeholder={placeholder}
        leadingIcon={leadingIcon}
        inputClassName={inputClassName}
        onAssemble={() => setOpen(true)}
      />
      <RuleBuilderDialog mode={mode} value={value} open={open} onOpenChange={setOpen} onApply={onApply} />
    </>
  )
}

export function RuleBuilderDialog({
  mode,
  value,
  open,
  onOpenChange,
  onApply,
}: {
  mode: 'search' | 'rename'
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (value: string) => void
}) {
  return mode === 'search'
    ? <SearchRuleBuilder value={value} open={open} onOpenChange={onOpenChange} onApply={onApply} />
    : <RenameRuleBuilder value={value} open={open} onOpenChange={onOpenChange} onApply={onApply} />
}

function SearchRuleBuilder({
  value,
  open,
  onOpenChange,
  onApply,
}: {
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (value: string) => void
}) {
  const fields = searchFieldDefinitions('search')
  const [parts, setParts] = useState<SearchPart[]>([defaultPart(1)])
  const [nextId, setNextId] = useState(2)
  const [dialogContent, setDialogContent] = useState<HTMLDivElement | null>(null)
  const preview = useMemo(
    () => parts.filter((part) => part.value.trim()).map((part, index) => `${index > 0 ? ` ${part.joiner} ` : ''}${searchPartSyntax(part, COMPARISON_FIELDS)}`).join(''),
    [parts],
  )

  useEffect(() => {
    if (!open) return
    const parsed = parseSearchQueryToParts(value)
    if (parsed.length === 0) {
      setParts([defaultPart(1)])
      setNextId(2)
      return
    }
    setParts(parsed.map((part, index) => ({ id: index + 1, ...part })))
    setNextId(parsed.length + 1)
  }, [open, value])

  const updatePart = (id: number, patch: Partial<SearchPart>) => {
    setParts((current) => current.map((part) => part.id === id ? { ...part, ...patch } : part))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={setDialogContent} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />搜索规则组装</DialogTitle>
          <DialogDescription>选择字段、填写条件，系统会生成可直接搜索的语法。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {parts.map((part, index) => {
            const field = fields.find((item) => item.value === part.field) ?? fields[0]!
            return (
              <div key={part.id} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  {index > 0 ? (
                    <Select value={part.joiner} onValueChange={(joiner) => updatePart(part.id, { joiner: joiner as Joiner })}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AND">并且</SelectItem>
                        <SelectItem value="OR">或者</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : <span className="w-24 text-sm text-muted-foreground">条件 1</span>}
                  <Select value={part.field} onValueChange={(next) => updatePart(part.id, { field: next, operator: '' })}>
                    <SelectTrigger className="min-w-44 flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {fields.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" title="删除条件" disabled={parts.length === 1} onClick={() => setParts((current) => current.filter((item) => item.id !== part.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {COMPARISON_FIELDS.has(part.field) ? (
                    <Select value={part.operator || 'none'} onValueChange={(operator) => updatePart(part.id, { operator: operator === 'none' ? '' : operator })}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">等于</SelectItem>
                        {[['>', '大于'], ['>=', '不少于'], ['<', '小于'], ['<=', '不超过'], ['=', '等于']].map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <MagicParameterInput
                    context="search-field"
                    searchField={part.field}
                    value={part.value}
                    placeholder={field.hint}
                    onChange={(next) => updatePart(part.id, { value: next })}
                    portalContainer={dialogContent}
                  />
                </div>
              </div>
            )
          })}
          <Button variant="outline" size="sm" onClick={() => { setParts((current) => [...current, defaultPart(nextId)]); setNextId((current) => current + 1) }}>
            <Plus className="h-4 w-4" />添加条件
          </Button>
          <Separator />
          <div className="space-y-2">
            <Label>生成结果</Label>
            <Input readOnly value={preview} placeholder="填写条件后显示搜索语法" />
            {value ? <p className="text-xs text-muted-foreground">当前输入：{value}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!preview} onClick={() => { onApply(preview); onOpenChange(false) }}>应用规则</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameRuleBuilder({
  value,
  open,
  onOpenChange,
  onApply,
}: {
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (value: string) => void
}) {
  const [template, setTemplate] = useState(value || '{name}{ext}')
  const [dialogContent, setDialogContent] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (open) setTemplate(value.trim() ? value : '{name}{ext}')
  }, [open, value])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={setDialogContent} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />改名模板组装</DialogTitle>
          <DialogDescription>所有字段和处理函数都在同一个输入助手中。先插入字段，再选择字符处理函数，函数会按选择顺序作用于模板中的字段。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>改名模板</Label>
            <MagicParameterInput context="rename-template" value={template} placeholder="例如 {name.trim().upper()}{ext}" onChange={setTemplate} portalContainer={dialogContent} />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>生成结果</Label>
            <Input readOnly value={template} />
            <p className="text-xs text-muted-foreground">当前输入：{value || '未设置'}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!template.trim()} onClick={() => { onApply(template); onOpenChange(false) }}>应用模板</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
