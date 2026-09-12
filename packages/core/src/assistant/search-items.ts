import type { AssistantItem, SearchFieldDefinition } from "./types.ts";

const SEARCH_BOX: AssistantItem["contexts"] = ["search", "scope-filter", "rename-group-filter"];
const SEARCH_AND_FIELD: AssistantItem["contexts"] = ["search", "search-field", "scope-filter", "rename-group-filter"];
const GROUP_FILTER: AssistantItem["contexts"] = ["search", "scope-filter", "rename-group-filter"];
const SCOPE_AND_GROUP: AssistantItem["contexts"] = ["scope-filter", "rename-group-filter"];

function datePart(value: number): string {
  return String(value).padStart(2, "0");
}

function currentDateValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${datePart(now.getMonth() + 1)}-${datePart(now.getDate())}`;
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${datePart(now.getMonth() + 1)}`;
}

function currentYearValue(): string {
  return String(new Date().getFullYear());
}

function currentMonthRangeValue(): string {
  const now = new Date();
  const month = currentMonthValue();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `${month}-01..${month}-${datePart(lastDay)}`;
}

export const SEARCH_FIELD_DEFINITIONS: SearchFieldDefinition[] = [
  { value: "text", label: "文件名包含", hint: "输入文件名中的关键词" },
  { value: "phrase", label: "完整短语", hint: "匹配连续文字，可包含空格" },
  { value: "ext", label: "扩展名", hint: "例如 mp4 或 jpg，也可用 mp4|mkv" },
  { value: "kind", label: "类型", hint: "file、dir、image、video" },
  { value: "parent", label: "所在目录", hint: "目录名称或路径片段" },
  { value: "path", label: "路径包含", hint: "完整路径或相对路径片段" },
  { value: "size", label: "文件大小", hint: "例如 >10MB、1MB..2MB", comparison: true },
  { value: "mtime", label: "修改时间", hint: "例如 today、last_7_days、>=2025-01-01", comparison: true },
  { value: "ctime", label: "创建时间", hint: "例如 today、last_7_days、>=2025-01-01", comparison: true },
  { value: "depth", label: "目录层级", hint: "例如 <=3", comparison: true },
  { value: "date_pattern", label: "名称或路径中的日期格式", hint: "不知道具体日期时，例如 yyyy-MM-dd" },
  { value: "name_date", label: "名称中的日期格式", hint: "例如 yyyy-MM-dd 或 yyyyMMdd" },
  { value: "path_date", label: "路径中的日期格式", hint: "例如 yyyy-MM-dd 或 yyyy" },
  { value: "name_length", label: "文件名长度", hint: "例如 >=10、5..20", comparison: true },
  { value: "name_digits", label: "文件名数字", hint: "true 全是数字，any 包含数字" },
  { value: "child_count", label: "子项数量", hint: "例如 =0、>=1", comparison: true },
  { value: "file_count", label: "文件数量", hint: "例如 =0、>=1", comparison: true },
  { value: "dir_count", label: "子目录数量", hint: "例如 =0、>=1", comparison: true },
  { value: "useful_file_count", label: "有效文件数量", hint: "忽略字幕/封面/nfo 后的文件数，例如 =1", comparison: true },
  { value: "has", label: "附带内容", hint: "subtitle、nfo、cover、sidecar" },
  { value: "missing", label: "缺少附带内容", hint: "subtitle、nfo、cover、sidecar" },
  { value: "unique_video", label: "唯一视频目录", hint: "true 表示目录里恰好 1 个视频" },
  { value: "is_sidecar", label: "伴随文件", hint: "true 表示当前条目是字幕/nfo/封面" },
  { value: "windows_illegal", label: "Windows 非法文件名", hint: "true 表示名称含非法字符或尾部点/空格" },
  { value: "same_stem", label: "同主干名", hint: "true 表示当前目录里还有同 stem 的其它文件" },
  { value: "orphan_sidecar", label: "孤立伴随文件", hint: "true 表示字幕/nfo/封面没有对应主文件" },
  { value: "dup", label: "重复文件", hint: "true 或 false" },
];

