# Nestify 输入助手规则参考

这份参考面向需要把自然语言转换成 Nestify 规则的 AI。语法必须以当前实现为准：搜索条件和规则筛选使用表达式，改名使用模板。生成前先确认用户是在“筛选对象”，还是在“生成新名称”。

## 1. 语法总览

### 搜索条件

```text
field:value
field:value AND field:value
field:value OR field:value
NOT field:value
field:value AND (field:value OR field:value)
```

常见例子：

```text
kind:dir
folder_name:项目
file_name:报告
ext:mp4|mkv
size:>10MB
mtime:last_7_days
kind:video AND missing:subtitle
kind:dir AND (folder_name:电影 OR folder_name:电视剧)
NOT (kind:dir OR file_name:Backup)
```

### 改名模板

模板是普通文本和 `{表达式}` 的组合：

```text
{name}{ext}
{name.trim().remove_ads().collapse_space()}{ext}
{name.after('-').trim()}{ext}
{parent}_{name}{ext}
```

模板中的文字会原样保留，花括号中的字段先求值，再按从左到右的顺序执行函数链。

### 改名规则组和整理规则

规则组的 `filter` 是筛选表达式，`template` 是改名模板。典型关系是：

```text
第二步外层筛选 AND (规则组 1 条件 OR 规则组 2 条件 OR 规则组 3 条件)
```

组内如果有复杂条件，必须自己用括号表示：

```text
kind:dir AND (folder_name:电影 OR folder_name:电视剧) AND NOT name:临时
```

多个规则组有重叠时按组顺序分配，先命中的组取得该条目；因此组顺序是业务优先级，不要把互斥关系误写成同一组的 `AND`。

## 2. 搜索字段

普通字段写法为 `字段:值`。值为空时不会形成有效条件。字段值通常是不区分大小写的包含匹配，比较字段使用比较运算符。普通关键词直接写文本，带空格的连续短语用双引号包裹；`text` 和 `phrase` 是内部概念，不要写成 `text:值` 或 `phrase:值`。

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| 普通关键词 | 文件名中包含关键词，直接输入即可 | `教程` |
| 带引号短语 | 连续短语，适合包含空格的完整短语 | `"hello world"` |
| `name` | 名称中包含关键词 | `name:Avatar` |
| `ext` | 扩展名，可用 `\|` 表示多个扩展名 | `ext:mp4\|mkv` |
| `kind` / `type` | 类型 | `kind:dir`、`kind:video` |
| `folder_name` | 仅匹配目录自身名称 | `folder_name:项目` |
| `file_name` | 仅匹配文件自身完整名称 | `file_name:报告` |
| `parent` / `dir` | 所在父目录名称或路径片段 | `parent:电影` |
| `path` | 完整路径或相对路径中包含片段 | `path:Z:\\资料库` |
| `size` | 文件大小 | `size:>10MB` |
| `mtime` | 修改时间 | `mtime:last_7_days` |
| `ctime` | 创建时间 | `ctime:today` |
| `depth` | 目录层级 | `depth:<=3` |
| `date_pattern` | 名称或路径中存在日期格式 | `date_pattern:yyyy-MM-dd` |
| `name_date` | 名称中存在日期格式 | `name_date:yyyyMMdd` |
| `path_date` | 路径中存在日期格式 | `path_date:yyyy` |
| `name_length` | 文件名主干长度 | `name_length:>=10` |
| `name_digits` | `true` 表示主干全为数字，`any` 表示包含数字 | `name_digits:any` |
| `child_count` | 子项数量 | `child_count:=0` |
| `file_count` | 目录中的文件数量 | `file_count:>=1` |
| `dir_count` | 目录中的子目录数量 | `dir_count:=0` |
| `useful_file_count` | 忽略字幕、NFO、封面等伴随文件后的有效文件数 | `useful_file_count:=1` |
| `has` | 存在伴随内容 | `has:subtitle`、`has:nfo`、`has:cover`、`has:sidecar` |
| `missing` | 缺少伴随内容 | `missing:subtitle`、`missing:nfo`、`missing:cover` |
| `unique_video` | 目录中恰好有一个视频 | `unique_video:true` |
| `is_sidecar` | 当前条目是否为字幕、NFO、封面等伴随文件 | `is_sidecar:true` |
| `windows_illegal` | 名称是否含 Windows 非法字符或非法尾部 | `windows_illegal:true` |
| `same_stem` | 当前目录中是否存在相同主干名的其他文件 | `same_stem:true` |
| `orphan_sidecar` | 伴随文件是否没有对应主文件 | `orphan_sidecar:true` |
| `dup` | 是否存在重复文件 | `dup:true` |

