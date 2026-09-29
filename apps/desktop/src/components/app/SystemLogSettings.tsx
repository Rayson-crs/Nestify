import { useState } from 'react'
import { FileText, FolderOpen, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { callNestify, type NestifySettings } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'

type SystemLogValues = Pick<
  NestifySettings,
  | 'auditLogDirectory'
  | 'auditLogMaxFileMb'
  | 'auditLogRetentionDays'
  | 'auditLogCleanupIntervalHours'
>

export function SystemLogSettings({
  values,
  disabled,
  onChange,
}: {
  values: SystemLogValues
  disabled: boolean
  onChange: (patch: Partial<SystemLogValues>) => void
}) {
  const [opening, setOpening] = useState(false)
  const [message, setMessage] = useState('')

  const pickDirectory = async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked?.path) return
      onChange({ auditLogDirectory: picked.path })
      setMessage('')
    } catch (error) {
      setMessage(`选择日志目录失败：${errorMessage(error)}`)
    }
  }

  const openDirectory = async () => {
    setOpening(true)
    try {
      const target = await callNestify((api) =>
        api.logsPath?.({ directory: values.auditLogDirectory }) ?? Promise.resolve(null))
      if (!target) throw new Error('unsupported')
      if (!target.path) throw new Error('日志目录路径为空')
      await callNestify((api) => api.shellOpen({ path: target.path }))
      setMessage('')
    } catch (error) {
      setMessage(`打开日志目录失败：${errorMessage(error)}`)
    } finally {
      setOpening(false)
    }
  }

  return (
    <section className="grid gap-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileText className="h-4 w-4" />
        系统日志策略
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="system-log-directory">输出目录</Label>
        <Input
          id="system-log-directory"
          readOnly
          disabled={disabled}
          value={values.auditLogDirectory ?? '默认目录'}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={disabled} onClick={() => void pickDirectory()}>
            <FolderOpen className="h-4 w-4" />
            自定义目录
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !values.auditLogDirectory}
            onClick={() => {
              onChange({ auditLogDirectory: null })
              setMessage('')
            }}
          >
            <RotateCcw className="h-4 w-4" />
            使用默认
          </Button>
          <Button type="button" variant="outline" disabled={disabled || opening} onClick={() => void openDirectory()}>
            {opening ? '打开中' : '打开目录'}
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="system-log-max-file">单文件大小（MB）</Label>
          <Input
            id="system-log-max-file"
            type="number"
            min={1}
            max={2048}
            disabled={disabled}
            value={values.auditLogMaxFileMb}
            onChange={(event) => onChange({ auditLogMaxFileMb: Number(event.target.value) || 1 })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="system-log-retention">保留天数</Label>
          <Input
            id="system-log-retention"
            type="number"
            min={1}
            max={3650}
            disabled={disabled}
            value={values.auditLogRetentionDays}
            onChange={(event) => onChange({ auditLogRetentionDays: Number(event.target.value) || 1 })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="system-log-cleanup">清理检查间隔（小时）</Label>
          <Input
            id="system-log-cleanup"
            type="number"
            min={1}
            max={2160}
            disabled={disabled}
            value={values.auditLogCleanupIntervalHours}
            onChange={(event) => onChange({ auditLogCleanupIntervalHours: Number(event.target.value) || 1 })}
          />
        </div>
      </div>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </section>
  )
}