export const SEARCH_ITEMS: AssistantItem[] = [
  {
    id: "search-phrase",
    label: "完整短语",
    value: '"示例短语"',
    group: "文本条件",
    kind: "parameterized-chain",
    engine: "search-text",
    contexts: SEARCH_BOX,
    searchFields: ["text"],
    params: [{ name: "phrase", label: "短语", defaultValue: "示例短语" }],
  },
  {
    id: "search-parent",
    label: "所在目录",
    value: "parent:目录名",
    group: "路径条件",
    kind: "parameterized-chain",
    engine: "search-recipe",
    contexts: SEARCH_BOX,
    searchFields: ["text"],
    params: [{ name: "dir", label: "目录名", defaultValue: "目录名" }],
  },
  {
    id: "search-path",
    label: "路径包含",
    value: "path:路径片段",
    group: "路径条件",
    kind: "parameterized-chain",
    engine: "search-recipe",
    contexts: SEARCH_BOX,
    searchFields: ["text"],
    params: [{ name: "path", label: "路径片段", defaultValue: "路径片段" }],
  },
  ...relativeDates("mtime", "修改时间"),
  ...relativeDates("ctime", "创建时间"),
  ...datePatterns(),
  ...sizeItems(),
  ...depthItems(),
  ...kindValues(),
  ...extValues(),
  ...statValues(),
  ...nameLengthValues(),
  ...sidecarValues(),
  {
    id: "name-digits-true",
    label: "文件名全是数字",
    value: "true",
    group: "文件名数字",
    kind: "value",
    engine: "search-filter",
    contexts: SEARCH_AND_FIELD,
    searchFields: ["name_digits"],
  },
  {
    id: "name-digits-any",
    label: "文件名包含数字",
    value: "any",
    group: "文件名数字",
    kind: "value",
    engine: "search-filter",
    contexts: SEARCH_AND_FIELD,
    searchFields: ["name_digits"],
  },
  {
    id: "dup-true",
    label: "存在重复文件",
    value: "true",
    group: "重复文件",
    kind: "value",
    engine: "search-filter",
    contexts: ["search", "search-field"],
    searchFields: ["dup"],
  },
  {
    id: "dup-false",
    label: "不存在重复文件",
    value: "false",
    group: "重复文件",
    kind: "value",
    engine: "search-filter",
    contexts: ["search", "search-field"],
    searchFields: ["dup"],
  },
  ...recipes(),
  {
    id: "op-and",
    label: "并且：同时满足前后条件",
    value: "AND",
    group: "条件组合",
    kind: "operator",
    engine: "search-text",
    contexts: SEARCH_BOX,
    searchFields: ["text"],
  },
  {
    id: "op-or",
    label: "或者：满足前后任一条件",
    value: "OR",
    group: "条件组合",
    kind: "operator",
    engine: "search-text",
    contexts: SEARCH_BOX,
    searchFields: ["text"],
  },
  {
    id: "op-not",
    label: "排除：不满足后面的条件",
    value: "NOT",
    group: "条件组合",
    kind: "operator",
    engine: "search-text",
    contexts: SEARCH_BOX,
    searchFields: ["text"],
  },
];

function relativeDates(field: "mtime" | "ctime", clockLabel: string): AssistantItem[] {
  const values: Array<[string, string]> = [
    ["today", `今天（${clockLabel}）`],
    ["yesterday", `昨天（${clockLabel}）`],
    ["this_week", `本周（${clockLabel}）`],
    ["this_month", `本月（${clockLabel}）`],
    ["this_year", `今年（${clockLabel}）`],
    ["last_7_days", `最近 7 天（${clockLabel}）`],
    ["last_30_days", `最近 30 天（${clockLabel}）`],
    ["last_24_hours", `最近 24 小时（${clockLabel}）`],
    ["last_90_days", `最近 90 天（${clockLabel}）`],
    ["last_week", `上周（${clockLabel}）`],
    ["last_month", `上个月（${clockLabel}）`],
    ["last_year", `去年（${clockLabel}）`],
    [currentDateValue(), `精确日期（今天的${clockLabel}）`],
    [currentMonthValue(), `月份（本月的${clockLabel}）`],
    [currentYearValue(), `年份（今年的${clockLabel}）`],
    [currentMonthRangeValue(), `日期范围（本月的${clockLabel}）`],
  ];
  return values.map(([value, label]) => ({
    id: `${field}-${value}`,
    label,
    value,
    group: "日期与时间",
    kind: "relative-date",
    engine: "search-filter",
    contexts: SEARCH_AND_FIELD,
    searchFields: [field],
  }));
}

