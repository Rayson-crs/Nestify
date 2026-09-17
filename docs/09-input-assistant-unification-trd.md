# Nestify 输入助手统一 TRD

> 文档版本：v0.5
> 当前状态（2026-09-17 / v1.8.1）：P0 / 搜索 P1 / 搜索 P2 / 改名 P2 仍然有效。关键词空格默认 OR；魔法棒统一为一套弹层 + 一份 core catalog；查重页只保留隔离。规划中仍不做 LLM、媒体字段、`if_kind`、`hash8`。
> 状态：P0 / 搜索 P1 / 搜索 P2 / 改名 P2 已落地。关键词空格默认 OR；魔法棒统一为一套弹层 + 一份 core catalog；查重页已去掉执行删除，只保留隔离
> 日期：2026-09-17
> 本文只统一「魔法棒 / 输入助手」，不统一宿主搜索框
> 适用范围：魔法棒出现的所有位置（顶栏搜索、Spotlight、查重范围、改名范围、改名分组匹配条件、改名模板、规则组装 Dialog）
> 相关代码：
> - [MagicParameterInput.tsx](../apps/desktop/src/components/rules/MagicParameterInput.tsx)
> - [packages/core/src/assistant/](../packages/core/src/assistant/)
> - [RuleBuilderDialog.tsx](../apps/desktop/src/components/rules/RuleBuilderDialog.tsx)
> - [RenameGroupsEditor.tsx](../apps/desktop/src/components/rules/RenameGroupsEditor.tsx)
> - [AppHeader.tsx](../apps/desktop/src/components/app/AppHeader.tsx)
> - [spotlight-main.tsx](../apps/desktop/src/spotlight-main.tsx)
> - [DuplicatePane.tsx](../apps/desktop/src/components/workspace/DuplicatePane.tsx)
> - [RenamePane.tsx](../apps/desktop/src/components/workspace/RenamePane.tsx)
> - [RuleSetEditor.tsx](../apps/desktop/src/components/RuleSetEditor.tsx)
> - [parse.ts](../packages/core/src/search/parse.ts)
> - [placeholders.ts](../packages/core/src/rules/placeholders.ts)
> - [template.ts](../packages/core/src/rules/template.ts)
> - [context.ts](../packages/core/src/rules/context.ts)
>
> 关联说明：查重页已去掉执行删除，分析默认隔离（见第 15 节）

## 1. 摘要

输入助手不是另一套引擎，也不是另一套搜索框。它只是把已有搜索语法和改名模板插进当前输入框。用户点的是输入框右侧那根魔法棒，不是把顶栏搜索和 Spotlight 收成同一个控件。

落地前真正的问题是：同一根火花按钮在不同页面做不同的事。Spotlight、查重范围、改名范围走目录弹层；顶栏搜索和规则方案改名模板打开另一套 Dialog。目录还被拆成三份字段表，点到的条目有的会生效，有的只是看起来能用。现在这些问题已经按第 6 节收口。

本 TRD 的目标是：

```text
一份能力注册表
  + 同一套魔法棒弹层
  + 按上下文裁剪目录
  + 点到的都能生效
  + 覆盖更复杂的文件治理场景
```

顶栏搜索和 Spotlight 继续各做各的输入壳。魔法棒必须是同一套。个别位置不该出现某些能力时，用上下文配置隐藏，而不是再做一套助手。第 4 点已按第 6.5 节推荐方案落地。

第一阶段不扩媒体元数据，不引入 LLM，不把规则 VM 的条件表达式塞进输入框，也不把查重删除塞进助手。先把已有搜索字段、改名字段、链式函数收成同一份真相源，修掉不会生效的项，再按文件治理场景补高价值能力。

## 2. 目标

用户拍板的四件事，就是本文成果：

1. 明确点击魔法棒（输入助手）的能力统一。所有页面点火花按钮，打开的是同一套输入助手：同一份注册表、同一套弹层、同一套插入策略。
2. 增强输入助手的函数能力，让更复杂的文件治理场景能直接点出来，而不是只插几个字段。
3. 顶栏搜索和 Spotlight 不是同一控件，这是对的，也不应该统一。必须统一的是魔法棒能力。
4. 所有页面用到的魔法棒都是一样的。如果某个位置不该出现某些能力，用同一套助手的上下文配置隐藏，不要再分叉出第二套魔法棒。3 个例子、设计和最终方案见第 6.5 节，已按推荐方案落地。

工程上还要同时做到：

1. 搜索、范围过滤、改名模板共用同一套能力描述，不再各写一份字段表。
2. 目录、解析器、执行器三者同源：目录有的，引擎必须认识；引擎认识的，对应上下文必须能插进去。
3. 点选结果按上下文适配，而不是把同一串文本丢进所有输入框。
4. 用户能看见“插进去会变成什么”，改名还要看见“对当前文件会变成什么”。
5. 能力类型可扩展，但默认只展示当前上下文真正用得上的类型。

非目标：

- 不把顶栏搜索换成 Spotlight，也不把 Spotlight 换成顶栏搜索。
- 不把各页面的宿主输入框收成同一个组件。
- 不把输入助手做成自然语言问答。
- 不在助手里直接执行改名、删除、移动。
- 不把完整规则 VM（`all` / `any` / `if` / `foreach`）塞进一行模板。
- 不为了凑数再堆几乎没人用的字符串函数。
- 查重页已去掉「执行删除」，分析默认隔离；不要把删除/隔离再塞进助手目录。见第 15 节。

## 3. 现状

### 3.0 宿主控件 ≠ 魔法棒

这两层必须分开看。v0.2 把「顶栏搜索和 Spotlight 不是同一控件」写成问题，是错的。它们本来就不是同一控件，也不该被这篇文档改掉。

| 位置 | 宿主控件（保持独立） | 落地前 | 现在 |
| --- | --- | --- | --- |
| 顶栏搜索 | [AppHeader.tsx](../apps/desktop/src/components/app/AppHeader.tsx) 紧凑搜索栏，结果落在主窗口 | `MagicWandInput`：火花打开 `RuleBuilderDialog` | 同一套 `MagicParameterInput` 弹层，上下文 `search`；Dialog 只从「按字段组装」进入 |
| Spotlight | [spotlight-main.tsx](../apps/desktop/src/spotlight-main.tsx) 独立 overlay 搜索 | `MagicParameterInput` 目录弹层，`context="search"` | 同一套弹层，上下文仍是 `search` |
| 查重范围 | [DuplicatePane.tsx](../apps/desktop/src/components/workspace/DuplicatePane.tsx) 范围过滤框 | `MagicParameterInput`，`context="duplicate-filter"` | 同一套弹层，上下文 `scope-filter` |
| 改名范围 | [RenamePane.tsx](../apps/desktop/src/components/workspace/RenamePane.tsx) 范围过滤框 | 同上，也叫 `duplicate-filter` | 同一套弹层，上下文 `scope-filter` |
| 改名分组匹配条件 | [RenameGroupsEditor.tsx](../apps/desktop/src/components/rules/RenameGroupsEditor.tsx) 分组条件框 | 又复用 `duplicate-filter` | 同一套弹层，上下文 `rename-group-filter` |
| 工作台改名模板 | 分组编辑里的模板框 | `MagicParameterInput`，`context="rename-template"` | 同一套弹层，上下文 `rename-template`，底部有试算 |
| 规则方案改名模板 | [RuleSetEditor.tsx](../apps/desktop/src/components/RuleSetEditor.tsx) 模板框 | `MagicWandInput` 打开 Dialog | 同一套弹层；Dialog 只作为高级组装 |
| 组装 Dialog 值行 | 已选字段的值输入框 | `MagicParameterInput` 传了 `searchField`，但目录不过滤 | 同一套弹层，上下文 `search-field`，按字段过滤 |

