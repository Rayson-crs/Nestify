export type AssistantContext = 'search' | 'rename-template' | 'duplicate-filter'
export type AssistantItemKind = 'value' | 'chain' | 'operator'

export type AssistantItem = {
  label: string
  value: string
  group: string
  kind?: AssistantItemKind
  searchFields?: string[]
}

export const RENAME_ITEMS: AssistantItem[] = [
  { label: '文件名（不含扩展名）', value: '{name}', group: '文件字段' },
  { label: '文件主干名', value: '{stem}', group: '文件字段' },
  { label: '完整文件名', value: '{filename}', group: '文件字段' },
  { label: '扩展名', value: '{ext}', group: '文件字段' },
  { label: '所在目录', value: '{parent}', group: '目录字段' },
  { label: '上级目录', value: '{grandparent}', group: '目录字段' },
  { label: '当前路径名称', value: '{ancestor(-1)}', group: '目录字段' },
  { label: '完整路径', value: '{path}', group: '目录字段' },
  { label: '相对路径', value: '{relPath}', group: '目录字段' },
  { label: '文件大小（字节）', value: '{size}', group: '文件属性' },
  { label: '文件类型', value: '{kind}', group: '文件属性' },
  { label: '是否为目录', value: '{is_dir}', group: '文件属性' },
  { label: '目录层级', value: '{depth}', group: '文件属性' },
  { label: '子项数量', value: '{children.count}', group: '目录统计' },
  { label: '文件数量', value: '{children.file_count}', group: '目录统计' },
  { label: '目录数量', value: '{children.dir_count}', group: '目录统计' },
  { label: '视频数量', value: '{children.video_count}', group: '目录统计' },
  { label: '图片数量', value: '{children.image_count}', group: '目录统计' },
  { label: '有效文件数量', value: '{children.useful_file_count}', group: '目录统计' },
  { label: '主文件名称', value: '{children.main_name}', group: '目录统计' },
  { label: '主文件类型', value: '{children.main_kind}', group: '目录统计' },
  { label: '是否存在唯一视频', value: '{children.has_unique_video}', group: '目录统计' },
  { label: '同名目录是否存在', value: '{peer_dir.exists}', group: '目录统计' },
  { label: '当前序号', value: '{seq}', group: '动态值' },
  { label: '目录内序号', value: '{parent_seq}', group: '动态值' },
  { label: '当前时间', value: '{now:yyyy-MM-dd HH-mm-ss}', group: '日期与时间' },
  { label: '当前日期', value: '{now:yyyy-MM-dd}', group: '日期与时间' },
  { label: '当前年份', value: '{now:yyyy}', group: '日期与时间' },
  { label: '当前月份', value: '{now:yyyy-MM}', group: '日期与时间' },
  { label: '当前紧凑日期', value: '{now:yyyyMMdd}', group: '日期与时间' },
  { label: '创建时间', value: '{date_created:yyyy-MM-dd HH-mm-ss}', group: '日期与时间' },
  { label: '创建日期', value: '{date_created:yyyy-MM-dd}', group: '日期与时间' },
  { label: '修改时间', value: '{date_modified:yyyy-MM-dd HH-mm-ss}', group: '日期与时间' },
  { label: '修改日期', value: '{date_modified:yyyy-MM-dd}', group: '日期与时间' },
]