function sidecarValues(): AssistantItem[] {
  const hasValues: Array<[string, string, string]> = [
    ["has-subtitle", "带字幕文件", "subtitle"],
    ["has-nfo", "带 NFO 资料", "nfo"],
    ["has-cover", "带封面图", "cover"],
    ["has-sidecar", "带任意伴随文件", "sidecar"],
  ];
  const missingValues: Array<[string, string, string]> = [
    ["missing-subtitle", "缺少字幕", "subtitle"],
    ["missing-nfo", "缺少 NFO", "nfo"],
    ["missing-cover", "缺少封面", "cover"],
  ];
  return [
    ...hasValues.map(([id, label, value]) => ({
      id,
      label,
      value,
      group: "附加内容",
      kind: "sidecar" as const,
      engine: "search-filter" as const,
      contexts: SEARCH_AND_FIELD,
      searchFields: ["has"],
    })),
    ...missingValues.map(([id, label, value]) => ({
      id,
      label,
      value,
      group: "附加内容",
      kind: "sidecar" as const,
      engine: "search-filter" as const,
      contexts: SEARCH_AND_FIELD,
      searchFields: ["missing"],
    })),
    {
      id: "unique-video-true",
      label: "目录内恰好 1 个视频",
      value: "true",
      group: "目录统计",
      kind: "value",
      engine: "search-filter",
      contexts: SEARCH_AND_FIELD,
      searchFields: ["unique_video"],
    },
    {
      id: "is-sidecar-true",
      label: "当前是伴随文件",
      value: "true",
      group: "附加内容",
      kind: "value",
      engine: "search-filter",
      contexts: SEARCH_AND_FIELD,
      searchFields: ["is_sidecar"],
    },
    {
      id: "is-sidecar-false",
      label: "当前不是伴随文件",
      value: "false",
      group: "附加内容",
      kind: "value",
      engine: "search-filter",
      contexts: SEARCH_AND_FIELD,
      searchFields: ["is_sidecar"],
    },
    {
      id: "windows-illegal-true",
      label: "Windows 非法文件名",
      value: "true",
      group: "文件名",
      kind: "value",
      engine: "search-filter",
      contexts: SEARCH_AND_FIELD,
      searchFields: ["windows_illegal"],
    },
    {
      id: "same-stem-true",
      label: "同目录有同主干名文件",
      value: "true",
      group: "附加内容",
      kind: "value",
      engine: "search-filter",
      contexts: SEARCH_AND_FIELD,
      searchFields: ["same_stem"],
    },
    {
      id: "orphan-sidecar-true",
      label: "孤立的伴随文件",
      value: "true",
      group: "附加内容",
      kind: "value",
      engine: "search-filter",
      contexts: SEARCH_AND_FIELD,
      searchFields: ["orphan_sidecar"],
    },
  ];
}

function datePatterns(): AssistantItem[] {
  return [
    fieldRecipe("name-date-underscore", "文件名包含下划线日期", "name_date:yyyy_MM_dd", "日期与时间"),
    pattern("date-pattern-dash", "名称或路径包含日期格式", "yyyy-MM-dd", "date_pattern"),
    pattern("date-pattern-compact", "名称或路径包含紧凑日期", "yyyyMMdd", "date_pattern"),
    pattern("date-pattern-year", "名称或路径包含年份", "yyyy", "date_pattern"),
    pattern("name-date-dash", "名称包含日期格式：年-月-日", "yyyy-MM-dd", "name_date"),
    pattern("name-date-compact", "名称包含紧凑日期：年月日", "yyyyMMdd", "name_date"),
    pattern("name-date-year", "名称包含年份", "yyyy", "name_date"),
    pattern("path-date-dash", "路径包含日期格式：年-月-日", "yyyy-MM-dd", "path_date"),
    pattern("path-date-compact", "路径包含紧凑日期：年月日", "yyyyMMdd", "path_date"),
    pattern("path-date-year", "路径包含年份", "yyyy", "path_date"),
  ];
}