顶栏和 Spotlight 都是自由搜索，魔法棒目录同属 `search`。它们的输入壳、快捷键、结果落点继续分开。查重/改名范围吃搜索语法，但任务不是自由搜索，已改成 `scope-filter` / `rename-group-filter`，不再顶着 `duplicate-filter` 塞全量搜索目录。

### 3.1 落地前：魔法棒有两套含义

| 入口 | 控件 | 魔杖实际做什么 | 出现位置 |
| --- | --- | --- | --- |
| 输入助手 | `MagicParameterInput` | 弹出可搜索、可连续插入的分组目录 | Spotlight、查重页范围、改名页范围、改名分组编辑、搜索/改名组装 Dialog 的值输入框 |
| 可视化组装 | `MagicWandInput` + `RuleBuilderDialog` | 普通输入框 + 右侧火花打开 Dialog | 主界面顶栏搜索、规则方案里的改名模板 |

落地前要统一的是火花按钮的含义，不是把 Spotlight 的 overlay 输入框搬进顶栏。当时 Spotlight 能直接点 `mtime:today`，顶栏火花却打开另一套 Dialog；规则方案改名模板走 Dialog，工作台改名分组走输入助手。用户点的是同一根魔法棒，产品却给了两套心智。

现在所有火花按钮都打开同一套 `MagicParameterInput`。`MagicWandInput` 只是薄封装，Dialog 从弹层顶部「按字段组装」进入。

### 3.2 落地前：四种上下文，只有两份目录

`AssistantContext` 有 `search`、`rename-template`、`duplicate-filter`。`itemsForContext()` 实际只分两支：

- `rename-template` -> `RENAME_ITEMS + RENAME_CHAINS`
- 其余全部 -> `SEARCH_ITEMS`

落地前查重范围、改名范围、改名分组的「匹配条件」都叫 `duplicate-filter`，目录却和首页搜索完全一样。`searchField` 传进去了，但 `itemsForContext()` 完全忽略它。

现在 `AssistantContext` 是 `search` / `search-field` / `scope-filter` / `rename-group-filter` / `rename-template`。`itemsForContext(context, field)` 真正过滤。

### 3.3 落地前：三份字段表，互相落后

| 真相源 | 管什么 | 实际覆盖 |
| --- | --- | --- |
| `parse.ts` `FILTER_KEYS` | 搜索引擎真正认识的字段 | `ext` `parent` `dir` `type` `kind` `path` `size` `mtime` `depth` `name_date` `path_date` `date_pattern` `name_length` `name_digits` `child_count` `file_count` `dir_count` `has` `dup` |
| `RuleBuilderDialog` `SEARCH_FIELDS` | 组装 Dialog 下拉 | 有 `text` `phrase` `ext` `kind` `parent` `path` `size` `mtime` `depth` `date_pattern` `name_date` `path_date` `has` `dup`；缺 `name_length` `name_digits` `child_count` `file_count` `dir_count` |
| `SEARCH_ITEMS` | 助手可点的搜索条目 | 日期/大小/层级/kind/ext/目录统计/`has`/`dup`/`name_digits`/`name_length`；缺独立的 `parent:` `path:` 快捷项 |
| `placeholders.ts` `PLACEHOLDERS` | 对外宣称的改名字段 | 只有 13 个基础名，不含 `stem` `filename` `drive` `children.*` |
| `RuleContext` + `getContextValue` | 改名真正能取值的字段 | 文件名、路径、大小、时间、目录统计、主文件、同名目录、序号 |
| `RENAME_ITEMS` | 助手可点的改名字段 | 覆盖大部分 `RuleContext`，但仍缺 `children.main_stem`、`children.main_video.*` |
| `CHAIN_FUNCS` / `applyChain` / `RENAME_CHAINS` | 链式函数 | 三者基本对齐，约 50 个函数都已实现 |

落地前 `PLACEHOLDERS` 已经不能当目录用。真正能渲染的是 `getContextValue(ctx, field)`，不是那份短列表。

现在搜索字段定义和条目都在 [packages/core/src/assistant/](../packages/core/src/assistant/)。Dialog 下拉走 `searchFieldDefinitions()`，比较字段走 `comparisonSearchFields()`，已含 `name_length` 和目录统计。改名目录已含 `children.main_stem` / `children.main_video.*`。`PLACEHOLDERS` 仍是短列表，不再当目录用。

### 3.4 落地前：改名分组把匹配条件当成了查重范围

[RenameGroupsEditor.tsx](../apps/desktop/src/components/rules/RenameGroupsEditor.tsx) 里，「匹配条件」和「改名模板」是两个输入框，却共用输入助手壳。匹配条件走 `context="duplicate-filter"`，模板走 `rename-template`。

落地前给「空目录改名」「唯一视频文件夹跟视频同名」配规则时，目录里会出现 `dup:true`、AND/OR、完整短语示例。这些对分组过滤几乎没用，还容易插出错误语法。

现在匹配条件走 `rename-group-filter`，模板走 `rename-template`，查重/改名范围走 `scope-filter`，都隐藏 `dup:`。

## 4. 什么地方没有统一

P0 产品/交互缺口已经按第 6 节收口，见第 16 节。下面保留落地前的缺口清单，方便对照。`ctime` / `has:nfo|cover|sidecar` / `NOT` / `useful_file_count` / `same_stem` / `orphan_sidecar` 已进引擎。第 11 节里仍明确先不做的是 LLM、媒体字段、`if_kind`、`hash8`、`sibling_index`、`collision_suffix`。

### 4.1 产品层

1. 顶栏搜索和 Spotlight 不是同一控件，这是对的。真正没统一的是右侧魔法棒：一个打开目录弹层，一个打开 Dialog。
2. 查重范围、改名范围、搜索框共用视觉，但文案、目录、禁用项没有按任务裁剪。
3. 规则方案编辑器和工作台改名器用两套模板入口：一个火花打开 Dialog，一个火花打开输入助手。
4. 组装 Dialog 和输入助手目录是两套 UX：一个按行选字段，一个按分组点条目，两者字段集还不一致。Dialog 可以继续作为高级组装，但不能再当第二套魔法棒。

### 4.2 数据层

1. `searchFields` 只影响插入时要不要加 `field:` 前缀，不影响目录显示。
2. Dialog 的比较字段集合只有 `size` `mtime` `depth`，目录统计和 `name_length` 没法选 `>=`。
3. 搜索目录把若干完整查询写成 `searchFields: ['text']`，例如 `kind:dir AND child_count:=0`、`name_length:>=10`。在自由搜索里这是配方；在已选字段的 Dialog 行里会变成错误语法。
4. 改名核心 `PLACEHOLDERS` 与 `RuleContext` 脱节，文档 [01-six-core-modules.md](./01-six-core-modules.md) 的 v1 函数列表也落后于实现。

### 4.3 交互层

1. 链式函数用正则找第一个 `{...}`，不看光标。
2. 没有字段时，函数会变成 `{name.xxx}` 再拼回原文本。
3. 改名组装 Dialog 每次打开重置为 `{name}{ext}`。
4. 搜索组装 Dialog 每次打开清空条件，不解析当前查询。
5. 无实时预览、无最近常用、无参数填写、无当前文件试算。

## 5. 不会生效、会误导、会插错

落地前目录把这些画成能用。P0 已修：字段过滤、短语带引号、光标挂链、Dialog 不重置、ancestor 标签、范围去掉 `dup:`、顶栏火花打开同一套弹层。v0.5 又修了：`has:nfo|cover|sidecar`、`ctime`、`NOT` / `-term`、`{mtime:yyyy}` 走日期格式。

