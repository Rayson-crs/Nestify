import { useEffect, useId, useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { RuleDefinitionSummary } from '@/lib/ipc'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function serializeJson(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

export function parseUnknownJson(text: string): ParseResult<unknown> {
  if (text.trim() === '') return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'JSON 格式错误',
    }
  }
}

export function parseExtractJson(text: string): ParseResult<RuleDefinitionSummary['extract']> {
  const result = parseUnknownJson(text)
  if (!result.ok) return result
  if (result.value === undefined) return { ok: true, value: undefined }
  if (typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) {
    return { ok: false, error: '必须是 JSON 对象，且格式为 { 变量: { from: "..." } }' }
  }

  for (const [key, extractor] of Object.entries(result.value)) {
    if (
      typeof extractor !== 'object' ||
      extractor === null ||
      Array.isArray(extractor) ||
      typeof (extractor as { from?: unknown }).from !== 'string'
    ) {
      return {
        ok: false,
        error: `变量 "${key}" 必须是 { from: "..." } 格式`,
      }
    }
  }
  return { ok: true, value: result.value as RuleDefinitionSummary['extract'] }
}

export function RuleSetJsonField({
  label,
  value,
  placeholder,
  disabled,
  parse,
  onCommit,
}: {
  label: string
  value: unknown
  placeholder: string
  disabled?: boolean
  parse: (text: string) => ParseResult<unknown>
  onCommit: (value: unknown) => void
}) {
  const textareaId = useId()
  const serialized = useMemo(() => serializeJson(value), [value])
  const [text, setText] = useState(serialized)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setText(serialized)
  }, [serialized, dirty])

  return (
    <div className="grid gap-2">
      <Label htmlFor={textareaId}>{label}</Label>
      <Textarea
        id={textareaId}
        value={text}
        disabled={disabled}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setText(event.target.value)
          setDirty(true)
          if (error) setError(null)
        }}
        onBlur={() => {
          const result = parse(text)
          if (!result.ok) {
            setError(result.error)
            return
          }
          setError(null)
          setDirty(false)
          onCommit(result.value)
        }}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
