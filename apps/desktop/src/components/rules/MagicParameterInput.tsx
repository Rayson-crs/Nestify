import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, ChevronDown, ChevronRight, FunctionSquare, GitBranch, Search, Sparkles, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { itemsForContext, type AssistantContext, type AssistantItem } from './input-assistant-catalog'

function insertChain(value: string, chain: string): string {
  const match = value.match(/\{([^{}]*)\}/)
  if (!match || match.index == null) return `{name${chain}}${value}`
  const expression = match[1] ?? 'name'
  return `${value.slice(0, match.index)}{${expression}${chain}}${value.slice(match.index + match[0].length)}`
}

function insertSearchToken(
  value: string,
  start: number,
  end: number,
  token: string,
  operator: boolean,
): { value: string; caret: number } {
  const before = value.slice(0, start)
  const after = value.slice(end)
  if (operator) {
    const left = before.replace(/\s+$/, '')
    const right = after.replace(/^\s+/, '')
    const leftPart = left ? `${left} ${token}` : token
    const next = right ? `${leftPart} ${right}` : leftPart
    return { value: next, caret: leftPart.length }
  }

  const leftSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const rightSpace = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
  const next = `${before}${leftSpace}${token}${rightSpace}${after}`
  return { value: next, caret: before.length + leftSpace.length + token.length }
}

/**
 * 统一目录下，条目的插入形式按目标输入框适配：
 * - 自由搜索框（text 模式）与查重范围规则：字段专属条目带 `field:value` 前缀插入
 * - 已选字段的组装行（searchField 指定）：插裸值，字段由行首下拉决定
 * - 改名模板：目录原样插入（链式函数另走 insertChain）
 */
function resolveInsertValue(item: AssistantItem, context: AssistantContext, searchField?: string): string {
  if (context === 'rename-template') return item.value
  if (context === 'search' && searchField && searchField !== 'text') return item.value
  const belongsToField = item.searchFields?.find((field) => field !== 'text')
  if (belongsToField && item.kind !== 'operator') return `${belongsToField}:${item.value}`
  return item.value
}

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
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef({ start: value.length, end: value.length })
  const items = useMemo(() => itemsForContext(context, searchField), [context, searchField])
  /** 字段限定行（如组装 Dialog 里已选「修改时间」的行）里，AND/OR 无意义——组合由行间下拉承担。 */
  const operatorDisabled = context === 'search' && !!searchField && searchField !== 'text'
  const groups = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    return items.filter((item) => !term || `${item.label} ${item.value} ${item.group}`.toLowerCase().includes(term)).reduce<Record<string, AssistantItem[]>>((result, item) => {
      ;(result[item.group] ??= []).push(item)
      return result
    }, {})
  }, [items, keyword])

  useEffect(() => {
    if (open && keyword.trim()) {
      setExpanded(Object.keys(groups))
    }
  }, [groups, keyword, open])

  useEffect(() => {
    if (!open) return
    const firstGroups = Object.keys(groups).slice(0, 2)
    setExpanded((current) => current.length > 0 ? current : firstGroups)
  }, [groups, open])

  const updateSelection = (input: HTMLInputElement) => {
    selectionRef.current = {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    }
  }

  const insert = (item: AssistantItem) => {
    const { start, end } = selectionRef.current
    const before = value.slice(0, start)
    const after = value.slice(end)
    const insertValue = resolveInsertValue(item, context, searchField)
    const keepOpen = context === 'search' || context === 'duplicate-filter' || context === 'rename-template'
    if (keepOpen && item.kind !== 'chain') {
      const result = context === 'rename-template'
        ? { value: `${before}${insertValue}${after}`, caret: start + insertValue.length }
        : insertSearchToken(value, start, end, insertValue, item.kind === 'operator')
      onChange(result.value)
      setKeyword('')
      setExpanded([])
      selectionRef.current = { start: result.caret, end: result.caret }
      return
    }
    const next = item.kind === 'chain'
      ? insertChain(`${before}${after}`, item.value)
      : `${before}${insertValue}${after}`
    onChange(next)
    if (keepOpen) {
      setKeyword('')
      setExpanded([])
      selectionRef.current = { start: next.length, end: next.length }
      return
    }
    setOpen(false)
    setKeyword('')
    setExpanded([])
    const caret = item.kind === 'chain' ? next.length : start + insertValue.length
    selectionRef.current = { start: caret, end: caret }
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(caret, caret)
    }, 0)
  }

  const toggleGroup = (group: string) => {
    setExpanded((current) => current.includes(group) ? current.filter((item) => item !== group) : [...current, group])
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

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
        align="end"
        collisionPadding={12}
        portalContainer={portalContainer}
        className="z-[110] flex h-[min(34rem,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[min(24rem,calc(100vw-1rem))] flex-col gap-3 overflow-hidden p-3"
      >
        <div className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" />输入助手
          <span className="ml-auto text-xs font-normal text-muted-foreground">可连续选择并组合多个条件</span>
        </div>
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input autoFocus value={keyword} className="pl-8" placeholder="搜索分类、函数或动态值" onChange={(event) => setKeyword(event.target.value)} />
        </div>
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
          <div className="space-y-1 pb-1">
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
                        <button key={`${group}-${item.value}`} type="button" disabled={operatorDisabled && item.kind === 'operator'} title={operatorDisabled && item.kind === 'operator' ? '组合条件请使用每行之间的「并且/或者」下拉' : undefined} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" onClick={() => insert(item)}>
                          {item.kind === 'chain' ? <FunctionSquare className="h-4 w-4 shrink-0 text-muted-foreground" /> : item.kind === 'operator' ? <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" /> : context === 'search' ? <Search className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Braces className="h-4 w-4 shrink-0 text-muted-foreground" />}
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          <code className="max-w-44 truncate text-xs text-muted-foreground">{resolveInsertValue(item, context, searchField)}</code>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {Object.keys(groups).length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">没有匹配的内容</p> : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