类型值包括 `file`、`dir`、`video`、`image`、`audio`、`document`、`code`、`config`、`archive`、`spreadsheet`、`presentation`、`subtitle`、`font`、`database`、`installer`、`unknown`。多个类型用竖线：

```text
kind:video|image
```

注意：`folder_name` 不会在文件的父目录名称上匹配；它只读取当前条目自身，且文件上为空。要按所在目录筛选使用 `parent`，要按完整路径筛选使用 `path`。

## 3. 比较值、日期和大小

支持的比较形式：

```text
field:123
field:=123
field:>123
field:>=123
field:<123
field:<=123
field:1..10
```

适用于 `size`、`mtime`、`ctime`、`depth`、`name_length`、`child_count`、`file_count`、`dir_count` 和 `useful_file_count` 的相应值类型。

大小单位支持常见二进制单位，例如：

```text
size:<16KB
size:>1GB
size:1MB..10MB
```

相对时间包括：

```text
today
yesterday
this_week
this_month
this_year
last_7_days
last_30_days
last_24_hours
last_90_days
last_week
last_month
last_year
```

也可以使用日期、月份、年份或范围：

```text
mtime:2025-01-01
mtime:2025-01
mtime:2025
mtime:2025-01-01..2025-01-31
```

日期模式常用标记为 `yyyy`、`MM`、`dd`，例如 `yyyy-MM-dd`、`yyyyMMdd`、`yyyy`。`date_pattern` 同时检查名称和路径；`name_date` 只检查名称；`path_date` 只检查路径。

## 4. 布尔逻辑和默认行为

### 显式逻辑

```text
kind:dir AND folder_name:项目
folder_name:项目 OR folder_name:归档
NOT has:subtitle
kind:video AND NOT missing:subtitle
kind:dir AND (folder_name:电影 OR folder_name:电视剧)
NOT (kind:dir OR file_name:Backup)
```

`AND` 优先表达“同时满足”，`OR` 表达“满足任意一个”，`NOT` 否定后面的一个条件或括号组。关键需求优先加括号，尤其是同时出现 `AND` 和 `OR` 时。

### 一元排除

以下写法可表达排除：

```text
-Backup
-kind:dir
NOT kind:dir
```

### 无操作符的兼容行为

为了保持旧搜索兼容，多个普通文本关键词不加操作符时通常按 OR，而字段过滤器组合通常按 AND。因此 AI 生成规则时不要省略逻辑连接符：

```text
kind:dir AND (folder_name:项目 OR folder_name:归档)
```

比下面这种写法更明确：

```text
kind:dir folder_name:项目 folder_name:归档
```

## 5. 函数式规则

规则字段是“字符来源”，同一套字符串函数可以用于文件名、文件夹名、路径等来源，不要为每种字符来源臆造一套函数。

### 匹配谓词

这四个函数放在规则表达式末尾时有专门的匹配含义：

```text
folder_name.contains('www')
folder_name.prefix('电影-')
file_name.suffix('.mkv')
folder_name.match('^[^-]+-.*www.*')
```

- `contains(text)`：不区分大小写地包含文字。
- `prefix(text)`：不区分大小写地以文字开头。
- `suffix(text)`：不区分大小写地以文字结尾。
- `match(regex)`：按正则表达式匹配。支持 `(?i)` 形式的大小写不敏感标记。

组合示例：

```text
kind:dir AND (folder_name.contains('www') OR folder_name.match('^Avatar'))
kind:dir AND NOT folder_name.contains('临时')
```

### 变换后比较

任何已支持的函数链都可以先变换字符，再用 `:期望值` 比较结果：

```text
folder_name.slice(0, 2):AB
folder_name.after('-').trim():www
file_name.lower().suffix('.mkv')
```

更稳妥的布尔匹配写法是把“包含”直接写成谓词，而不是误把正则匹配结果写成 `:www`：

```text
folder_name.contains('www')
```

下面的旧式写法仍兼容，但含义是“正则匹配后的值等于 `www`”，不等同于“正则中包含 www”：

```text
folder_name.match('^[^-]+-.*(www).*'):www
```

## 6. 字符函数目录

函数链写法为：

```text
来源函数.函数1().函数2('参数')
```

规则中可以使用函数链，模板中也可以使用同一套函数。参数中的逗号分隔参数，字符串可以用单引号或双引号。

### 清理和规范化

```text
trim()
normalize()
sanitize()
collapse_space()
remove_space()
remove_ads()
dedupe()
remove_punctuation()
remove_brackets()
remove_bracket_content()
remove_copy_suffix()
collapse_dots()
strip_ext_in_name()
remove_emoji()
filename_safe_colon()
remove_edition_tags()
zh_space_fix()
to_halfwidth()
```