| 现象 | 用户看到 | 实际结果 | 原因 |
| --- | --- | --- | --- |
| 组装行不按字段过滤 | 选了「修改时间」仍能点「视频」 | 生成 `mtime:video`，查不到预期文件 | `itemsForContext` 忽略 `searchField` |
| `has:` 只有字幕 | 目录只有「带字幕文件」，但自由输入 `has:nfo` 也像合法 | SQL 恒为 `0`，结果为空 | `subtitleExistsSql` 非 `subtitle` 直接返回 `"0"` |
| `name_digits` 只认两个值 | 手打 `name_digits:false` | 条件被丢弃 | 解析只接受 `true` / `any` |
| `{ancestor(-1)}` 标签 | 「当前路径名称」 | 实际是上一级目录，和 `{parent}` 重复 | 标签写错；`ancestor(n)` 的 n 是向上层级数 |
| `{mtime:yyyy-MM-dd}` | 像日期字段 | 落地前输出毫秒时间戳；现在按日期格式化 | `mtime` / `ctime` 已进入 `DATE_FIELDS` |
| `{ctime:yyyy}` | 同上 | 现在按创建时间格式化；改名目录仍推荐 `date_created` | 创建时间别名已接通 |
| 多字段模板点函数 | `{parent}/{name}{ext}` 再点 `.upper()` | 变成 `{parent.upper()}/{name}{ext}` | `insertChain` 只改第一段 |
| 改名 Dialog 打开 | 想改已有模板 | 被重置成 `{name}{ext}` | `useEffect` 不读入 `value` |
| 完整短语示例 | 点「完整短语示例」 | 插入 `示例短语`，没有引号 | 条目不是带引号的 phrase token |
| 查重页点 `dup:true` | 像在过滤重复 | 对查重范围几乎无意义 | 查重结果本来就是重复组，目录未裁剪 |
| 目录统计插进文本行 | 点「空目录」 | 自由搜索正确；`kind` 行会变成 `kind:kind:dir AND ...` | 配方项被标成 `text`，未标成 `recipe` |
| `format_size()` 用在文件名 | 目录允许对任意字段挂链 | `{name.format_size()}` 得到 `0B` | 函数对非数字字符串得到 0 |
| `repeat(n)` 超过 20 | 以为能重复任意次 | 被夹到 20 | 实现有上限，目录未说明 |
| 搜索不支持 `ctime` | 产品文档写了创建时间筛选 | 落地前只有 `mtime:`；现在 `ctime:today` / `ctime:last_7_days` 生效 | 解析器和 SQL 已接创建时间 |
| 搜索不支持 `NOT` / 括号 | 手打 `-tmp` 或 `(a OR b) AND c` | 落地前 `-tmp` 当普通文本；现在一元 `NOT` / `-term` 生效。完整括号分组仍后置 | tokenizer 已有否定，尚无任意括号表达式 |
| 顶栏火花按钮 | 像输入助手 | 打开的是另一套 Dialog，且不带目录 | `MagicWandInput` 不是 `MagicParameterInput` |

这些不是“以后再增强”，是当前目录已经把它画成能用。统一时必须先删掉或改成真正能跑的形态。

## 6. 怎么统一

### 6.1 一份能力注册表

把目录从 UI 常量提升为 core 里的注册表，UI 只负责渲染和插入。建议结构：

```text
packages/core/src/assistant/
  types.ts          能力类型、上下文、插入策略
  search-fields.ts  与 FILTER_KEYS 同源
  rename-fields.ts  与 RuleContext 同源
  chain-funcs.ts    与 CHAIN_FUNCS / applyChain 同源
  recipes.ts        跨字段的完整查询或完整模板
  catalog.ts        itemsForContext(context, field) 真正过滤
```

约束：

1. 每个搜索字段必须能在 `parse.ts` 找到对应 key。
2. 每个改名字段必须能被 `getContextValue` 读到，日期字段必须进入 `DATE_FIELDS`。
3. 每个链式函数必须能被 `applyChain` 执行。
4. 测试锁定：catalog 是引擎的子集；引擎的公开字段要么在目录里，要么显式标成 hidden。
5. `placeholders.ts` 的短列表要么删，要么改成从注册表生成，不再手写第二份。

### 6.2 按上下文裁剪，而不是按文件分叉

| 上下文 | 用途 | 目录应有 |
| --- | --- | --- |
| `search` | 首页 / Spotlight / 顶栏 | 全量搜索字段、配方、AND/OR、短语 |
| `search-field:<name>` | 组装 Dialog 某一行 | 仅该字段的值、比较式、示例；禁用 AND/OR 和跨字段配方 |
| `scope-filter` | 查重范围、改名范围 | 搜索字段的子集 + 范围配方；去掉 `dup:`，突出 kind/size/ext/空目录/唯一视频 |
| `rename-template` | 改名模板 | 字段、链式函数、常用模板、snippet；函数按当前光标所在 `{...}` 挂载 |
| `rename-group-filter` | 改名分组匹配条件 | `scope-filter` 的子集；突出 kind/ext/空目录/唯一视频/纯数字名 |

`duplicate-filter` 这个名字应改成 `scope-filter`。查重范围、改名范围、改名分组条件吃的都是搜索语法，不是去重专用语言。

### 6.3 同一套魔法棒，不是同一套宿主输入框

统一对象是火花按钮打开的那一层，不是把 AppHeader、Spotlight、查重范围框收成一个组件。

```text
宿主输入框（各自保留）
  AppHeader / Spotlight / DuplicatePane / RenamePane / RenameGroupsEditor / RuleSetEditor
        |
        +-- 同一根魔法棒按钮
              |
              v
        InputAssistantPopover   唯一弹层
              |
              +-- assistant catalog
              +-- context profile（显示哪些项、怎么插入）
              +-- 可选 RuleBuilderDialog（高级组装，字段仍来自 catalog）
```

落地规则：

- 任意宿主输入框右侧都挂同一根魔法棒，打开同一套 `InputAssistantPopover`。
- `MagicWandInput` 不再等于「打开 Dialog」。它只是「给现有输入框加魔法棒」的薄封装。
- 需要多条件可视化时，目录顶部提供「按字段组装」，仍打开现在的 Dialog，但 Dialog 的字段表来自同一注册表，Dialog 值行也继续用这根魔法棒。
- 顶栏搜索继续是顶栏搜索，Spotlight 继续是 overlay。它们的魔法棒上下文都可以是 `search`，目录相同，输入壳不同。

插入策略保留现有三条，但要写进注册表，而不是散落在 UI：

1. 自由搜索：字段项插入 `field:value`，配方整段插入，操作符当 AND/OR 处理空白。
2. 已选字段行：只插裸值。
3. 改名模板：字段原样插入；chain 挂到光标所在表达式，没有表达式则插入 `{name.func()}`。

### 6.4 最终形态

用户侧：

1. 任意相关输入框右侧都是同一把魔杖，点开后是同一套弹层。
2. 弹层上方是搜索框，下面按类型分组：字段、值、配方、函数、操作符。
3. 当前上下文不支持的分组直接不出现，而不是换成另一套助手。
4. 需要参数的函数先弹出小表单，再插入，而不是留下占位中文。
5. 弹层底部固定一行预览：搜索显示即将插入的语法；改名显示当前选中文件的 before -> after。
6. 连续点选不关闭；Esc 关闭并回到输入框。
7. 组装 Dialog 打开时解析已有查询/模板，不再清空。Dialog 是高级模式，不是第二套魔法棒。
8. 每条目录名称旁边有问号；悬停显示用法和效果例子，点问号不插入。

开发侧：

```text
RuleContext / FILTER_KEYS / CHAIN_FUNCS
        |
        v
   assistant catalog
        |
        +-- InputAssistantPopover  （所有魔法棒）
        +-- RuleBuilderDialog      （可选的多行组装，字段来自 catalog）
        +-- 宿主输入框保持独立
```

### 6.5 第 4 点：哪些能力不该出现

原则：魔法棒永远是同一套；能力可以按上下文隐藏。不要为某个页面再做第二套助手。隐藏不是永久删除，只是当前上下文不展示；引擎字段仍在注册表里，换到自由搜索还能用。