function sizeItems(): AssistantItem[] {
  const values: Array<[string, string]> = [
    ["1KB", "1 KB"],
    ["10MB", "10 MB"],
    ["100MB", "100 MB"],
    ["1GB", "1 GB"],
    ["<1GB", "小于 1 GB"],
    [">10MB", "大于 10 MB"],
    [">=10MB", "不少于 10 MB"],
    ["1MB..10MB", "1 MB 到 10 MB"],
    [">100MB", "大于 100 MB"],
    ["<1MB", "小于 1 MB"],
    ["<16KB", "小于 16 KB"],
  ];
  return values.map(([value, label]) => ({
    id: `size-${value}`,
    label,
    value,
    group: "文件大小",
    kind: "comparison",
    engine: "search-filter",
    contexts: SEARCH_AND_FIELD,
    searchFields: ["size"],
  }));
}

function depthItems(): AssistantItem[] {
  return [
    comparison("depth-le3", "层级不超过 3", "<=3", "目录层级", "depth"),
    comparison("depth-1-4", "层级 1 到 4", "1..4", "目录层级", "depth"),
  ];
}

function kindValues(): AssistantItem[] {
  const kinds: Array<[string, string]> = [
    ["file", "文件"],
    ["dir", "目录"],
    ["video", "视频"],
    ["image", "图片"],
    ["audio", "音频"],
    ["document", "文档"],
    ["code", "代码"],
    ["config", "配置"],
    ["archive", "压缩包"],
    ["spreadsheet", "表格"],
    ["presentation", "演示文稿"],
    ["subtitle", "字幕"],
    ["font", "字体"],
    ["database", "数据库"],
    ["installer", "安装程序"],
    ["unknown", "未知类型"],
  ];
  return kinds.map(([value, label]) => ({
    id: `kind-${value}`,
    label,
    value,
    group: "文件类型",
    kind: "value",
    engine: "search-filter",
    contexts: SEARCH_AND_FIELD,
    searchFields: ["kind"],
  }));
}

function extValues(): AssistantItem[] {
  const values: Array<[string, string]> = [
    ["mp4|mkv|avi|mov", "常用视频扩展名"],
    ["jpg|jpeg|png|webp|gif", "常用图片扩展名"],
    ["docx|xlsx|pptx|doc|xls|ppt", "Office 文档扩展名"],
    ["js|ts|tsx|jsx|py|java|go|rs", "常用代码扩展名"],
    ["json|yaml|yml|toml|ini|env", "常用配置扩展名"],
    ["mp3|wav|flac|aac|m4a", "常用音频扩展名"],
    ["zip|rar|7z|tar|gz", "常用压缩包扩展名"],
  ];
  return values.map(([value, label]) => ({
    id: `ext-${value}`,
    label,
    value,
    group: "扩展名",
    kind: "value",
    engine: "search-filter",
    contexts: SEARCH_AND_FIELD,
    searchFields: ["ext"],
  }));
}

function statValues(): AssistantItem[] {
  return [
    comparison("child-ge1", "子项不少于 1", ">=1", "目录统计", "child_count"),
    comparison("child-eq0", "子项为空", "=0", "目录统计", "child_count"),
    comparison("file-ge1", "文件不少于 1", ">=1", "目录统计", "file_count"),
    comparison("file-eq0", "没有文件", "=0", "目录统计", "file_count"),
    comparison("dir-ge1", "子目录不少于 1", ">=1", "目录统计", "dir_count"),
    comparison("dir-eq0", "没有子目录", "=0", "目录统计", "dir_count"),
    comparison("dir-gt3", "子目录超过 3", ">3", "目录统计", "dir_count"),
    comparison("useful-eq1", "有效文件恰好 1 个", "=1", "目录统计", "useful_file_count"),
    comparison("useful-eq0", "没有有效文件", "=0", "目录统计", "useful_file_count"),
  ];
}

function nameLengthValues(): AssistantItem[] {
  return [
    comparison("name-length-ge10", "文件名长度不少于 10", ">=10", "文件名长度", "name_length"),
    comparison("name-length-le20", "文件名长度不超过 20", "<=20", "文件名长度", "name_length"),
    comparison("name-length-5-20", "文件名长度 5 到 20", "5..20", "文件名长度", "name_length"),
    comparison("name-length-ge150", "文件名过长", ">=150", "文件名长度", "name_length"),
  ];
}