用途示例：

```text
{name.trim().remove_ads().remove_bracket_content().collapse_space()}{ext}
{name.to_halfwidth().filename_safe_colon()}{ext}
```

### 大小写、本地化和命名风格

```text
upper()
lower()
title()
capitalize()
to_simplified()
to_traditional()
snake_case()
kebab_case()
camel_case()
pascal_case()
constant_case()
spaces_to_underscore()
underscore_to_space()
```

示例：

```text
{name.to_simplified().kebab_case()}{ext}
{name.to_traditional()}{ext}
```

### 截取、分割和抽取

```text
slice(start, end)
truncate(length)
before(separator)
after(separator)
between(start, end)
first_word()
last_word()
nth_word(index)
split_at(separator, index)
initials()
insert(index, text)
match(regex)
extract_year()
extract_number()
extract_last_number()
extract_date(format)
extract_resolution()
normalize_resolution()
extract_season_episode()
extract_episode()
extract_source()
```

索引规则：`slice` 使用 JavaScript 风格的起始位置，起始位置从 `0` 开始；负数从末尾计算。`nth_word` 和 `split_at` 的序号从 `1` 开始，负数从末尾计算。

高频示例：

```text
{name.slice(0, 10)}
{name.before('-').trim()}
{name.after('-').trim()}
{name.between('[', ']')}
{name.match('^(.+?)(?:\\s+S\\d+E\\d+)$')}
{name.extract_year()}
```

模板中的 `match(regex)` 会返回第一捕获组；没有捕获组时返回完整匹配。要截取第一个短横线之后的内容，`after('-')` 通常比正则更直观。

### 字符筛选和替换

```text
replace(old, new)
regex_replace(pattern, replacement)
keep_digits()
remove_digits()
keep_letters()
remove_letters()
keep_alnum()
keep_ascii()
remove_year()
```

示例：

```text
{name.replace('旧标题', '新标题')}{ext}
{name.regex_replace('\\s+', '-')}{ext}
{name.keep_digits()}
```

### 前后缀、包裹和长度

```text
pad(width, fill)
pad_start(width, fill)
pad_end(width, fill)
pad_number(width, fill)
prefix(text)
suffix(text)
ensure_prefix(text)
ensure_suffix(text)
remove_prefix(text)
remove_suffix(text)
wrap(left, right)
if_empty(default)
if_contains(needle, replacement)
max_len(length)
format_size()
ensure_ext(ext)
```

示例：

```text
{seq.pad(3, '0')}_{name}{ext}
{name.ensure_prefix('电影_')}{ext}
{name.if_empty('未命名')}{ext}
{name.if_contains('4K', '[4K]')}{ext}
{size.format_size()}
{name.ensure_ext()}
```

不带参数的 `max_len()` 会根据当前路径和扩展名计算剩余文件名长度；指定参数时使用显式上限。`ensure_ext()` 可从当前上下文补回扩展名，也可以传入扩展名参数。

### 特殊上下文函数

```text
take_parent_if_numeric()
take_grandparent_if_cd()
```

示例：

```text
{name.take_parent_if_numeric()}{ext}
{parent.take_grandparent_if_cd()}
```

## 7. 改名模板字段

### 当前条目和路径

| 模板字段 | 含义 |
| --- | --- |
| `{name}` | 当前名称，不含文件扩展名 |
| `{stem}` | 文件主干名；通常与 `{name}` 相同 |
| `{filename}` | 完整条目名称 |
| `{ext}` | 扩展名，通常含点，例如 `.mp4` |
| `{ext_no_dot}` | 不含点的扩展名 |
| `{parent}` | 所在目录名 |
| `{grandparent}` | 上级目录名 |
| `{ancestor(-1)}` | 上一级路径名称；也可使用其他整数层级 |
| `{drive}` | 盘符或根名 |
| `{root}` | 资料库根目录名 |
| `{path}` | 完整路径 |
| `{relPath}` | 相对路径 |
| `{size}` | 文件大小，单位为字节 |
| `{kind}` | 文件类型 |
| `{is_dir}` | 是否为目录 |
| `{depth}` | 目录层级 |

### 目录统计和关联条目

```text
{children.count}
{children.file_count}
{children.dir_count}
{children.video_count}
{children.image_count}
{children.useful_file_count}
{children.main_name}
{children.main_stem}
{children.main_kind}
{children.has_unique_video}
{children.main_video.stem}
{children.main_video.name}
{children.main_video.ext}
{peer_dir.exists}
```