下面 3 个例子说明为什么必须隐藏，以及怎么设计。

| 例子 | 出现位置 | 不该出现的能力 | 为什么 | 设计 |
| --- | --- | --- | --- | --- |
| 1. 查重/改名范围 vs 自由搜索 | DuplicatePane / RenamePane 的范围框 | `dup:true` / `dup:false` | 查重结果已经是重复组；再插 `dup:` 对范围几乎无意义，还容易让人以为自己在「再筛一遍重复」。改名范围跟重复标记也无关。 | 范围框用 `scope-filter`。同一套弹层，目录去掉 `dup` 分组，突出 `kind` / `ext` / `size` / 空目录 / 唯一视频。顶栏和 Spotlight 的 `search` 仍保留 `dup:`。 |
| 2. 改名模板 vs 搜索框 | 工作台改名分组、规则方案模板 | `AND` / `OR`、`mtime:today`、`kind:video` | 模板要的是 `{name}`、`.trim()`、`{children.main_video.stem}`。把搜索语法插进模板，渲染结果是字面量，文件名会变成 `mtime:today.mp4`。 | 模板框用 `rename-template`。同一套弹层，只出字段、链式函数、snippet、capture。搜索字段和操作符整组隐藏。 |
| 3. 组装 Dialog 的 `mtime` 行 vs 自由搜索 | RuleBuilderDialog 已选字段的值输入 | 「视频」「空目录」「AND」 | 这一行的字段已经由左侧下拉钉死。点「视频」会生成 `mtime:video`，查不到预期文件。点「空目录」还会变成 `mtime:kind:dir AND ...`。 | 值行用 `search-field:mtime`。同一套弹层，只出该字段的值、比较式、相对日期。跨字段配方和操作符禁用。 |

最终方案（已落地）：

1. 一套 `InputAssistantPopover` + 一份 catalog，所有页面复用。
2. 用 `context` 决定分组显隐；Dialog 值行再叠加 `searchField`。
3. 改名分组匹配条件不要继续叫 `duplicate-filter`，改成 `rename-group-filter`，它是 `scope-filter` 的子集：突出 `kind` / `ext` / 空目录 / 唯一视频 / 纯数字名，继续隐藏 `dup:`。
4. Dialog 从目录顶部「按字段组装」进入，不占用火花按钮的默认含义。
5. 灰掉不如直接不展示。当前上下文插进去会变成非法语法的项，不要出现在列表里。

不推荐：顶栏继续开 Dialog、Spotlight 继续开目录；也不推荐查重页单独做一套「查重助手」。那会把魔法棒重新拆开。现在顶栏和 Spotlight 的火花都打开同一套弹层，Dialog 只从弹层顶部「按字段组装」进入。

## 7. 缺什么

按优先级，先补“能用对”，再补“能看见”，最后才补新能力。

### P0 对齐，不新增能力

已完成，见第 16 节。

1. `itemsForContext(context, field)` 真正过滤。
2. Dialog `SEARCH_FIELDS` / `COMPARISON_FIELDS` 与 `FILTER_KEYS` 对齐。
3. 链式函数按光标挂载。
4. Dialog 读入已有值，禁止重置。
5. 修正 `{ancestor(-1)}` 标签；范围上下文去掉 `dup:`。
6. 所有火花按钮都打开同一套输入助手弹层；顶栏和规则方案模板不再把火花按钮直接绑到 Dialog。宿主搜索框保持独立。
7. 用测试锁住 catalog 与引擎的包含关系。

### P1 让已有能力可感知

已完成：试算、插入预览、常用配方、参数表单、最近 8 条、`parent:` / `path:` 快捷项、`name_length` 真正按字段插入。

1. 改名对当前选中文件做一行试算。
2. 搜索插入后在弹层里显示完整 query。
3. 常用配方：空目录、仅视频、大于 10MB、文件名纯数字、带字幕、最近 7 天。
4. 参数化插入：`replace` `regex_replace` `pad` `prefix` `slice` `before` `between`。
5. 最近使用的 8 条。
6. 补 `parent:` `path:` 快捷项。
7. 把 `name_length` 从 `text` 配方改成真正的 `name_length` 字段项。

### P2 补搜索引擎缺口，目录才能跟着亮

已完成：

1. `ctime:` 创建时间，与改名的 `date_created` 对齐。
2. `has:nfo` `has:cover` `has:sidecar`，与 sidecar SQL 同一套判断。
3. `unique_video:true` / `useful_file_count:=1`，服务「用唯一视频给文件夹改名」。
4. `NOT` 与 `-term`；完整括号分组仍后置。
5. Dialog 比较字段已含 `ctime` / `useful_file_count` / 目录统计。
6. 搜索再补 `same_stem` / `orphan_sidecar` / `windows_illegal` / `is_sidecar`。
7. 改名再补 `if_contains` / `max_len` / `take_parent_if_numeric` / `take_grandparent_if_cd` / `ensure_ext`。

### P3 新函数与新媒体字段

P2 已落地。P3 仍不做媒体字段、LLM、`if_kind`、`hash8`。见第 11.3 节。

## 8. 怎么改

1. 在 core 增加 assistant 注册表，先把现有 `SEARCH_ITEMS` / `RENAME_ITEMS` / `RENAME_CHAINS` 搬过去，标上 `type` `contexts` `engine` `insert`。
2. 给每个条目加 `status: live | hidden | broken`。broken 项本轮直接下线或改到能跑。
3. 改 `itemsForContext`：按 context + field + type 过滤。
4. 改 `insertChain`：从光标向左找包围光标的 `{...}`；找不到再 fallback 到 `{name}`。
5. Dialog 字段表改为 `catalog.searchFields`；比较运算符由字段的 `valueType` 决定。
6. `MagicWandInput` 改为给现有宿主输入框挂上同一套 `InputAssistantPopover`；Dialog 只作为目录里的高级组装，不再是火花按钮的默认行为。不要把顶栏搜索和 Spotlight 收成同一个输入框。
7. 预览：改名调用已有 `renderTemplate(template, buildRuleContext(selected))`；搜索只展示规范化 query。
8. 加契约测试：解析 catalog 里每条 live 搜索项，断言 `parseSearchQuery` 能认出对应 filter；对每条 chain 调 `applyChain`；对每个 rename field 调 `getContextValue`。
9. 文档：已回写 [01-six-core-modules.md](./01-six-core-modules.md) 的占位符和函数表，删除过期 v1 短列表。完整能力表仍以本 TRD 第 9-11、14 节为准。

不建议：继续在 `input-assistant-catalog.ts` 手工追加条目；继续让 Dialog 自己维护 `PLACEHOLDERS`；把顶栏搜索和 Spotlight 合成一个控件。

## 9. 能力类型

输入助手最终不只是“字段 + 函数”。建议把可插入物分成下面这些类型。UI 用类型决定图标、是否要填参数、插入策略、以及能不能出现在当前上下文。