function recipes(): AssistantItem[] {
  const items: Array<[string, string, string, AssistantItem["contexts"]]> = [
    ["recipe-kind-dir", "仅目录", "kind:dir", GROUP_FILTER],
    ["recipe-kind-file", "仅文件", "kind:file", GROUP_FILTER],
    ["recipe-kind-video", "仅视频", "kind:video", GROUP_FILTER],
    ["recipe-kind-dir-file", "文件和目录", "kind:dir|file", GROUP_FILTER],
    ["recipe-nonempty-dir", "有内容的目录", "kind:dir AND child_count:>=1", GROUP_FILTER],
    ["recipe-empty-dir", "空目录", "kind:dir AND child_count:=0", GROUP_FILTER],
    ["recipe-nested-dir", "含子目录的目录", "kind:dir AND dir_count:>=1", GROUP_FILTER],
    ["recipe-leaf-dir", "只含文件的目录", "kind:dir AND file_count:>=1 AND dir_count:=0", GROUP_FILTER],
    ["recipe-large-video", "大于 1GB 的视频", "kind:video AND size:>1GB", GROUP_FILTER],
    ["recipe-tiny-file", "小于 16KB 的文件", "kind:file AND size:<16KB", GROUP_FILTER],
    ["recipe-recent-media", "最近 7 天的视频或图片", "kind:video|image AND mtime:last_7_days", GROUP_FILTER],
    ["recipe-numeric-names", "纯数字文件名", "name_digits:true", GROUP_FILTER],
    ["recipe-has-subtitle", "带字幕", "has:subtitle", GROUP_FILTER],
    ["recipe-has-nfo", "带 NFO", "has:nfo", GROUP_FILTER],
    ["recipe-has-cover", "带封面", "has:cover", GROUP_FILTER],
    ["recipe-missing-subtitle", "缺字幕的视频", "kind:video AND missing:subtitle", GROUP_FILTER],
    ["recipe-unique-video", "只有一个视频的目录", "kind:dir AND unique_video:true", GROUP_FILTER],
    ["recipe-useful-one", "只有一个有效文件的目录", "kind:dir AND useful_file_count:=1", GROUP_FILTER],
    ["recipe-same-stem", "同主干名文件", "same_stem:true", GROUP_FILTER],
    ["recipe-orphan-sidecar", "孤立伴随文件", "orphan_sidecar:true", GROUP_FILTER],
    ["recipe-recent-7", "最近 7 天", "mtime:last_7_days", GROUP_FILTER],
    ["recipe-created-7", "最近 7 天创建", "ctime:last_7_days", GROUP_FILTER],
    ["recipe-windows-illegal", "Windows 非法文件名", "windows_illegal:true", GROUP_FILTER],
    ["recipe-too-long-name", "文件名过长", "name_length:>=150", GROUP_FILTER],
    ["recipe-size-10mb", "大于 10MB", "size:>10MB", GROUP_FILTER],
    ["recipe-cd-folder", "CD / DISC 目录", "kind:dir CD1 DISC1", SCOPE_AND_GROUP],
  ];
  return items.map(([id, label, value, contexts]) => ({
    id,
    label,
    value,
    group: "常用配方",
    kind: "recipe",
    engine: "search-recipe",
    contexts,
    searchFields: ["text"],
  }));
}

function fieldRecipe(id: string, label: string, value: string, group: string): AssistantItem {
  return {
    id,
    label,
    value,
    group,
    kind: "recipe",
    engine: "search-recipe",
    contexts: SEARCH_BOX,
    searchFields: ["text"],
  };
}

function pattern(id: string, label: string, value: string, field: string): AssistantItem {
  return {
    id,
    label,
    value,
    group: "日期与时间",
    kind: "date-pattern",
    engine: "search-filter",
    contexts: SEARCH_AND_FIELD,
    searchFields: [field],
  };
}

function comparison(id: string, label: string, value: string, group: string, field: string): AssistantItem {
  return {
    id,
    label,
    value,
    group,
    kind: "comparison",
    engine: "search-filter",
    contexts: SEARCH_AND_FIELD,
    searchFields: [field],
  };
}
