import type { MediaMergeStep } from '@/app/useMediaMerge'
import type { MediaMergeItem } from '@/lib/ipc'

export const STEP_LABELS: Array<{ step: MediaMergeStep; title: string; description: string }> = [
  { step: 1, title: '选择媒体', description: '只允许一次合并同类文件' },
  { step: 2, title: '排列与裁剪', description: '规则排序、手工钉选、视频区间可视化' },
  { step: 3, title: '输出与执行', description: '确认参数后生成任务' },
]

export const PHASE_LABELS: Record<string, string> = {
  validating: '校验输入',
  analyzing: '分析媒体',
  preparing: '准备执行',
  processing: '处理文件',
  finalizing: '写入输出',
}

export function selectedPathsKey(items: MediaMergeItem[]): string {
  return items.map((current) => current.path).join('\n')
}

export function splitSelectedPaths(value: string): string[] {
  return value.split('\n')
}

export function mediaFileUrl(path: string): string {
  return `nestify-media://preview/?path=${encodeURIComponent(path)}`
}

export function imageLayoutLabel(layout: 'vertical' | 'horizontal' | 'grid'): string {
  if (layout === 'horizontal') return '横向长图'
  if (layout === 'grid') return '网格拼图'
  return '纵向长图'
}

export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00.0'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}