| 类型 | 含义 | 当前有没有 | 最终怎么用 |
| --- | --- | --- | --- |
| `field` | 改名占位符或搜索字段名 | 有，但两套表 | 改名插入 `{name}`，搜索插入 `ext:` 这类前缀 |
| `value` | 某字段的示例值 | 有 | `today`、`video`、`10MB` |
| `comparison` | 比较式 | 混在 value 里 | `>10MB`、`1MB..10MB`、`>=10` |
| `relative-date` | 相对日期词 | 有，仅 mtime | 以后同时服务 `mtime` / `ctime` |
| `date-pattern` | 名字/路径里的日期格式 | 有 | `yyyy-MM-dd`、`yyyyMMdd` |
| `operator` | 查询连接 | 仅 AND/OR | 以后加 NOT；Dialog 行间仍用下拉 |
| `recipe` | 一整段可跑的查询或模板 | 有，但标成了 `text` | 空目录、唯一视频文件夹、`{name.trim()}{ext}` |
| `chain` | 改名链式函数 | 有 | 挂到当前 `{field}` |
| `parameterized-chain` | 需要用户填参再插入的函数 | 无，现在留下中文占位 | `replace` `regex_replace` `pad` |
| `snippet` | 多字段模板片段 | 无 | `{parent}/{name}{ext}`、`{seq.pad(3,'0')}_{name}{ext}` |
| `capture` | 从当前名提取一段再参与改名 | 无 | 季集、分辨率、年份、第一个数字 |
| `condition` | 按字段或内容走不同结果 | 无 | 纯数字文件名则用父目录 |
| `sidecar` | 伴随文件关系 | 仅 `has:subtitle` | nfo / 封面 / 字幕 / 任意 sidecar |
| `stats` | 目录统计 | 搜索和改名各写了一份 | `child_count` 与 `{children.count}` 同源描述 |
| `sequence` | 计划内序号 | 改名有 | `{seq}` `{parent_seq}`，可带 pad 配方 |
| `preview-sample` | 用当前文件试算 | 无 | 不插入文本，只驱动预览条 |
| `recent` | 最近用过的条目 | 无 | 按库或全局记 8 条 |
| `media-field` | 宽高、时长、编码 | 无，引擎也没有 | P3，未进索引前禁止出现在目录 |
| `collision` | 目标重名时怎么处理 | 无 | 插入 ` (1)`、日期后缀，或只出现在预览条旁的策略选择 |
| `scope-token` | 当前范围本身 | 无 | `in:this_dir`、`depth:<=1`，让范围过滤不依赖页面状态 |
| `pair` | 成对文件关系 | 无 | 同名 nfo/封面/字幕，给 sidecar 改名或排除 |
| `path-part` | 路径某一层 | 仅 `{ancestor(-1)}` 且标签错 | `{ancestor(1)}` `{rel_parent}`，按层取目录名 |
| `case-map` | 中英/全半角对照表 | 无 | 全角数字、中文标点到半角的专项替换 |
| `quality-tag` | 片源标签抽取/归一 | 无 | `1080p/4K/BluRay/WEB-DL` 统一成一套后缀 |
| `folder-policy` | 文件夹专用模板策略 | 无 | 目录不加 `{ext}`；唯一视频跟文件夹同名 |

新增类型时先问两个问题：有没有引擎字段/函数托住它？当前上下文插进去会不会变成合法语法？两个都否，就不要进目录。

## 10. 现有链式函数

以下函数已经在 `applyChain` 里实现，目录也基本都有。统一后保留，但要补参数表单和适用字段。`类型` 指助手里的能力类型，不是 TypeScript 类型。

| 函数名 | 类型 | 作用说明 | 场景效果 |
| --- | --- | --- | --- |
| `trim` | chain / 清理 | 去掉首尾空白 | `"  阿凡达  "` -> `阿凡达` |
| `collapse_space` | chain / 清理 | 连续空白压成单空格 | `阿凡达   2009` -> `阿凡达 2009` |
| `remove_space` | chain / 清理 | 删除全部空白 | `A B` -> `AB` |
| `sanitize` | chain / 清理 | 替换 Windows 非法文件名字符，去掉尾部点/空格 | `a:b?` -> `a_b_` |
| `remove_ads` | chain / 清理 | 去掉网址和「广告」类括号 | `电影www.xx.com` -> `电影` |
| `dedupe` | chain / 清理 | 按字符去重，不是按词 | `aabb` -> `ab`，多数改名场景要慎用 |
| `normalize` | chain / 清理 | Unicode NFKC，全角转半角一类 | `Ａｖａｔａｒ` -> `Avatar` |
| `remove_punctuation` | chain / 清理 | 去掉中英文标点 | `阿凡达：重返` -> `阿凡达重返` |
| `remove_brackets` | chain / 清理 | 只删括号字符，保留里面的字 | `[4K]阿凡达` -> `4K阿凡达` |
| `replace` | parameterized-chain / 替换 | 字面量替换 | `旧文字` 换成 `新文字` |
| `regex_replace` | parameterized-chain / 替换 | 正则全局替换 | `\[.*?\]` 换成空，去掉 `[4K]` |
| `spaces_to_underscore` | chain / 替换 | 空白改下划线 | `The Matrix` -> `The_Matrix` |
| `underscore_to_space` | chain / 替换 | 下划线/短横改空格 | `The_Matrix` -> `The Matrix` |
| `upper` | chain / 大小写 | 全大写 | `avatar` -> `AVATAR` |
| `lower` | chain / 大小写 | 全小写 | `Avatar` -> `avatar` |
| `title` | chain / 大小写 | 每个词首字母大写 | `the matrix` -> `The Matrix` |
| `capitalize` | chain / 大小写 | 仅首字母大写 | `avatar` -> `Avatar` |
| `snake_case` | chain / 大小写 | 词边界转下划线小写 | `TheMatrix` -> `the_matrix` |
| `kebab_case` | chain / 大小写 | 词边界转短横小写 | `TheMatrix` -> `the-matrix` |
| `camel_case` | chain / 大小写 | 小驼峰 | `the matrix` -> `theMatrix` |
| `pascal_case` | chain / 大小写 | 大驼峰 | `the matrix` -> `TheMatrix` |
| `constant_case` | chain / 大小写 | 大写下划线 | `the matrix` -> `THE_MATRIX` |
| `length` | chain / 计量 | 返回字符数 | 很少直接当文件名，适合进条件前先看长度 |
| `slice` | parameterized-chain / 截取 | `slice(start,end)` 或 `slice(-n)` | 前 10 字、后 10 字、从第 3 字起 |
| `truncate` | parameterized-chain / 截取 | 超长截断并加省略号 | 超长标题压到 10 字 |
| `repeat` | parameterized-chain / 截取 | 整段重复，最多 20 次 | 几乎只用于分隔符，不适合整文件名 |
| `reverse` | chain / 截取 | 按字符反转 | 演示性强，整理场景弱 |
| `first_word` | chain / 截取 | 第一个词 | `Avatar 2009` -> `Avatar` |
| `last_word` | chain / 截取 | 最后一个词 | `Avatar 2009` -> `2009` |
| `initials` | chain / 截取 | 各词首字母大写拼接 | `The Matrix` -> `TM` |
| `insert` | parameterized-chain / 截取 | 在指定位置插入文字 | 第 0 位插入前缀 |
| `keep_digits` | chain / 筛选 | 只留数字 | `IMG_012` -> `012` |
| `remove_digits` | chain / 筛选 | 去掉数字 | `IMG_012` -> `IMG_` |
| `keep_letters` | chain / 筛选 | 只留字母 | `Avatar2009` -> `Avatar` |
| `remove_letters` | chain / 筛选 | 去掉字母 | `Avatar2009` -> `2009` |
| `keep_alnum` | chain / 筛选 | 只留字母数字 | `A-1!` -> `A1` |
| `keep_ascii` | chain / 筛选 | 只留可见 ASCII | 去掉中文、emoji |
| `extract_year` | chain / 抽取 | 抓第一个 19xx/20xx | `阿凡达.2009.1080p` -> `2009` |
| `before` | parameterized-chain / 抽取 | 某段之前 | `S02E07 - 标题` 在 ` - ` 之前 -> `S02E07` |
| `after` | parameterized-chain / 抽取 | 某段之后 | 同上之后 -> `标题` |
| `between` | parameterized-chain / 抽取 | 两段之间 | `[4K]` 取 `4K` |
| `pad` / `pad_start` | parameterized-chain / 补齐 | 左侧补齐 | `{seq.pad(3,'0')}` -> `007` |
| `pad_end` | parameterized-chain / 补齐 | 右侧补齐 | 较少用于文件名 |
| `prefix` | parameterized-chain / 补齐 | 无条件加前缀 | `IMG_` + 原名 |
| `suffix` | parameterized-chain / 补齐 | 无条件加后缀 | 原名 + `_final` |
| `ensure_prefix` | parameterized-chain / 补齐 | 没有该前缀才加 | 避免 `IMG_IMG_1` |
| `ensure_suffix` | parameterized-chain / 补齐 | 没有该后缀才加 | 避免重复 `_final` |
| `remove_prefix` | parameterized-chain / 补齐 | 去掉指定前缀 | `IMG_1` -> `1` |
| `remove_suffix` | parameterized-chain / 补齐 | 去掉指定后缀 | `名_副本` -> `名` |
| `if_empty` | parameterized-chain / 条件 | 当前值为空时用默认值 | 父目录缺失时用 `未命名` |
| `format_size` | chain / 格式 | 把字节数格式化成 KB/MB | `{size.format_size()}` -> `1.2GB`；用在非数字上是 `0B` |
| `if_contains` | parameterized-chain / 条件 | 包含某词则整段替换，否则保持 | `Avatar 4K` -> `[4K]` |
| `max_len` | parameterized-chain / 截取 | 按字符或路径剩余长度截断，不加省略号 | 避免目标路径超长被计划器打回 |
| `take_parent_if_numeric` | chain / 条件 | 当前名纯数字则改用父目录 | `1.mp4` 所在 `阿凡达/` -> `阿凡达` |
| `take_grandparent_if_cd` | chain / 条件 | 父目录或当前名是 CD/DISC 层时改用祖父目录 | `阿凡达/CD1` -> `阿凡达` |
| `ensure_ext` | chain / 补齐 | 模板忘记 `{ext}` 时补回原扩展名 | `Avatar` -> `Avatar.mkv` |

