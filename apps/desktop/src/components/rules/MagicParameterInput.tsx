import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  applyItemParams,
  describeAssistantItem,
  insertChainAtCursor,
  insertRuleChainAtCursor,
  insertSearchToken,
  itemsForContext,
  previewRenameTemplate,
  resolveInsertValue,
  SAMPLE_RENAME_FILE,
  type AssistantContext,
  type AssistantItem,
} from '@nestify/assistant'
import { Braces, ChevronDown, ChevronRight, HelpCircle, FunctionSquare, GitBranch, Search, Sparkles, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const RECENT_KEY = 'nestify.assistant.recent'

export function MagicParameterInput({
  value,
  onChange,
  placeholder,
  context,
  searchField,
  disabled,
  readOnly,
  inputRef: externalInputRef,
  inputClassName,
  onKeyDown,
  onOpenChange,
  leadingIcon,
  compact = true,
  portalContainer,
  previewName,
  onAssemble,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  context: AssistantContext
  searchField?: string
  disabled?: boolean
  readOnly?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  inputClassName?: string
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  onOpenChange?: (open: boolean) => void
  leadingIcon?: React.ReactNode
  compact?: boolean
  portalContainer?: HTMLElement | null
  previewName?: string
  onAssemble?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const [pending, setPending] = useState<AssistantItem | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [recentIds, setRecentIds] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef({ start: value.length, end: value.length })
  const resolvedContext = context === 'search-field' || (context === 'search' && searchField && searchField !== 'text')
    ? 'search-field'
    : context
  const items = useMemo(() => itemsForContext(resolvedContext, searchField), [resolvedContext, searchField])
  const operatorDisabled = resolvedContext === 'search-field'
  const recentItems = useMemo(
    () => recentIds.map((id) => items.find((item) => item.id === id)).filter((item): item is AssistantItem => Boolean(item)),
    [items, recentIds],
  )
  const groups = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    return items.filter((item) => !term || `${item.label} ${item.value} ${item.group}`.toLowerCase().includes(term)).reduce<Record<string, AssistantItem[]>>((result, item) => {
      ;(result[item.group] ??= []).push(item)
      return result
    }, {})
  }, [items, keyword])

  useEffect(() => {
    if (open && keyword.trim()) setExpanded(Object.keys(groups))
  }, [groups, keyword, open])

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
      if (Array.isArray(stored)) setRecentIds(stored.filter((id): id is string => typeof id === 'string').slice(0, 8))
    } catch {
      setRecentIds([])
    }
  }, [])

  const updateSelection = (input: HTMLInputElement) => {
    selectionRef.current = {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    }
  }

  const remember = (item: AssistantItem) => {
    const next = [item.id, ...recentIds.filter((id) => id !== item.id)].slice(0, 8)
    setRecentIds(next)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  }

  const insertResolved = (item: AssistantItem, insertValue: string) => {
    const { start, end } = selectionRef.current
    const chain = (item.kind === 'chain' || item.kind === 'parameterized-chain') && insertValue.startsWith('.')
    const ruleChain = item.engine === 'rule-chain'
    const result = chain
      ? ruleChain
        ? insertRuleChainAtCursor(value, item.value, start)
        : insertChainAtCursor(value, insertValue, start)
      : resolvedContext === 'rename-template'
        ? { value: `${value.slice(0, start)}${insertValue}${value.slice(end)}`, caret: start + insertValue.length }
        : insertSearchToken(value, start, end, insertValue, item.kind === 'operator')
    onChange(result.value)
    remember(item)
    setKeyword('')
    setExpanded([])
    setPending(null)
    selectionRef.current = { start: result.caret, end: result.caret }
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(result.caret, result.caret)
    }, 0)
  }

  const insert = (item: AssistantItem) => {
    if (operatorDisabled && item.kind === 'operator') return
    if (item.params?.length) {
      setPending(item)
      setParamValues(Object.fromEntries(item.params.map((param) => [param.name, param.defaultValue ?? ''])))
      return
    }
    insertResolved(item, resolveInsertValue(item, resolvedContext, searchField))
  }

  const confirmParams = () => {
    if (!pending) return
    const parameterized = applyItemParams(pending, paramValues)
    const nextItem = { ...pending, value: parameterized }
    insertResolved(nextItem, resolveInsertValue(nextItem, resolvedContext, searchField))
  }

  const toggleGroup = (group: string) => {
    setExpanded((current) => current.includes(group) ? current.filter((item) => item !== group) : [...current, group])
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setKeyword('')
      setExpanded([])
      setPending(null)
    }
    onOpenChange?.(nextOpen)
  }

  const preview = pending
    ? resolveInsertValue({ ...pending, value: applyItemParams(pending, paramValues) }, resolvedContext, searchField)
    : value
  const trialName = previewName?.trim() || (resolvedContext === 'rename-template' ? SAMPLE_RENAME_FILE : '')
  const trialAfter = resolvedContext === 'rename-template' ? previewRenameTemplate(preview, trialName) : ''

  return (
    <Popover open={open} modal={false} onOpenChange={handleOpenChange}>
      <div className="relative min-w-0 flex-1">
        {leadingIcon ? <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-500">{leadingIcon}</span> : null}
        <Input
          ref={(node) => {
            inputRef.current = node
            if (typeof externalInputRef === 'function') externalInputRef(node)
            else if (externalInputRef) externalInputRef.current = node
          }}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          className={inputClassName ?? 'pr-9'}
          onSelect={(event) => updateSelection(event.currentTarget)}
          onClick={(event) => updateSelection(event.currentTarget)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            onChange(event.target.value)
            updateSelection(event.target)
          }}
        />
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center ${compact ? 'h-8 w-8' : 'h-10 w-10'}`} title="打开输入助手" disabled={disabled}>
            <WandSparkles className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        side="bottom"
        align="end"
        avoidCollisions
        collisionPadding={8}
        portalContainer={portalContainer}
        className="z-[110] flex max-h-[min(28rem,var(--radix-popper-available-height,70vh))] w-[min(24rem,calc(100vw-1rem))] min-h-0 flex-col overflow-hidden p-0"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
          <div className="flex shrink-0 items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4" />输入助手
            <span className="ml-auto text-xs font-normal text-muted-foreground">可连续选择并组合</span>
          </div>
          {onAssemble ? (
            <Button type="button" variant="outline" size="sm" className="shrink-0 justify-start" onClick={() => { setOpen(false); onAssemble() }}>
              按字段组装
            </Button>
          ) : null}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input autoFocus value={keyword} className="pl-8" placeholder="搜索分类、函数或动态值" onChange={(event) => setKeyword(event.target.value)} />
          </div>
          {pending ? (
            <div className="shrink-0 space-y-2 rounded-md border p-2">
              <div className="flex items-center gap-1 text-sm font-medium">
                <span className="min-w-0 truncate">{pending.label}</span>
                <CatalogHelpButton item={pending} />
              </div>
              {pending.params?.map((param) => (
                <div key={param.name} className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">{param.label}</Label>
                  <Input
                    value={paramValues[param.name] ?? ''}
                    placeholder={param.placeholder ?? param.defaultValue}
                    onChange={(event) => setParamValues((current) => ({ ...current, [param.name]: event.target.value }))}
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={confirmParams}>插入</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>取消</Button>
              </div>
            </div>
          ) : null}
          <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
            <div className="space-y-1 pb-1">
              {recentItems.length > 0 && !keyword.trim() ? (
                <div className="rounded-md border">
                  <div className="px-2.5 py-2 text-sm font-medium">最近使用</div>
                  <div className="border-t p-1">
                    {recentItems.map((item) => (
                      <CatalogRow key={`recent-${item.id}`} item={item} context={resolvedContext} searchField={searchField} operatorDisabled={operatorDisabled} onInsert={insert} />
                    ))}
                  </div>
                </div>
              ) : null}
              {Object.entries(groups).map(([group, groupItems]) => {
                const isExpanded = keyword.trim().length > 0 || expanded.includes(group)
                return (
                  <div key={group} className="rounded-md border">
                    <button type="button" className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium hover:bg-accent" onClick={() => toggleGroup(group)}>
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="flex-1">{group}</span>
                      <span className="text-xs text-muted-foreground">{groupItems.length}</span>
                    </button>
                    {isExpanded ? (
                      <div className="border-t p-1">
                        {groupItems.map((item) => (
                          <CatalogRow key={item.id} item={item} context={resolvedContext} searchField={searchField} operatorDisabled={operatorDisabled} onInsert={insert} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {Object.keys(groups).length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">没有匹配的内容</p> : null}
            </div>
          </div>
          <div className="shrink-0 border-t pt-2 text-xs text-muted-foreground">
            <div className="truncate">插入：<code>{preview || '空'}</code></div>
            {trialAfter ? <div className="truncate">试算：{trialName} → {trialAfter}</div> : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CatalogRow({
  item,
  context,
  searchField,
  operatorDisabled,
  onInsert,
}: {
  item: AssistantItem
  context: AssistantContext
  searchField?: string
  operatorDisabled: boolean
  onInsert: (item: AssistantItem) => void
}) {
  const disabled = operatorDisabled && item.kind === 'operator'
  const icon = item.kind === 'chain' || item.kind === 'parameterized-chain'
    ? <FunctionSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
    : item.kind === 'operator'
      ? <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
      : context === 'rename-template'
        ? <Braces className="h-4 w-4 shrink-0 text-muted-foreground" />
        : <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
  return (
    <div className={`flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-sm ${disabled ? 'opacity-40' : 'hover:bg-accent'}`}>
      <button
        type="button"
        disabled={disabled}
        title={disabled ? '组合条件请使用每行之间的「并且/或者」下拉' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-transparent disabled:cursor-not-allowed"
        onClick={() => onInsert(item)}
      >
        {icon}
        <span className="min-w-0 truncate">{item.label}</span>
      </button>
      <CatalogHelpButton item={item} />
      <button
        type="button"
        disabled={disabled}
        className="max-w-44 shrink-0 truncate text-left disabled:cursor-not-allowed"
        onClick={() => onInsert(item)}
      >
        <code className="text-xs text-muted-foreground">{resolveInsertValue(item, context, searchField)}</code>
      </button>
    </div>
  )
}

function CatalogHelpButton({ item }: { item: AssistantItem }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hideTimer = useRef<number>(0)
  const info = useMemo(() => describeAssistantItem(item), [item])

  const clearHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = 0
  }

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 288
    const left = rect.right + 8 + width > window.innerWidth ? Math.max(8, rect.left - width - 8) : rect.right + 8
    const top = Math.min(Math.max(8, rect.top), window.innerHeight - 168)
    clearHide()
    setCoords({ top, left })
    setOpen(true)
  }

  const hide = () => {
    clearHide()
    hideTimer.current = window.setTimeout(() => setOpen(false), 80)
  }

  useEffect(() => () => clearHide(), [])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`${item.label}的用法说明`}
        title="查看用法和效果"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[180] w-[min(18rem,calc(100vw-1rem))] rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{ top: coords.top, left: coords.left }}
        >
          <div className="font-medium">{item.label}</div>
          <div className="mt-1 leading-5 text-muted-foreground">用法：{info.help}</div>
          <div className="mt-1 leading-5 text-muted-foreground">效果：{info.example}</div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
