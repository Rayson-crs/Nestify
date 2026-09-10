import { History, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { LibrarySummary } from '@/lib/ipc'
import { canRollbackJob, formatDuration, jobKindLabel, jobStatsLabel, jobStatusLabel, jobStatusVariant, opLabel } from '@/lib/labels'
import { formatTime } from '@/lib/utils'
import type { JobOpRecord, JobRecord } from '@nestify/shared'

export function JobsPane({
  jobs,
  libraries,
  selectedJobId,
  ops,
  loading,
  opsLoading,
  busyJobId,
  onRefresh,
  onSelect,
  onRollback,
}: {
  jobs: JobRecord[]
  libraries: LibrarySummary[]
  selectedJobId: string | null
  ops: JobOpRecord[]
  loading: boolean
  opsLoading: boolean
  busyJobId: string | null
  onRefresh: () => void
  onSelect: (jobId: string) => void
  onRollback: (job: JobRecord) => void
}) {
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null
  const libraryNames = new Map(libraries.map((library) => [library.id, library.name]))

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,38%)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-b">
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
                <TableHead className="w-24">回滚</TableHead>
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
                  <TableRow
                    key={job.id}
                    data-state={selectedJobId === job.id ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => onSelect(job.id)}
                  >
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
                      <span className={job.error ? 'text-destructive' : undefined}>
                        {job.error ?? jobStatsLabel(job)}
                      </span>
                    </TableCell>
                    <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canRollbackJob(job) || busyJobId === job.id}
                          title={canRollbackJob(job) ? '撤销该任务已经成功执行的文件操作' : '只有成功执行且非 Dry-run 任务可回滚'}
                        onClick={(event) => {
                          event.stopPropagation()
                          onRollback(job)
                        }}
                      >
                        {busyJobId === job.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
                        回滚
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <div className="min-w-0 truncate">
            {selectedJob
              ? `${jobKindLabel(selectedJob.kind)} · ${selectedJob.id}`
              : '选择任务查看步骤'}
            {opsLoading ? <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" /> : null}
          </div>
          {selectedJob ? <Badge variant={jobStatusVariant(selectedJob.status)}>{jobStatusLabel(selectedJob.status)}</Badge> : null}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {ops.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {selectedJob ? '该任务没有逐步日志' : '选择一个任务'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                  <TableHead className="w-20">状态</TableHead>
                  <TableHead>原路径</TableHead>
                  <TableHead>新路径</TableHead>
                  <TableHead className="w-64">错误</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ops.map((op) => (
                  <TableRow key={`${op.jobId}:${op.seq}`}>
                    <TableCell>{op.seq + 1}</TableCell>
                    <TableCell>{opLabel(op.op)}</TableCell>
                    <TableCell>
                      <Badge variant={op.status === 'failed' ? 'destructive' : op.status === 'ok' ? 'default' : 'outline'}>
                        {op.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={op.from}>
                      {op.from}
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={op.to ?? ''}>
                      {op.to ?? '-'}
                    </TableCell>
                    <TableCell className="text-destructive">{op.error ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