export const RENAME_CHAINS: AssistantItem[] = [
  { label: '去除首尾空格', value: '.trim()', group: '字符清理', kind: 'chain' },
  { label: '合并连续空格', value: '.collapse_space()', group: '字符清理', kind: 'chain' },
  { label: '清理非法文件名字符', value: '.sanitize()', group: '字符清理', kind: 'chain' },
  { label: '移除广告文字和网址', value: '.remove_ads()', group: '字符清理', kind: 'chain' },
  { label: '字符去重', value: '.dedupe()', group: '字符清理', kind: 'chain' },
  { label: '统一全角半角', value: '.normalize()', group: '字符清理', kind: 'chain' },
  { label: '移除标点符号', value: '.remove_punctuation()', group: '字符清理', kind: 'chain' },
  { label: '替换文字', value: ".replace('旧文字', '新文字')", group: '字符替换', kind: 'chain' },
  { label: '正则替换', value: ".regex_replace('\\\\s+', '-')", group: '字符替换', kind: 'chain' },
  { label: '转为大写', value: '.upper()', group: '大小写格式', kind: 'chain' },
  { label: '转为小写', value: '.lower()', group: '大小写格式', kind: 'chain' },
  { label: '单词首字母大写', value: '.title()', group: '大小写格式', kind: 'chain' },
  { label: '首字母大写', value: '.capitalize()', group: '大小写格式', kind: 'chain' },
  { label: '统计字符长度', value: '.length()', group: '长度与截取', kind: 'chain' },
  { label: '截取前 10 个字符', value: '.slice(0, 10)', group: '长度与截取', kind: 'chain' },
  { label: '截取后 10 个字符', value: '.slice(-10)', group: '长度与截取', kind: 'chain' },
  { label: '截取并追加省略号', value: '.truncate(10)', group: '长度与截取', kind: 'chain' },
  { label: '重复字符 2 次', value: '.repeat(2)', group: '长度与截取', kind: 'chain' },
  { label: '反转字符顺序', value: '.reverse()', group: '长度与截取', kind: 'chain' },
  { label: '只保留数字', value: '.keep_digits()', group: '字符筛选', kind: 'chain' },
  { label: '移除数字', value: '.remove_digits()', group: '字符筛选', kind: 'chain' },
  { label: '只保留字母', value: '.keep_letters()', group: '字符筛选', kind: 'chain' },
  { label: '补齐到 2 位', value: ".pad(2, '0')", group: '格式补齐', kind: 'chain' },
  { label: '末尾补齐到 10 位', value: ".pad_end(10, '0')", group: '格式补齐', kind: 'chain' },
]

function datePart(value: number): string {
  return String(value).padStart(2, '0')
}

function currentDateValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${datePart(now.getMonth() + 1)}-${datePart(now.getDate())}`
}

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${datePart(now.getMonth() + 1)}`
}

function currentYearValue(): string {
  return String(new Date().getFullYear())
}

function currentMonthRangeValue(): string {
  const now = new Date()
  const month = currentMonthValue()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return `${month}-01..${month}-${datePart(lastDay)}`
}

