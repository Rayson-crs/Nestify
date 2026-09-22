import type { JobRecord, MediaMergeJobStats } from '@nestify/shared'

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function parentName(path: string | null | undefined): string {
  if (!path) return '-'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'dir':
      return '目录'
    case 'video':
      return '视频'
    case 'image':
      return '图片'
    case 'archive':
      return '压缩包'
    case 'audio':
      return '音频'
    case 'document':
      return '文档'
    case 'code':
      return '代码'
    case 'config':
      return '配置'
    case 'spreadsheet':
      return '表格'
    case 'presentation':
      return '演示文稿'
    case 'font':
      return '字体'
    case 'database':
      return '数据库'
    case 'subtitle':
      return '字幕'
    case 'installer':
      return '安装程序'
    case 'file':
      return '文件'
    case 'unknown':
      return '未知'
    default:
      return kind
  }
}

export function opLabel(op: string): string {
  switch (op) {
    case 'rename':
      return '改名'
    case 'move':
      return '移动'
    case 'mkdir':
      return '建目录'
    case 'quarantine':
      return '隔离'
    case 'delete':
      return '删除'
    case 'flatten':
      return '拍平'
    default:
      return op
  }
}

export function jobKindLabel(kind: string): string {
  switch (kind) {
    case 'scan':
      return '扫描'
    case 'duplicates':
      return '重复分析'
    case 'rules-preview':
      return '规则预览'
    case 'media-merge':
      return '媒体合并'
    case 'plan-execute':
      return '执行计划'
    case 'plan-rollback':
      return '回滚'
    case 'library-remove':
      return '移除资料库'
    default:
      return kind
  }
}

export function jobStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default'
  if (status === 'failed') return 'destructive'
  if (status === 'running' || status === 'queued' || status === 'cancelling') return 'secondary'
  return 'outline'
}

export function jobStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '排队',
    running: '运行中',
    paused: '暂停',
    cancelling: '取消中',
    cancelled: '已取消',
    completed: '完成',
    failed: '失败',
  }
  return labels[status] ?? status
}

export function mediaMergePhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    validating: '校验',
    analyzing: '分析',
    preparing: '准备',
    processing: '处理',
    finalizing: '收尾',
  }
  return labels[phase] ?? phase
}

export function mediaMergeStats(job: JobRecord): MediaMergeJobStats | null {
  if (job.kind !== 'media-merge' || !job.stats || typeof job.stats !== 'object') return null
  const stats = job.stats as Partial<MediaMergeJobStats>
  const progress = stats.progress
  const plan = stats.plan
  if (!progress || typeof progress !== 'object') return null
  if (!plan || typeof plan !== 'object') return null
  if (stats.kind !== 'image' && stats.kind !== 'video') return null
  if (!Array.isArray(plan.items) || !plan.summary || typeof plan.summary !== 'object') return null
  if (typeof stats.itemCount !== 'number' || stats.itemCount < 0) return null
  return job.stats as MediaMergeJobStats
}

export function canRollbackJob(job: JobRecord): boolean {
  return (
    job.kind === 'plan-execute' &&
    !job.dryRun &&
    (job.status === 'completed' || job.status === 'failed') &&
    job.opStats.ok > 0
  )
}

export function jobStatsLabel(job: JobRecord): string {
  const mediaMerge = mediaMergeStats(job)
  if (mediaMerge) {
    return [
      `${mediaMerge.kind === 'image' ? '图片' : '视频'} ${mediaMerge.itemCount} 项`,
      mediaMergePhaseLabel(mediaMerge.progress.phase),
      `${Math.round(mediaMerge.progress.percent)}%`,
    ].join(' / ')
  }
  if (job.opStats.total > 0) {
    return `成功 ${job.opStats.ok} / 跳过 ${job.opStats.skipped} / 失败 ${job.opStats.failed}`
  }
  if (job.stats && typeof job.stats === 'object') {
    const stats = job.stats as Record<string, unknown>
    const parts: string[] = []
    if (stats.filesScanned != null) parts.push(`文件 ${String(stats.filesScanned)}`)
    if (stats.dirsScanned != null) parts.push(`目录 ${String(stats.dirsScanned)}`)
    if (stats.errors != null) parts.push(`错误 ${String(stats.errors)}`)
    if (stats.errorSummary && typeof stats.errorSummary === 'object') {
      const summary = Object.entries(stats.errorSummary as Record<string, unknown>)
        .slice(0, 2)
        .map(([key, value]) => `${key} ${String(value)}`)
      if (summary.length > 0) parts.push(summary.join('，'))
    }
    if (stats.total != null && parts.length === 0) parts.push(`总计 ${String(stats.total)}`)
    return parts.join(' / ') || '-'
  }
  return '-'
}

export function scanErrorDetails(job: JobRecord): Array<{
  path: string
  operation: string
  message: string
  code?: string
}> {
  if (!job.stats || typeof job.stats !== 'object') return []
  const details = (job.stats as { errorDetails?: unknown }).errorDetails
  if (!Array.isArray(details)) return []
  return details.filter((item): item is {
    path: string
    operation: string
    message: string
    code?: string
  } => {
    if (!item || typeof item !== 'object') return false
    const value = item as Record<string, unknown>
    return typeof value.path === 'string' && typeof value.operation === 'string' && typeof value.message === 'string'
  })
}

export function formatDuration(startedAt: number | null, finishedAt: number | null): string {
  if (!startedAt || !finishedAt || finishedAt < startedAt) return '-'
  const seconds = (finishedAt - startedAt) / 1000
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
}
