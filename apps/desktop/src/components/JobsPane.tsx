import { Info, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { LibrarySummary, ScanProgress } from '@/lib/ipc'
import {
  formatDuration,
  jobKindLabel,
  jobStatsLabel,
  jobStatusLabel,
  jobStatusVariant,
  mediaMergePhaseLabel,
  mediaMergeStats,
  scanErrorDetails,
} from '@/lib/labels'
import { formatTime } from '@/lib/utils'
import type {
  JobRecord,
  MediaMergeJobStats,
  PlanExecutionJobStats,
} from '@nestify/shared'

export function JobsPane({
  jobs,
  activeScan,
  activeScanJobId,
  libraries,
  selectedJobId,
  loading,
  onRefresh,
  onClear,
  onSelect,
  onResumeMediaMerge,
}: {
  jobs: JobRecord[]
  activeScan: ScanProgress | null
  activeScanJobId: string | null
  libraries: LibrarySummary[]
  selectedJobId: string | null
  loading: boolean
  onRefresh: () => void
  onClear: () => void
  onSelect: (jobId: string) => void
  onResumeMediaMerge: (jobId: string) => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const displayJobs = activeScan && activeScanJobId
    ? jobs.map((job) => (
      job.id === activeScanJobId && job.kind === 'scan'
        ? {
          ...job,
          stats: {
            filesScanned: activeScan.filesScanned,
            dirsScanned: activeScan.dirsScanned,
            errors: activeScan.errors,
          },
        }
        : job
    ))
    : jobs
  const selectedJob = displayJobs.find((job) => job.id === selectedJobId) ?? null
  const selectedScanErrors = selectedJob?.kind === 'scan' ? scanErrorDetails(selectedJob) : []
  const selectedMediaMergeStats = selectedJob ? mediaMergeStats(selectedJob) : null
  const selectedPlanExecutionStats = selectedJob ? planExecutionStats(selectedJob) : null
  const libraryNames = new Map(libraries.map((library) => [library.id, library.name]))

  const openDetails = (jobId: string) => {
    onSelect(jobId)
    setDetailsOpen(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          最近任务
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {!loading && jobs.length > 0 ? <Badge variant="outline">{jobs.length} 条</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={loading || jobs.length === 0}>
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清空任务记录？</AlertDialogTitle>
                <AlertDialogDescription>
                  将删除已结束任务及其逐条执行明细；运行中、排队中、暂停和取消中的任务会保留。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={onClear}
                >
                  清空
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">开始时间</TableHead>
              <TableHead className="w-24">类型</TableHead>
              <TableHead className="w-20">状态</TableHead>
              <TableHead className="w-20">Dry-run</TableHead>
              <TableHead className="w-24">耗时</TableHead>
              <TableHead className="w-28">资料库</TableHead>
              <TableHead>结果</TableHead>
              <TableHead className="w-16 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  暂无任务
                </TableCell>
              </TableRow>
            ) : (
              displayJobs.map((job) => (
                <TableRow key={job.id} data-state={selectedJobId === job.id ? 'selected' : undefined}>
                  <TableCell>{formatTime(job.startedAt ?? job.finishedAt)}</TableCell>
                  <TableCell>{jobKindLabel(job.kind)}</TableCell>
                  <TableCell>
                    <Badge variant={jobStatusVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={job.dryRun ? 'outline' : 'default'}>{job.dryRun ? '是' : '否'}</Badge>
                  </TableCell>
                  <TableCell>{formatDuration(job.startedAt, job.finishedAt)}</TableCell>
                  <TableCell className="max-w-28 truncate" title={job.libraryId ?? ''}>
                    {job.libraryId ? libraryNames.get(job.libraryId) ?? job.libraryId.slice(0, 8) : '-'}
                  </TableCell>
                  <TableCell className="max-w-64 truncate" title={job.error ?? jobStatsLabel(job)}>
                    <span className={job.error ? 'text-destructive' : undefined}>
                      {job.error ?? jobStatsLabel(job)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="查看任务详情"
                      aria-label={`查看任务详情：${jobKindLabel(job.kind)}`}
                      onClick={() => openDetails(job.id)}
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="flex h-[calc(100vh-2rem)] max-h-[760px] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {selectedJob ? jobKindLabel(selectedJob.kind) : '任务详情'}
              {selectedJob ? (
                <Badge variant={jobStatusVariant(selectedJob.status)}>{jobStatusLabel(selectedJob.status)}</Badge>
              ) : null}
              {selectedJob?.dryRun ? <Badge variant="outline">Dry-run</Badge> : null}
            </DialogTitle>
            <DialogDescription className="break-all font-mono text-xs">
              {selectedJob ? selectedJob.id : '正在加载任务详情'}
            </DialogDescription>
          </DialogHeader>

          {selectedJob ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="border-b bg-muted/30 px-5 py-4">
                <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem label="资料库" value={libraryName(selectedJob.libraryId, libraryNames)} />
                  <DetailItem label="开始时间" value={formatTime(selectedJob.startedAt)} />
                  <DetailItem label="完成时间" value={formatTime(selectedJob.finishedAt)} />
                  <DetailItem label="耗时" value={formatDuration(selectedJob.startedAt, selectedJob.finishedAt)} />
                  <DetailItem label="执行模式" value={selectedJob.dryRun ? 'Dry-run' : '实际写盘'} />
                  {selectedJob.kind === 'scan' ? (
                    <>
                      <DetailItem label="扫描文件" value={String(scanStats(selectedJob).filesScanned)} />
                      <DetailItem label="扫描目录" value={String(scanStats(selectedJob).dirsScanned)} />
                      <DetailItem label="扫描错误" value={String(scanStats(selectedJob).errors)} />
                    </>
                  ) : (
                    <>
                      <DetailItem label="执行总数" value={String(selectedJob.opStats.total)} />
                      <DetailItem label="成功 / 跳过 / 失败" value={`${selectedJob.opStats.ok} / ${selectedJob.opStats.skipped} / ${selectedJob.opStats.failed}`} />
                    </>
                  )}
                  <DetailItem label="汇总" value={jobStatsLabel(selectedJob)} />
                </div>
                {selectedJob.error ? (
                  <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <div className="text-xs font-medium text-destructive">任务错误</div>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-destructive">
                      {selectedJob.error}
                    </pre>
                  </div>
                ) : null}
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 p-5">
                  {selectedJob.kind === 'scan' ? (
                    <ScanResultDetails job={selectedJob} errors={selectedScanErrors} />
                  ) : null}
                  {selectedMediaMergeStats ? (
                    <MediaMergeResultDetails
                      stats={selectedMediaMergeStats}
                      canResume={selectedJob.status === 'failed' && selectedMediaMergeStats.progress.resumeSupported}
                      resuming={loading}
                      onResume={() => onResumeMediaMerge(selectedJob.id)}
                    />
                  ) : null}
                  {selectedPlanExecutionStats ? <PlanExecutionResultDetails stats={selectedPlanExecutionStats} /> : null}
                  <ExtraJobStats job={selectedJob} />
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">任务不存在或已被清空</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function libraryName(libraryId: string | null, names: Map<string, string>): string {
  if (!libraryId) return '-'
  return names.get(libraryId) ?? libraryId
}

function planExecutionStats(job: JobRecord): PlanExecutionJobStats | null {
  if (job.kind !== 'plan-execute' || !job.stats || typeof job.stats !== 'object') return null
  const stats = job.stats as Partial<PlanExecutionJobStats>
  if (!stats.plan || typeof stats.plan !== 'object') return null
  if (!stats.progress || typeof stats.progress !== 'object') return null
  return job.stats as PlanExecutionJobStats
}

function PlanExecutionResultDetails({ stats }: { stats: PlanExecutionJobStats }) {
  const progress = stats.progress
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0
  const summary = stats.plan.summary
  const opCounts = [
    ['重命名', summary.rename],
    ['移动', summary.move],
    ['创建目录', summary.mkdir],
    ['隔离', summary.quarantine],
    ['删除', summary.delete],
    ['展平', summary.flatten],
    ['冲突', summary.conflicts],
  ] as const
  return (
    <section className="rounded-md border">
      <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">执行计划详情</div>
      <div className="grid gap-x-6 gap-y-3 px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem label="来源模块" value={executionModuleLabel(stats.module)} />
        <DetailItem label="计划 ID" value={stats.plan.id} mono />
        <DetailItem label="计划创建时间" value={formatTime(stats.plan.createdAt)} />
        <DetailItem label="计划状态" value={stats.plan.status} />
        <DetailItem label="冲突策略" value={stats.plan.collision} />
        <DetailItem label="计划选中数" value={String(summary.selected)} />
        <DetailItem label="实际执行数" value={String(stats.execution?.opCount ?? progress.total)} />
        <DetailItem label="选择模式" value={stats.execution?.selectedOnly ? '手动选择子集' : '计划全部选中项'} />
      </div>
      <div className="border-t px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>执行进度</span>
          <span className="tabular-nums">
            {Math.round(percent)}% · {progress.current} / {progress.total} · 成功 {progress.ok} · 跳过 {progress.skipped} · 失败 {progress.failed}
          </span>
        </div>
        <Progress className="mt-2" value={percent} />
        {progress.path ? (
          <div className="mt-2 break-all font-mono text-xs text-muted-foreground">{progress.path}</div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t px-3 py-3">
        {opCounts.map(([label, count]) => (
          <Badge key={label} variant={label === '冲突' && count > 0 ? 'destructive' : 'outline'}>
            {label} {count}
          </Badge>
        ))}
      </div>
      {stats.errors.length > 0 ? (
        <div className="border-t px-3 py-3">
          <div className="text-xs font-medium text-destructive">失败明细（{stats.errors.length} 条）</div>
          <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs leading-5 text-destructive">
            {stats.errors.join('\n')}
          </pre>
        </div>
      ) : null}
    </section>
  )
}

function MediaMergeResultDetails({
  stats,
  canResume,
  resuming,
  onResume,
}: {
  stats: MediaMergeJobStats
  canResume: boolean
  resuming: boolean
  onResume: () => void
}) {
  const progress = stats.progress
  const checkpoint = stats.checkpoint
  const image = stats.plan.summary.image
  const video = stats.plan.summary.video
  const actualOutput = stats.outputPath ?? progress.outputPath
  const failures = [progress.error, ...stats.plan.summary.warnings].filter(Boolean)
  const imageSettings = stats.plan.image
  const videoSettings = stats.plan.video
  return (
    <section className="rounded-md border">
      <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">媒体合并详情</div>
      <div className="grid gap-x-6 gap-y-3 px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem label="媒体类型" value={stats.kind === 'image' ? '图片' : '视频'} />
        <DetailItem label="素材数量" value={`${stats.itemCount} 项`} />
        <DetailItem label="阶段" value={mediaMergePhaseLabel(progress.phase)} />
        <DetailItem label="进度" value={`${Math.round(progress.percent)}%（${progress.current} / ${progress.total}）`} />
        <DetailItem label="指定输出" value={stats.plan.outputPath} mono />
        <DetailItem label="实际输出" value={actualOutput ?? '-'} mono />
        <DetailItem label="输出目录" value={stats.plan.outputDirectory} mono />
        <DetailItem label="输出文件名" value={stats.plan.outputName} mono />
        {image ? (
          <DetailItem
            label="图片布局"
            value={`${image.layout} · ${image.width} x ${image.height}${image.layout === 'grid' ? ` · ${image.columns} 列` : ''}`}
          />
        ) : (
          <DetailItem
            label="视频时长"
            value={video ? `${video.trimmedDurationSeconds.toFixed(1)} 秒 / 原 ${video.originalDurationSeconds.toFixed(1)} 秒` : '-'}
          />
        )}
        <DetailItem
          label="断点状态"
          value={checkpoint
            ? `${checkpoint.completedStages.length} / ${checkpoint.totalStages} 阶段已保存`
            : progress.resumeSupported ? '可恢复' : '未保存'}
        />
        <DetailItem label="恢复能力" value={progress.resumeSupported ? '支持恢复' : '不支持恢复'} />
      </div>
      <div className="border-t px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>合并进度</span>
          <span className="tabular-nums">{Math.round(progress.percent)}%</span>
        </div>
        <Progress className="mt-2" value={progress.percent} />
      </div>
      {imageSettings ? (
        <div className="grid gap-x-6 gap-y-3 border-t px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="图片格式" value={imageSettings.format.toUpperCase()} />
          <DetailItem label="画布" value={`${imageSettings.width}${imageSettings.height ? ` x ${imageSettings.height}` : ''}`} />
          <DetailItem label="间距" value={`${imageSettings.gap} px`} />
          <DetailItem label="背景" value={imageSettings.background === 'white' ? '白色' : '透明'} />
        </div>
      ) : null}
      {videoSettings ? (
        <div className="grid gap-x-6 gap-y-3 border-t px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="视频格式" value={(videoSettings.format ?? 'auto').toUpperCase()} />
          <DetailItem label="质量" value={videoSettings.quality === 'high' ? '高' : '标准'} />
          <DetailItem label="音频" value={videoSettings.audio === 'mute' ? '静音' : '保留'} />
          <DetailItem label="编码" value={videoSettings.encodingMode ?? 'auto'} />
          <DetailItem label="转场" value={videoSettings.transition?.type === 'crossfade' ? `交叉淡化 ${videoSettings.transition.durationSeconds}s` : '无'} />
          <DetailItem label="画面适配" value={videoSettings.fit ?? 'largest'} />
          <DetailItem label="画布" value={videoSettings.canvasWidth && videoSettings.canvasHeight ? `${videoSettings.canvasWidth} x ${videoSettings.canvasHeight}` : '-'} />
          <DetailItem label="响度归一" value={videoSettings.loudnessNormalize ? '开启' : '关闭'} />
        </div>
      ) : null}
      <div className="border-t px-3 py-3">
        <div className="text-xs font-medium text-muted-foreground">素材清单（{stats.plan.items.length} 项）</div>
        <ul className="mt-2 divide-y rounded-md border">
          {stats.plan.items.map((item) => (
            <li key={item.id} className="space-y-1 px-3 py-2">
              <div className="break-all font-mono text-xs leading-5">{item.path}</div>
              <div className="break-all text-xs text-muted-foreground">
                {formatBytes(item.size)}
                {item.mtime ? ` · ${formatTime(item.mtime)}` : ''}
                {` · 截取起点 ${item.trimStart.toFixed(2)}s`}
                {item.trimEndOffset != null ? ` · 结束偏移 ${item.trimEndOffset.toFixed(2)}s` : ''}
                {item.manualOrder ? ' · 手动排序' : ''}
              </div>
              {item.imageMotion || item.frameFit || item.rotation ? (
                <div className="text-xs text-muted-foreground">
                  {[
                    item.imageMotion ? `动效 ${item.imageMotion}` : null,
                    item.frameFit ? `适配 ${item.frameFit}` : null,
                    item.rotation && item.rotation !== 'none' ? `旋转 ${item.rotation}` : null,
                  ].filter(Boolean).join(' · ')}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {checkpoint ? (
        <div className="grid gap-x-6 gap-y-3 border-t px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="已完成阶段" value={checkpoint.completedStages.join('、') || '无'} />
          <DetailItem label="断点阶段数" value={`${checkpoint.completedStages.length} / ${checkpoint.totalStages}`} />
          <DetailItem label="工作目录" value={checkpoint.workspacePath} mono />
          <DetailItem label="断点更新时间" value={formatTime(checkpoint.updatedAt)} />
        </div>
      ) : null}
      {failures.length > 0 ? (
        <div className="border-t px-3 py-3">
          <div className="text-xs font-medium text-destructive">合并警告 / 失败原因</div>
          <ul className="mt-2 space-y-1">
            {failures.map((failure) => (
              <li key={failure} className="break-all font-mono text-xs leading-5 text-destructive">{failure}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {canResume ? (
        <div className="border-t px-3 py-2">
          <Button size="sm" onClick={onResume} disabled={resuming}>
            {resuming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            恢复任务
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function ScanResultDetails({
  job,
  errors,
}: {
  job: JobRecord
  errors: Array<{ path: string; operation: string; message: string; code?: string }>
}) {
  const stats = scanStats(job)
  const summary = stats.errorSummary && typeof stats.errorSummary === 'object'
    ? Object.entries(stats.errorSummary as Record<string, unknown>)
    : []
  return (
    <section className="rounded-md border">
      <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">扫描统计</div>
      <div className="grid gap-3 px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem label="扫描文件" value={String(stats.filesScanned)} />
        <DetailItem label="扫描目录" value={String(stats.dirsScanned)} />
        <DetailItem label="错误总数" value={String(stats.errors)} destructive={stats.errors > 0} />
        <DetailItem label="错误分类" value={summary.map(([key, value]) => `${key}: ${String(value)}`).join('，') || '-'} />
      </div>
      {errors.length > 0 ? (
        <ScrollArea className="max-h-64 border-t">
          <div className="divide-y">
            {errors.map((error, index) => (
              <div key={`${error.path}:${index}`} className="space-y-1 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{error.operation}</Badge>
                  {error.code ? <Badge variant="outline">{error.code}</Badge> : null}
                </div>
                <div className="break-all font-mono text-foreground">{error.path}</div>
                <div className="break-all text-destructive">{error.message}</div>
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="border-t px-3 py-3 text-sm text-muted-foreground">没有保存具体错误路径。</div>
      )}
      {Number(stats.errors ?? 0) > errors.length ? (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          仅保存前 {errors.length} 条路径；错误总数和分类以统计为准。
        </div>
      ) : null}
    </section>
  )
}

function ExtraJobStats({ job }: { job: JobRecord }) {
  if (job.kind === 'scan' || job.kind === 'media-merge' || planExecutionStats(job)) return null
  if (!job.stats || typeof job.stats !== 'object') return null
  const hiddenKeys = new Set(['errorDetails', 'errorSummary', 'checkpoint', 'interruptedAt'])
  const rows = Object.entries(job.stats as Record<string, unknown>)
    .filter(([key]) => !hiddenKeys.has(key))
    .map(([key, value]) => [key, formatStatsValue(value)] as const)
  if (rows.length === 0) return null
  return (
    <section className="rounded-md border">
      <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">附加统计</div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([key, value]) => (
          <div key={key} className="border-b border-r">
            <dt className="px-3 py-2 text-xs text-muted-foreground">{key}</dt>
            <dd className="px-3 pb-2 break-all font-mono text-xs">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function scanStats(job: JobRecord): {
  filesScanned: number
  dirsScanned: number
  errors: number
  errorSummary?: Record<string, number>
} {
  const stats = job.stats
  if (!stats || typeof stats !== 'object') {
    return { filesScanned: 0, dirsScanned: 0, errors: 0 }
  }
  const value = stats as Record<string, unknown>
  return {
    filesScanned: normalizeCount(value.filesScanned),
    dirsScanned: normalizeCount(value.dirsScanned),
    errors: normalizeCount(value.errors),
    errorSummary: value.errorSummary && typeof value.errorSummary === 'object'
      ? value.errorSummary as Record<string, number>
      : undefined,
  }
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0
}

function executionModuleLabel(module: string): string {
  const labels: Record<string, string> = {
    rules: '规则',
    organize: '整理',
    rename: '重命名',
    duplicates: '查重',
  }
  return labels[module] ?? module
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function formatStatsValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function DetailItem({
  label,
  value,
  destructive = false,
  mono = false,
}: {
  label: string
  value: string
  destructive?: boolean
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 break-words ${mono ? 'font-mono text-xs leading-5' : 'text-sm'} ${destructive ? 'text-destructive' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}
