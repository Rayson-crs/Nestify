import type {
  Collision,
  DuplicateHashStrategy,
  DuplicateScope,
  KeepStrategy,
  LibraryHashStrategy,
  LibraryMediaStrategy,
  LibraryPreviewStrategy,
  SearchScope,
} from '@/lib/ipc'

export type WorkspaceTab = 'search' | 'rules' | 'organize' | 'rename' | 'duplicates' | 'jobs'
export type PlanSource = Exclude<WorkspaceTab, 'search' | 'jobs'>
export type TriStateSortDirection = 'asc' | 'desc' | null
export type FileViewMode = 'results' | 'tree'

export const COLLISION_LABEL: Record<Collision, string> = {
  suffix: '自动追加序号',
  skip: '跳过冲突',
  overwrite: '覆盖（不默认勾选）',
}

export const KEEP_LABEL: Record<KeepStrategy, string> = {
  newest: '保留最新',
  oldest: '保留最旧',
  shortest_path: '保留路径最短',
  name_quality: '保留文件名质量最高',
  preferred_dir: '保留优先目录',
}

export const KEEP_HINT: Record<KeepStrategy, string> = {
  newest: '每组留修改时间最新的，其余隔离——适合"新下载的才是要的"。',
  oldest: '每组留最旧的，其余隔离——适合存档场景。',
  shortest_path: '留层级最浅、名字最短的，其余隔离——通常短路径是规范位置。',
  name_quality: '按文件名规整度打分（无乱码、无广告词、命名规范）留最好的。',
  preferred_dir: '留位于上面指定目录里的那份，目录里没有则退回保留最新。',
}

export const DUPLICATE_HASH_LABEL: Record<DuplicateHashStrategy, string> = {
  'on-demand': '按需哈希（准）',
  'duplicate-candidate-only': '重复候选（快，推荐）',
  all: '全量哈希（最准最慢）',
}

export const DUPLICATE_SCOPE_LABEL: Record<DuplicateScope, string> = {
  library: '整个资料库',
  directory: '指定目录',
  selection: '搜索勾选',
}

export const SEARCH_SCOPE_LABEL: Record<SearchScope, string> = DUPLICATE_SCOPE_LABEL

export const SEARCH_KIND_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'document', label: '文档' },
  { value: 'code', label: '代码' },
  { value: 'config', label: '配置' },
  { value: 'spreadsheet', label: '表格' },
  { value: 'presentation', label: '演示文稿' },
  { value: 'font', label: '字体' },
  { value: 'database', label: '数据库' },
  { value: 'archive', label: '压缩包' },
  { value: 'dir', label: '目录' },
] as const

export type SearchKindFilter = (typeof SEARCH_KIND_OPTIONS)[number]['value']

export type LibraryDraft = {
  name: string
  roots: string
  excludeGlobs: string
  maxDepth: string
  followSymlinks: boolean
  scanHidden: boolean
  hashStrategy: LibraryHashStrategy
  mediaStrategy: LibraryMediaStrategy
  previewStrategy: LibraryPreviewStrategy
}

export const DEFAULT_LIBRARY_DRAFT: LibraryDraft = {
  name: '',
  roots: '',
  excludeGlobs: '',
  maxDepth: '',
  followSymlinks: false,
  scanHidden: false,
  hashStrategy: 'duplicate-candidate-only',
  mediaStrategy: 'off',
  previewStrategy: 'standard',
}

export function nextTriStateSort(direction: TriStateSortDirection): TriStateSortDirection {
  return direction === 'asc' ? 'desc' : direction === 'desc' ? null : 'asc'
}

export const HASH_STRATEGY_OPTIONS = [
  { value: 'off', label: '不计算哈希' },
  { value: 'on-demand', label: '按需哈希' },
  { value: 'duplicate-candidate-only', label: '重复候选' },
  { value: 'all', label: '全量哈希' },
] as const satisfies Array<{ value: LibraryHashStrategy; label: string }>

export const MEDIA_STRATEGY_OPTIONS = [
  { value: 'off', label: '不分析媒体' },
  { value: 'standard', label: '标准媒体' },
  { value: 'deep', label: '深度媒体' },
] as const satisfies Array<{ value: LibraryMediaStrategy; label: string }>

export const PREVIEW_STRATEGY_OPTIONS = [
  { value: 'off', label: '不生成预览' },
  { value: 'standard', label: '标准预览' },
  { value: 'on-demand', label: '按需预览' },
  { value: 'visible', label: '可见预览' },
  { value: 'eager', label: '立即预览' },
] as const satisfies Array<{ value: LibraryPreviewStrategy; label: string }>