现有目录里还有两条配方型 chain，不是独立函数：

| 函数名 | 类型 | 作用说明 | 场景效果 |
| --- | --- | --- | --- |
| `regex_replace('[\\(\\[][^\\)\\]]*\\)', '')` | recipe / 替换 | 去掉半角括号及内容 | `(CD1)` `[4K]` 一类标签 |
| `slice(2)` | recipe / 截取 | 从第 3 个字符起 | 去掉两位前缀 |

## 11. 建议补的能力

先补引擎能很快托住、文件治理里反复出现的。带 `需引擎` 的不能只改目录。v0.5 已把第 11.1 / 11.2 里不依赖媒体索引、LLM、规则 VM 的项落地；仍标 `需引擎` 但未进第 11.3 的，以第 16 节为准。

### 11.1 改名函数与片段

| 函数名 | 类型 | 作用说明 | 场景效果 |
| --- | --- | --- | --- |
| `remove_bracket_content` | chain / 清理 | 去掉 `[]` `()` `【】` 及其内容，比只删括号字符更符合下载文件 | `[4K]阿凡达(国语)` -> `阿凡达` |
| `remove_copy_suffix` | chain / 清理 | 去掉 ` - 副本`、`(1)`、`- Copy` | `照片 - 副本 (2)` -> `照片` |
| `collapse_dots` | chain / 清理 | 点分隔文件名改空格，扩展名仍由 `{ext}` 负责 | `The.Matrix.1999` -> `The Matrix 1999` |
| `strip_ext_in_name` | chain / 清理 | 去掉 stem 里误带的 `.mp4` `.jpg` | 解压后 `movie.mp4.mp4` 的 stem 清理 |
| `extract_number` | capture | 第一个连续数字 | `IMG_7` -> `7`，再 `.pad(3,'0')` -> `007` |
| `extract_last_number` | capture | 最后一个连续数字 | `课.1.期末.12` -> `12` |
| `pad_number` | parameterized-chain / 补齐 | 抽出数字并补齐，非数字部分可配保留或丢弃 | `2.mp4` 一批 -> `002` `003` |
| `extract_resolution` | capture | 抓 `720p` `1080p` `2160p` `4K` `8K` | 做后缀或单独目录名 |
| `extract_season_episode` | capture | 抓 `S01E02` / `1x02` / `第02集` | 剧集统一成 `S01E02` |
| `extract_episode` | capture | 只留集数并 pad | `E7` -> `07` |
| `remove_year` | chain / 筛选 | 去掉独立的 19xx/20xx | `阿凡达.2009` -> `阿凡达` |
| `extract_date` | parameterized-chain / 抽取 | 从名字抓 `yyyyMMdd` / `yyyy-MM-dd` 再格式化 | `20240102_IMG` -> `2024-01-02` |
| `match` | parameterized-chain / 抽取 | 正则第一个捕获组 | `match('【(.+?)】')` 取书名号里的名 |
| `nth_word` | parameterized-chain / 截取 | 第 n 个词，负号从后数 | 取片名第一个词或最后一个日期词 |
| `split_at` | parameterized-chain / 截取 | 按分隔符取第 n 段 | `A-B-C` 取 `B` |
| `wrap` | parameterized-chain / 补齐 | 左右包裹 | `4K` -> `[4K]` |
| `ensure_ext` | condition | 模板忘记 `{ext}` 时补回原扩展名 | 防止文件变成无后缀 |
| `take_parent_if_numeric` | condition | 当前 `{name}` 纯数字则改用 `{parent}` | `1.mp4` 所在 `阿凡达/` -> `阿凡达` |
| `take_main_child` | field / snippet | 插入 `{children.main_stem}` 或 `{children.main_video.stem}` | 文件夹跟唯一视频改成同名 |
| `seq_pad3` | snippet | `{seq.pad(3,'0')}` | 批量序号 |
| `clean_download_name` | recipe / 模板 | `trim + remove_ads + remove_bracket_content + collapse_space` 的一键链 | 下载电影名清洗 |
| `if_contains` | condition | 包含某词则替换，否则保持 | 有 `4K` 才加 `[4K]` |
| `if_kind` | condition / 需引擎 | 按 file/dir/video 选不同模板片段 | 目录不加 `{ext}`，视频才加分辨率 |
| `hash8` | field / 需引擎 | 用 `hash_quick` 前 8 位 | 同名冲突时稳定后缀，不靠人工 seq |
| `max_len` | parameterized-chain / 截取 | 按 Windows 路径剩余长度截断，不加省略号 | 避免目标路径超长被计划器打回 |
| `remove_emoji` | chain / 筛选 | 去掉 emoji 和部分符号 | 部分文件系统不吃 emoji |
| `to_halfwidth` | chain / 清理 | 明确全角数字/字母转半角；`normalize` 的专项版 | `２００９` -> `2009` |
| `zh_simplify` | chain / 本地化 / 可选 | 繁体转简体 | 华语资源统一简体库 |
| `pinyin_initials` | chain / 本地化 / 可选 | 中文名转拼音首字母 | 英文排序盘或照片前缀 |
| `now_compact` | snippet | `{now:yyyyMMdd-HHmmss}` | 备份副本名 |
| `remove_edition_tags` | chain / 清理 | 去掉 `BluRay` `WEB-DL` `REPACK` `HDR` 一类发行标签 | 下载文件只留片名和年份 |
| `normalize_resolution` | capture | `2160p`/`4K`/`UHD` 归一成 `2160p` | 同一批片子后缀一致 |
| `extract_source` | capture | 抓 `BluRay` `WEB-DL` `HDTV` `DVDRip` | 做分类目录或后缀 |
| `zh_space_fix` | chain / 本地化 | 中英文之间补或去空格 | `阿凡达2009` -> `阿凡达 2009` |
| `filename_safe_colon` | chain / 清理 | 把 `:` 改成全角 `：` 或 `-`，专治剧集名 | `S01E02: 标题` 能过 Windows |
| `take_grandparent_if_cd` | condition | 当前父目录是 `CD1`/`DISC1` 时改用祖父目录 | 多碟电影夹名不被 CD 层带走 |
| `sibling_index` | sequence / 需引擎 | 按当前目录现有文件算下一个序号 | 不依赖本次计划的 `{seq}` |
| `collision_suffix` | collision / 需引擎 | 目标已存在时自动加 ` (1)` 或日期 | 预览就能看见，而不是执行时报冲突 |
| `dir_without_ext` | folder-policy / snippet | 目录模板只用 `{name}`，不插 `{ext}` | 避免文件夹变成 `阿凡达.mp4` |
| `folder_follow_main_video` | folder-policy / snippet | `{children.main_video.stem}` | 文件夹跟唯一视频改成同名 |
| `keep_extension_case` | chain | 扩展名大小写保持原样 | `{ext.lower()}` 不误伤 `.JPG` 相机文件 |

