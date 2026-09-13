import { Info, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { LibrarySummary } from '@/lib/ipc'
import { formatDuration, jobKindLabel, jobStatsLabel, jobStatusLabel, jobStatusVariant, opLabel, scanErrorDetails } from '@/lib/labels'
import { formatTime } from '@/lib/utils'
import type { JobOpRecord, JobRecord } from '@nestify/shared'

export function JobsPane({
  jobs,
  libraries,
  selectedJobId,
  ops,
  loading,
  opsLoading,
  onRefresh,
  onSelect,
}: {
  jobs: JobRecord[]
  libraries: LibrarySummary[]
  selectedJobId: string | null
  ops: JobOpRecord[]
  loading: boolean
  opsLoading: boolean
  onRefresh: () => void
  onSelect: (jobId: string) => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null
  const selectedScanErrors = selectedJob?.kind === 'scan' ? scanErrorDetails(selectedJob) : []
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
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
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
              <TableHead>操作统计</TableHead>
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
              jobs.map((job) => (
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
                  <TableCell className="truncate" title={job.libraryId ?? ''}>
                    {job.libraryId ? libraryNames.get(job.libraryId) ?? job.libraryId.slice(0, 8) : '-'}
                  </TableCell>
                  <TableCell className="max-w-64 truncate" title={job.error ?? jobStatsLabel(job)}>
                    <span className={job.error ? 'text-destructive' : undefined}>{job.error ?? jobStatsLabel(job)}</span>
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
        <DialogContent className="h-[calc(100vh-2rem)] max-h-[760px] w-[calc(100vw-2rem)] max-w-6xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              任务详情
              {selectedJob ? <Badge variant={jobStatusVariant(selectedJob.status)}>{jobStatusLabel(selectedJob.status)}</Badge> : null}
            </DialogTitle>
            <DialogDescription className="break-all">
              {selectedJob ? `${jobKindLabel(selectedJob.kind)} · ${selectedJob.id}` : '正在加载任务详情'}
            </DialogDescription>
          </DialogHeader>
          {selectedJob ? (
            <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="资料库" value={selectedJob.libraryId ? libraryNames.get(selectedJob.libraryId) ?? selectedJob.libraryId : '-'} />
                <DetailItem label="开始时间" value={formatTime(selectedJob.startedAt)} />
                <DetailItem label="完成时间" value={formatTime(selectedJob.finishedAt)} />
                <DetailItem label="耗时" value={formatDuration(selectedJob.startedAt, selectedJob.finishedAt)} />
                <DetailItem label="Dry-run" value={selectedJob.dryRun ? '是' : '否'} />
                <DetailItem label="操作总数" value={String(selectedJob.opStats.total)} />
                <DetailItem label="成功 / 跳过 / 失败" value={`${selectedJob.opStats.ok} / ${selectedJob.opStats.skipped} / ${selectedJob.opStats.failed}`} />
                <DetailItem label="结果" value={selectedJob.error ?? jobStatsLabel(selectedJob)} destructive={Boolean(selectedJob.error)} />
              </div>
              {selectedJob.kind === 'scan' && selectedJob.stats && typeof selectedJob.stats === 'object' ? (
                <ScanResultDetails job={selectedJob} errors={selectedScanErrors} />
              ) : null}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
                <div className="border-b px-3 py-2 text-sm font-medium">
                  执行明细
                  {opsLoading ? <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" /> : null}
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  {ops.length === 0 && !opsLoading ? (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">该任务没有逐条执行记录</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14">#</TableHead>
                          <TableHead className="w-20">操作</TableHead>
                          <TableHead className="w-20">状态</TableHead>
                          <TableHead>原路径</TableHead>
                          <TableHead>目标路径</TableHead>
                          <TableHead className="w-64">原因 / 错误</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ops.map((op) => <JobOpRow key={`${op.jobId}:${op.seq}`} op={op} />)}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ScanResultDetails({ job, errors }: { job: JobRecord; errors: Array<{ path: string; operation: string; message: string; code?: string }> }) {
  const stats = job.stats as Record<string, unknown>
  const summary = stats.errorSummary && typeof stats.errorSummary === 'object'
    ? Object.entries(stats.errorSummary as Record<string, unknown>)
    : []
  if (errors.length === 0 && summary.length === 0) return null
  return (
    <div className="min-h-0 rounded-md border">
      <div className="border-b px-3 py-2 text-sm font-medium">扫描错误详情</div>
      <div className="grid gap-3 px-3 py-3 text-sm sm:grid-cols-2">
        <DetailItem label="错误总数" value={String(stats.errors ?? 0)} destructive />
        <DetailItem label="错误分类" value={summary.map(([key, value]) => `${key}: ${String(value)}`).join('，') || '-'} />
      </div>
      {errors.length > 0 ? (
        <ScrollArea className="max-h-48 border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">操作</TableHead>
                <TableHead>路径</TableHead>
                <TableHead className="w-24">错误码</TableHead>
                <TableHead>系统消息</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errors.map((error, index) => (
                <TableRow key={`${error.path}:${index}`}>
                  <TableCell>{error.operation}</TableCell>
                  <TableCell className="max-w-80 truncate" title={error.path}>{error.path}</TableCell>
                  <TableCell>{error.code ?? '-'}</TableCell>
                  <TableCell className="max-w-96 truncate" title={error.message}>{error.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      ) : (
        <div className="border-t px-3 py-3 text-sm text-muted-foreground">没有保存具体错误路径。</div>
      )}
      {Number(stats.errors ?? 0) > errors.length ? (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          仅显示已保存的前 {errors.length} 条路径；错误总数和分类以统计为准。
        </div>
      ) : null}
    </div>
  )
}

function DetailItem({ label, value, destructive = false }: { label: string; value: string; destructive?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate ${destructive ? 'text-destructive' : ''}`} title={value}>{value}</div>
    </div>
  )
}

function JobOpRow({ op }: { op: JobOpRecord }) {
  const reason = op.error ? `${op.reason ? `${op.reason}；` : ''}${op.error}` : op.reason || '-'
  return (
    <TableRow>
      <TableCell>{op.seq + 1}</TableCell>
      <TableCell>{opLabel(op.op)}</TableCell>
      <TableCell>
        <Badge variant={op.status === 'failed' ? 'destructive' : op.status === 'ok' ? 'default' : 'outline'}>{op.status}</Badge>
      </TableCell>
      <TableCell className="max-w-72 truncate" title={op.from}>{op.from}</TableCell>
      <TableCell className="max-w-72 truncate" title={op.to ?? ''}>{op.to ?? '-'}</TableCell>
      <TableCell className={op.error ? 'text-destructive' : undefined} title={reason}>{reason}</TableCell>
    </TableRow>
  )
}