### 动态值和时间

```text
{seq}
{parent_seq}
{now:yyyy-MM-dd HH-mm-ss}
{now:yyyy-MM-dd}
{now:yyyy}
{now:yyyy-MM}
{date_created:yyyy-MM-dd}
{date_modified:yyyy-MM-dd}
```

日期格式支持 `yyyy`、`MM`、`dd`、`HH`、`mm`、`ss`。文件名中使用时间时，Windows 文件名不能使用半角冒号，因此示例使用 `HH-mm-ss`。

## 8. 自然语言到规则的映射

### 只匹配目录，名称包含文字

```text
kind:dir AND folder_name.contains('www')
```

如果只是普通包含，也可以写：

```text
kind:dir AND folder_name:www
```

函数形式更适合与其他函数链组合。

### 只匹配文件，文件名以文字开头

```text
kind:file AND file_name.prefix('IMG_')
```

### 文件夹名包含前缀、短横线和关键词

“前面有若干字符，随后是 `-`，并且后面包含 `www`”：

```text
kind:dir AND folder_name.match('^[^-]+-.*www.*')
```

如果要求短横线必须是第一个分隔点之后且 `www` 出现在后半段，该表达式已经表达了这个关系。正则中的 `.*` 允许任意字符，包括空字符。

### 去掉第一个短横线前的内容

筛选和改名要分开写：

```text
kind:dir AND folder_name.match('^[^-]+-.*')
```

改名模板：

```text
{name.after('-').trim()}
```

### 文件名只保留前几位

```text
{name.slice(0, 5)}{ext}
```

筛选“前两位等于 AB”：

```text
file_name.slice(0, 2):AB
```

### 多个条件的“且”和“或”

“是目录，并且名称是电影或电视剧”：

```text
kind:dir AND (folder_name:电影 OR folder_name:电视剧)
```

“是视频，并且（有字幕或有 NFO），但排除临时文件”：

```text
kind:video AND (has:subtitle OR has:nfo) AND NOT name:临时
```

## 9. 常见错误和修正

### 把文件的父目录名称写成 `folder_name`

错误意图：按文件所在目录名称筛选。

```text
file_name:视频 folder_name:电影
```

修正：

```text
file_name:视频 AND parent:电影
```

### 把“包含 www”写成正则结果等于 www

容易误解的旧式写法：

```text
folder_name.match('^[^-]+-.*(www).*'):www
```

这会把正则捕获/匹配出的结果再与 `www` 比较，不是简单的“正则命中包含 www”。推荐：

```text
folder_name.match('^[^-]+-.*www.*')
```

或：

```text
folder_name.contains('www')
```

### 把搜索条件放进模板

错误：

```text
{kind:dir AND folder_name:电影}
```

修正：筛选单独放在规则组 `filter` 中，模板只写输出名称：

```text
filter: kind:dir AND folder_name:电影
template: {name.after('-').trim()}{ext}
```

### 忘记文件扩展名

如果文件改名后仍要保留扩展名：

```text
{name.to_simplified()}{ext}
```

目录通常使用：

```text
{name.to_simplified()}
```

### 混用 AND 和 OR 而不加括号

不推荐：

```text
kind:dir OR folder_name:电影 AND folder_name:电视剧
```

明确写出意图：

```text
kind:dir AND (folder_name:电影 OR folder_name:电视剧)
```

### 正则和字符串转义错误

规则函数的正则参数放在引号内。反斜杠需要按字符串转义：

```text
file_name.match('\\.(mp4|mkv)$')
```

若只是判断扩展名，优先使用：

```text
ext:mp4|mkv
```

### 使用不存在的函数

不要生成诸如 `starts_with()`、`ends_with()`、`substring()`、`to_simplified_chinese()` 等未在函数目录中的名字。对应写法是：

```text
.prefix('文字')
.suffix('文字')
.slice(0, 5)
.to_simplified()
```

## 10. 生成结果检查清单

生成规则后逐项检查：

1. 输出上下文是否正确：搜索表达式、规则组筛选还是改名模板。
2. 文件、目录、文件夹名、文件名和父路径是否没有混用。
3. `AND`、`OR`、`NOT` 的优先级是否已用括号表达。
4. `match()` 是否按当前上下文使用：筛选用正则谓词，模板用文本提取。
5. 函数名、参数数量和参数引号是否在支持列表中。
6. 文件模板是否保留 `{ext}`，目录模板是否错误追加扩展名。
7. 正则中的反斜杠、引号和短横线是否正确转义。
8. 规则是否只描述目标操作，没有把执行扫描、改名或移动当作语法生成的一部分。