`if_kind`、`hash8`、`sibling_index`、`collision_suffix` 没有对应取值或模板条件前，只许出现在规则 VM 或计划器，不允许先进输入助手。

### 11.2 搜索字段、值与配方

| 函数名 | 类型 | 作用说明 | 场景效果 |
| --- | --- | --- | --- |
| `parent` | field | 所在目录名/路径片段 | `parent:下载` |
| `path` | field | 完整路径包含 | `path:电影库/阿凡达` |
| `ctime` | field / 需引擎 | 创建时间，语法与 `mtime` 相同 | `ctime:last_7_days` |
| `name_length` | field | 文件名长度比较 | `name_length:>=10`，不要再当 text 配方 |
| `name_digits` | field | `true` 全数字，`any` 含数字 | 找出 `1.mp4` `2.mp4` |
| `child_count` `file_count` `dir_count` | stats | 目录统计比较 | Dialog 和自由搜索都能选 |
| `unique_video` | stats / 需引擎 | 目录内有效视频恰好 1 个 | 给「文件夹跟视频改名」圈范围 |
| `useful_file_count` | stats / 需引擎 | 忽略字幕/封面/nfo 后的文件数 | 与改名 `{children.useful_file_count}` 对齐 |
| `has:subtitle` | sidecar | 同目录同 stem 字幕 | 现已生效 |
| `has:nfo` | sidecar / 需引擎 | 同 stem `.nfo` | 影视库缺资料 |
| `has:cover` | sidecar / 需引擎 | 同目录封面图 | `cover.jpg` / 同名 jpg |
| `has:sidecar` | sidecar / 需引擎 | 任意伴随文件 | 找主文件 |
| `missing:subtitle` | sidecar / 需引擎 | `has` 的否定形式，或 `NOT has:subtitle` | 缺字幕的视频 |
| `is_sidecar` | sidecar / 需引擎 | 当前条目自己是字幕/nfo/封面 | 改名范围排除 sidecar |
| `empty_dir` | recipe | `kind:dir AND child_count:=0` | 查空文件夹 |
| `leaf_dir_with_files` | recipe | `kind:dir AND file_count:>=1 AND dir_count:=0` | 最底层整理 |
| `nested_dir` | recipe | `kind:dir AND dir_count:>=1` | 套娃目录 |
| `large_video` | recipe | `kind:video AND size:>1GB` | 占空间的片子 |
| `tiny_file` | recipe | `kind:file AND size:<16KB` | 空头文件、下载残留 |
| `recent_media` | recipe | `(kind:video OR kind:image) AND mtime:last_7_days` | 最近下的 |
| `numeric_names` | recipe | `name_digits:true` | 批量用父目录改名的候选 |
| `quoted_phrase` | parameterized-chain / 搜索 | 弹出输入，插入 `"..."` | 现在的「完整短语示例」应改成这个 |
| `NOT` | operator / 需引擎 | 否定下一个 token 或括号组 | `kind:video NOT has:subtitle` |
| `-term` | operator / 需引擎 | 文本排除 | `-sample -trailer` |
| `ext_set` | value | 现有 `mp4|mkv|...` 保留 | 按类型一组扩展名 |
| `dup` | field | 仅自由搜索保留 | 范围过滤上下文隐藏 |
| `same_stem` | pair / 需引擎 | 当前目录里有同 stem 的其它文件 | 找主视频及其 sidecar |
| `orphan_sidecar` | recipe / 需引擎 | sidecar 没有对应主文件 | 清残留 `.nfo` `.jpg` `.srt` |
| `cd_folder` | recipe | `kind:dir AND (name:CD1 OR name:DISC1)` | 多碟目录单独处理 |
| `windows_illegal` | recipe / 需引擎 | 名称含 `:` `?` `*` 或尾部点/空格 | 先找出不能改名成功的文件 |
| `too_long_name` | recipe | `name_length:>=150` | Windows 路径剩余长度预警 |
| `hidden_or_system` | field / 需引擎 | 隐藏/系统文件 | 范围里默认排除 |
| `in_this_dir` | scope-token | 仅当前目录，不含子孙 | 查重/改名范围默认就该这样 |
| `direct_children` | scope-token | 只要一层 | 和目录树预览对齐 |

### 11.3 明确先不做

| 函数名 | 类型 | 不做的原因 |
| --- | --- | --- |
| LLM 起名 | recipe | 产品需求已规定第一版不用大模型起文件夹名 |
| `exif_date` `duration` `width` `height` `codec` | media-field | 索引里还没有稳定媒体信号，目录先画出来会全是空结果 |
| 任意括号表达式编辑器 | operator | 先把 AND/OR/NOT 做对；完整表达式属于规则 VM |
| `foreach` / `scope.last.*` | field | 这是规则步骤链变量，不是一行模板助手该暴露的全部 VM |
| `pinyin` 全拼、翻译 | 本地化 | 依赖重，收益窄，放到可选插件 |
| 再加 20 个大小写变体 | chain | 现有 5 种 case 已够 |
| `exif_gps` / 相机型号 | media-field | 索引没有；照片整理第二阶段再做 |
| 输入助手里直接选「删除/隔离」 | recipe | 助手只生成查询或模板，不执行破坏性操作 |

## 12. 验收

统一完成的标志不是目录更长，而是下面这些行为：

1. 顶栏搜索、Spotlight、查重范围、改名范围、改名模板，魔杖打开的是同一套输入助手弹层。顶栏搜索框和 Spotlight 输入框仍然是两套宿主控件。
2. 组装 Dialog 选 `mtime` 时，目录里只剩日期值；点「视频」不再生成 `mtime:video`。
3. `{parent}/{name}{ext}` 中光标在 `{name}` 内再点 `.trim()`，结果是 `{parent}/{name.trim()}{ext}`。
4. 打开改名组装 Dialog 时，看到的是当前模板，不是被重置的 `{name}{ext}`。
5. 点「空目录」「带字幕」「今天」都能被 `parseSearchQuery` 识别，对应 SQL 不是恒假。
6. 选中一个文件时，改名助手底部能看到试算结果。
7. catalog 契约测试通过：没有 live 条目指向引擎不认识的字段或函数。
8. 查重范围目录里不再出现 `dup:true`。
9. 改名模板目录里不再出现 `AND` / `OR` / `mtime:today`。
10. 组装 Dialog 的 `mtime` 行不再出现「视频」。

## 13. 建议落地顺序

1. 注册表搬家 + 过滤 + 光标挂链 + Dialog 对齐。已完成。
2. 同一套魔法棒弹层、预览条、配方、参数表单、问号帮助。已完成。宿主搜索框不合并。
3. `ctime` / `has:nfo|cover` / `unique_video` / `NOT` / `useful_file_count` / `same_stem` / `orphan_sidecar`。已完成。
4. `remove_bracket_content`、`take_parent_if_numeric`、`ensure_ext`、季集/分辨率抽取。已完成。