export const SEARCH_ITEMS: AssistantItem[] = [
  { label: '完整短语示例', value: '示例短语', group: '文本条件' },
  { label: '今天（修改时间）', value: 'today', group: '日期与时间', searchFields: ['mtime'] },
  { label: '昨天（修改时间）', value: 'yesterday', group: '日期与时间', searchFields: ['mtime'] },
  { label: '本周（修改时间）', value: 'this_week', group: '日期与时间', searchFields: ['mtime'] },
  { label: '本月（修改时间）', value: 'this_month', group: '日期与时间', searchFields: ['mtime'] },
  { label: '今年（修改时间）', value: 'this_year', group: '日期与时间', searchFields: ['mtime'] },
  { label: '最近 7 天（修改时间）', value: 'last_7_days', group: '日期与时间', searchFields: ['mtime'] },
  { label: '最近 30 天（修改时间）', value: 'last_30_days', group: '日期与时间', searchFields: ['mtime'] },
  { label: '最近 24 小时（修改时间）', value: 'last_24_hours', group: '日期与时间', searchFields: ['mtime'] },
  { label: '最近 90 天（修改时间）', value: 'last_90_days', group: '日期与时间', searchFields: ['mtime'] },
  { label: '上周（修改时间）', value: 'last_week', group: '日期与时间', searchFields: ['mtime'] },
  { label: '上个月（修改时间）', value: 'last_month', group: '日期与时间', searchFields: ['mtime'] },
  { label: '去年（修改时间）', value: 'last_year', group: '日期与时间', searchFields: ['mtime'] },
  { label: '精确日期（今天）', value: currentDateValue(), group: '日期与时间', searchFields: ['mtime'] },
  { label: '月份（本月）', value: currentMonthValue(), group: '日期与时间', searchFields: ['mtime'] },
  { label: '年份（今年）', value: currentYearValue(), group: '日期与时间', searchFields: ['mtime'] },
  { label: '日期范围（本月）', value: currentMonthRangeValue(), group: '日期与时间', searchFields: ['mtime'] },
  { label: '文件名包含下划线日期', value: 'name_date:yyyy_MM_dd', group: '日期与时间', searchFields: ['text'] },
  { label: '名称或路径包含日期格式', value: 'yyyy-MM-dd', group: '日期与时间', searchFields: ['date_pattern'] },
  { label: '名称或路径包含紧凑日期', value: 'yyyyMMdd', group: '日期与时间', searchFields: ['date_pattern'] },
  { label: '名称或路径包含年份', value: 'yyyy', group: '日期与时间', searchFields: ['date_pattern'] },
  { label: '名称包含日期格式：年-月-日', value: 'yyyy-MM-dd', group: '日期与时间', searchFields: ['name_date'] },
  { label: '名称包含紧凑日期：年月日', value: 'yyyyMMdd', group: '日期与时间', searchFields: ['name_date'] },
  { label: '名称包含年份', value: 'yyyy', group: '日期与时间', searchFields: ['name_date'] },
  { label: '路径包含日期格式：年-月-日', value: 'yyyy-MM-dd', group: '日期与时间', searchFields: ['path_date'] },
  { label: '路径包含紧凑日期：年月日', value: 'yyyyMMdd', group: '日期与时间', searchFields: ['path_date'] },
  { label: '路径包含年份', value: 'yyyy', group: '日期与时间', searchFields: ['path_date'] },
  { label: '1 KB', value: '1KB', group: '文件大小', searchFields: ['size'] },
  { label: '10 MB', value: '10MB', group: '文件大小', searchFields: ['size'] },
  { label: '100 MB', value: '100MB', group: '文件大小', searchFields: ['size'] },
  { label: '1 GB', value: '1GB', group: '文件大小', searchFields: ['size'] },
  { label: '小于 1 GB', value: '<1GB', group: '文件大小', searchFields: ['size'] },
  { label: '大于 10 MB', value: '>10MB', group: '文件大小', searchFields: ['size'] },
  { label: '不少于 10 MB', value: '>=10MB', group: '文件大小', searchFields: ['size'] },
  { label: '1 MB 到 10 MB', value: '1MB..10MB', group: '文件大小', searchFields: ['size'] },
  { label: '大于 100 MB', value: '>100MB', group: '文件大小', searchFields: ['size'] },
  { label: '小于 1 MB', value: '<1MB', group: '文件大小', searchFields: ['size'] },
  { label: '层级不超过 3', value: '<=3', group: '目录层级', searchFields: ['depth'] },
  { label: '层级 1 到 4', value: '1..4', group: '目录层级', searchFields: ['depth'] },
  { label: '文件', value: 'file', group: '文件类型', searchFields: ['kind'] },
  { label: '目录', value: 'dir', group: '文件类型', searchFields: ['kind'] },
  { label: '视频', value: 'video', group: '文件类型', searchFields: ['kind'] },
  { label: '图片', value: 'image', group: '文件类型', searchFields: ['kind'] },
  { label: '文档', value: 'document', group: '文件类型', searchFields: ['kind'] },
  { label: '代码', value: 'code', group: '文件类型', searchFields: ['kind'] },
  { label: '配置', value: 'config', group: '文件类型', searchFields: ['kind'] },
  { label: '常用视频扩展名', value: 'mp4|mkv|avi|mov', group: '扩展名', searchFields: ['ext'] },
  { label: '常用图片扩展名', value: 'jpg|jpeg|png|webp|gif', group: '扩展名', searchFields: ['ext'] },
  { label: 'Office 文档扩展名', value: 'docx|xlsx|pptx|doc|xls|ppt', group: '扩展名', searchFields: ['ext'] },
  { label: '常用代码扩展名', value: 'js|ts|tsx|jsx|py|java|go|rs', group: '扩展名', searchFields: ['ext'] },
  { label: '常用配置扩展名', value: 'json|yaml|yml|toml|ini|env', group: '扩展名', searchFields: ['ext'] },
  { label: '带字幕文件', value: 'subtitle', group: '附加内容', searchFields: ['has'] },
  { label: '存在重复文件', value: 'true', group: '重复文件', searchFields: ['dup'] },
  { label: '不存在重复文件', value: 'false', group: '重复文件', searchFields: ['dup'] },
  { label: '文件名长度不少于 10', value: 'name_length:>=10', group: '长度与截取', searchFields: ['text'] },
  { label: '文件名长度不超过 20', value: 'name_length:<=20', group: '长度与截取', searchFields: ['text'] },
  { label: '文件名长度 5 到 20', value: 'name_length:5..20', group: '长度与截取', searchFields: ['text'] },
  { label: '并且：同时满足前后条件', value: 'AND', group: '条件组合', kind: 'operator', searchFields: ['text'] },
  { label: '或者：满足前后任一条件', value: 'OR', group: '条件组合', kind: 'operator', searchFields: ['text'] },
]

export function itemsForContext(context: AssistantContext, searchField?: string): AssistantItem[] {
  if (context === 'rename-template') return [...RENAME_ITEMS, ...RENAME_CHAINS]
  return SEARCH_ITEMS
}
