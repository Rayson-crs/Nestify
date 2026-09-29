import { useEffect, useState } from 'react'
import { ArrowLeft, Eye, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { MagicParameterInput } from './MagicParameterInput'

export type RenameRuleGroup = {
  id: string
  filter: string
  template: string
}

type GroupDialogState =
  | { mode: 'manage' }
  | { mode: 'create' }
  | { mode: 'edit'; group: RenameRuleGroup }
  | { mode: 'view'; group: RenameRuleGroup }

export function createRenameRuleGroup(partial?: Partial<RenameRuleGroup>): RenameRuleGroup {
  return {
    id: partial?.id ?? `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    filter: partial?.filter ?? '',
    template: partial?.template ?? '{name}{ext}',
  }
}

function filterSummary(filter: string): string {
  return filter.trim() || '范围内其余项'
}

export function RenameGroupsEditor({
  groups,
  onChange,
  disabled,
  previewName,
}: {
  groups: RenameRuleGroup[]
  onChange: (groups: RenameRuleGroup[]) => void
  disabled?: boolean
  previewName?: string
}) {
  const [dialog, setDialog] = useState<GroupDialogState | null>(null)

  const saveGroup = (group: RenameRuleGroup) => {
    if (dialog?.mode === 'edit') {
      onChange(groups.map((item) => (item.id === group.id ? group : item)))
    } else {
      onChange([...groups, group])
    }
    setDialog({ mode: 'manage' })
  }

  const deleteGroup = (id: string) => {
    if (groups.length <= 1) return
    onChange(groups.filter((item) => item.id !== id))
  }

  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-sm font-medium">改名规则组</span>
          <Badge variant="secondary" className="shrink-0">
            {groups.length} 组
          </Badge>
          <span className="truncate text-xs text-muted-foreground">规则组之间是 OR；同一项命中多组时按顺序优先</span>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setDialog({ mode: 'manage' })}>
          <Settings2 className="h-3.5 w-3.5" />
          设置规则
        </Button>
      </div>

      <RenameGroupDialog
        state={dialog}
        groups={groups}
        disabled={disabled}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        onCreate={() => setDialog({ mode: 'create' })}
        onView={(group) => setDialog({ mode: 'view', group })}
        onEdit={(group) => setDialog({ mode: 'edit', group })}
        onDelete={deleteGroup}
        onBack={() => setDialog({ mode: 'manage' })}
        onSave={saveGroup}
        previewName={previewName}
      />
    </>
  )
}

function RenameGroupDialog({
  state,
  groups,
  disabled,
  onOpenChange,
  onCreate,
  onView,
  onEdit,
  onDelete,
  onBack,
  onSave,
  previewName,
}: {
  state: GroupDialogState | null
  groups: RenameRuleGroup[]
  disabled?: boolean
  onOpenChange: (open: boolean) => void
  onCreate: () => void
  onView: (group: RenameRuleGroup) => void
  onEdit: (group: RenameRuleGroup) => void
  onDelete: (id: string) => void
  onBack: () => void
  onSave: (group: RenameRuleGroup) => void
  previewName?: string
}) {
  const open = state !== null
  const isManage = state?.mode === 'manage'
  const readOnly = state?.mode === 'view'
  const [filter, setFilter] = useState('')
  const [template, setTemplate] = useState('{name}{ext}')
  const [dialogContent, setDialogContent] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!state || state.mode === 'manage') return
    if (state.mode === 'create') {
      setFilter('')
      setTemplate('{name}{ext}')
      return
    }
    setFilter(state.group.filter)
    setTemplate(state.group.template)
  }, [state])

  const title = isManage
    ? '改名规则组设置'
    : state?.mode === 'view'
      ? '查看规则'
      : state?.mode === 'edit'
        ? '编辑规则'
        : '新增规则组'
  const description = isManage
    ? '多组条件会合并为 OR，且都受第二步搜索范围限制；同一项命中多组时按规则组顺序优先。'
    : readOnly
      ? '回显当前规则组的匹配条件和改名模板。'
      : '匹配条件用来筛选这一组要改的文件或目录，例如 kind:dir；模板决定新名字。'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={setDialogContent}
        className="w-[calc(100vw-2rem)] max-w-2xl min-w-0"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {!isManage ? (
              <Button type="button" variant="ghost" size="icon" className="-ml-2 h-7 w-7" title="返回规则组列表" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {isManage ? (
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-xs text-muted-foreground">共 {groups.length} 组；组内条件支持 AND、OR、NOT 和括号</span>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onCreate}>
                <Plus className="h-4 w-4" />
                添加规则组
              </Button>
            </div>
            <div className="max-h-[min(28rem,55vh)] min-h-0 min-w-0 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {groups.map((group, index) => (
                <div key={group.id} className="flex min-w-0 flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-medium">
                      规则组 {index + 1}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {index === 0 ? '优先匹配' : '处理前面未命中的项'}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={filterSummary(group.filter)}>
                      匹配：{filterSummary(group.filter)}
                    </div>
                    <div className="min-w-0 text-xs" title={group.template}>
                      模板：<code className="break-all rounded bg-muted px-1 py-0.5">{group.template || '未设置'}</code>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onView(group)}>
                      <Eye className="h-3.5 w-3.5" />
                      查看
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onEdit(group)}>
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="删除规则组"
                      disabled={disabled || groups.length === 1}
                      onClick={() => onDelete(group.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : readOnly ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">匹配条件</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{filterSummary(filter)}</div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">改名模板</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <code>{template || '未设置'}</code>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">匹配条件（留空 = 其余文件或目录）</Label>
              <MagicParameterInput
                context="rename-group-filter"
                value={filter}
                onChange={setFilter}
                placeholder="例：kind:dir AND dir_count:>=1（留空匹配其余项）"
                disabled={disabled}
                portalContainer={dialogContent}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">改名模板</Label>
              <MagicParameterInput
                context="rename-template"
                value={template}
                onChange={setTemplate}
                placeholder="{name}{ext}"
                disabled={disabled}
                portalContainer={dialogContent}
                previewName={previewName}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isManage || readOnly ? '关闭' : '取消'}
          </Button>
          {!isManage && !readOnly ? (
            <Button
              disabled={disabled || !template.trim() || !state}
              onClick={() => {
                if (!state || state.mode === 'manage' || state.mode === 'view') return
                const next =
                  state.mode === 'edit'
                    ? { ...state.group, filter: filter.trim(), template: template.trim() }
                    : createRenameRuleGroup({ filter: filter.trim(), template: template.trim() })
                onSave(next)
              }}
            >
              保存并返回
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