能力类型可以一次设计好，条目按这个顺序往注册表里加。没有引擎托底的类型，目录里不要提前出现。P3 媒体字段和 LLM 仍不做。

## 14. 现有搜索字段与改名字段

链式函数见第 10 节。下面把当前已经能取值、但目录覆盖不齐的字段也列成同一张表，避免只补函数不补字段。

### 14.1 搜索字段

| 函数名 | 类型 | 作用说明 | 场景效果 |
| --- | --- | --- | --- |
| `text` | field | 自由文本，走 FTS / n-gram / LIKE | 输入框里直接打片名 |
| `phrase` | value | 带引号的完整短语 | 现在的「完整短语示例」应改成这个 |
| `ext` | field | 扩展名，支持 `|` 集合 | `ext:mp4|mkv` |
| `kind` / `type` | field | 文件/目录/视频/图片等 | `kind:dir` |
| `parent` | field | 所在目录名或路径片段 | 目录有字段，助手缺快捷项 |
| `dir` | field | 目录路径过滤 | 引擎有，目录几乎没露出 |
| `path` | field | 完整路径包含 | 同上 |
| `size` | comparison | 字节大小，支持 KB/MB/GB 和区间 | `size:>10MB` |
| `mtime` | relative-date | 修改时间 | `mtime:today` |
| `ctime` | relative-date | 创建时间 | `ctime:today` / `ctime:last_7_days` 已生效 |
| `depth` | comparison | 相对库根的层级 | `depth:<=3` |
| `name_date` / `path_date` / `date_pattern` | date-pattern | 名字或路径里的日期格式 | `yyyy-MM-dd` `yyyyMMdd` |
| `name_length` | comparison | 文件名长度 | 目录误标成 `text` 配方 |
| `name_digits` | value | `true` 全数字，`any` 含数字 | 找出 `1.mp4` |
| `child_count` `file_count` `dir_count` | stats | 目录统计 | Dialog 比较字段还没接上 |
| `has` | sidecar | `subtitle` / `nfo` / `cover` / `sidecar` | 与 `missing:`、`is_sidecar` 对齐 |
| `dup` | field | 索引里的重复标记 | 只该出现在自由搜索 |

### 14.2 改名字段

| 函数名 | 类型 | 作用说明 | 场景效果 |
| --- | --- | --- | --- |
| `{name}` / `{stem}` / `{filename}` | field | 不含扩展名 / 主干 / 完整名 | 模板起点 |
| `{ext}` / `{ext_no_dot}` | field | 扩展名 | 文件模板几乎必带 |
| `{parent}` / `{grandparent}` / `{ancestor(n)}` | path-part | 向上取目录名 | `{ancestor(-1)}` 标签当前是错的 |
| `{drive}` / `{root}` / `{path}` / `{relPath}` | field | 盘符、库根、绝对/相对路径 | 做分类目录 |
| `{size}` / `{kind}` / `{is_dir}` / `{depth}` | field | 大小、类型、是否目录、层级 | `format_size()` 只该挂在 `{size}` |
| `{children.*}` | stats | 子项/视频/有效文件/主文件 | 文件夹跟唯一视频改名 |
| `{children.main_stem}` / `{children.main_video.*}` | field | 主文件/主视频更精确的取值 | 目录有缺口 |
| `{peer_dir.exists}` | pair | 同名目录在不在 | 文件旁是否已有文件夹 |
| `{seq}` / `{parent_seq}` | sequence | 本次计划序号、目录内序号 | 批量 `001` `002` |
| `{now}` / `{date_created}` / `{date_modified}` | field | 当前时间、创建、修改 | 日期字段必须进 `DATE_FIELDS`；`{mtime:yyyy}` 现在输出时间戳 |

## 15. 查重页已去掉「执行删除」

查重页不再提供「执行删除」。结果区只做检查：分组里切换保留/删除，徽章显示「将隔离 N 份」。分析端默认 `dispose: 'quarantine'`，生成的 Change Plan 是隔离，不是 `op: delete`。

以前卡死转圈，不是因为直接 `unlink`。旧链路是：

```text
生成 delete 计划
  -> 整单校验
  -> 系统回收站 / 被 validator 拒绝
  -> 索引 tombstone
  -> 立刻全库搜索刷新
```

用户看到 `op 0: delete is disabled; use quarantine`，是执行前整表校验失败。[validator.ts](../packages/core/src/plan/validator.ts) 在没有 `allowDelete` 时拒绝任何 `delete`。查重页把按钮做成删除、分析端又写死 `delete`，和产品「先隔离」对不上，才会又慢又报错。

现在这条破坏性路径已经从查重页拿掉。规则方案和改名页仍走各自的执行器；输入助手继续只生成查询或模板，不执行删除或隔离。

如果以后要重新打开查重处置，必须单独做，且默认仍是隔离：

1. 按钮文案和真实 op 一致：「移入隔离区」，不要再写「执行删除」。
2. 校验只加载本次选中的条目，禁止全库扫表。
3. 执行按文件进度回报，不要用一个无限转圈挡住整个工作台。
4. 执行后只刷新受影响目录/tombstone，不要立刻做全库搜索。



## 16. 落地结果

P0、搜索 P1、搜索 P2、改名 P2 已按第 6、7、11 节落地。第 11 节表格仍保留蓝图项，但下面「已完成」才是当前目录和引擎的真相。顶栏搜索和 Spotlight 继续不是同一控件。

已完成：

1. 关键词空格默认 OR，过滤器继续 AND。`Avatar Poster` 是 OR；`Avatar AND Poster` 才要求同时命中；`Avatar Poster ext:mkv` 是 `(Avatar OR Poster) AND ext:mkv`。
2. 目录从 renderer 的 `input-assistant-catalog.ts` 搬到 [packages/core/src/assistant/](../packages/core/src/assistant/)。renderer 只通过 `@nestify/assistant` 使用，不从 `@nestify/core` 根入口导入。
3. 所有魔法棒打开同一套 [MagicParameterInput.tsx](../apps/desktop/src/components/rules/MagicParameterInput.tsx)。`MagicWandInput` 只是薄封装，默认弹出目录；`RuleBuilderDialog` 是高级组装。
4. 上下文：`search`、`search-field`、`scope-filter`、`rename-group-filter`、`rename-template`。查重/改名范围隐藏 `dup:`；改名模板隐藏搜索语法；Dialog 的 `mtime` 行不再出现「视频」。
5. 链式函数按光标挂到当前 `{...}`。Dialog 打开时解析已有查询/模板，不再重置。
6. 改名弹层底部有试算。工作台有当前文件时用当前文件；否则用样本 `Avatar.mkv`。
7. 契约测试锁定 catalog 是引擎子集：搜索项能被 `parseSearchQuery` 认出，链式函数能被 `applyChain` 执行，改名字段能被 `getContextValue` 读到。
8. [01-six-core-modules.md](./01-six-core-modules.md) 的 v1 占位符/函数短列表改为指向助手 catalog 和本 TRD，不再当第二份目录。
9. 每条目录名称旁边有问号，悬停显示用法和效果例子；点问号不会插入。
10. 搜索已生效：`ctime`、`has:nfo|cover|sidecar`、`missing:`、`unique_video`、`useful_file_count`、`is_sidecar`、`same_stem`、`orphan_sidecar`、`windows_illegal`、一元 `NOT` / `-term`。
11. 改名已生效：`remove_bracket_content` 等清洗链，以及 `if_contains`、`max_len`、`take_parent_if_numeric`、`take_grandparent_if_cd`、`ensure_ext`。
12. 查重页去掉「执行删除」。结果区只检查保留/删除，生成计划是隔离。

还没进助手、也不该现在画出来：`if_kind`、`hash8`、`sibling_index`、`collision_suffix`、媒体字段、LLM、删除/隔离操作、任意括号表达式编辑器。这些要等对应引擎或规则 VM，见第 11.3 节。
