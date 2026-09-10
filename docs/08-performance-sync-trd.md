# Nestify 百万级搜索与增量同步 TRD

> 文档版本：v0.4
> 状态：P0-P3 基础实现已完成；schema 已升级到 v7，100k/1M SQLite 基准中热缓存主线场景达到当前阶段目标，中文仍只达到 200ms 阶段目标；物理冷缓存、真实 Worker 并发、3M/10M、SMB 与 watcher overflow 尚未验收，P4 搜索索引决策待完成
> 日期：2026-09-10
> 适用范围：桌面启动性能、文件索引查询、全文/模糊搜索、目录树加载、文件系统增量同步

## 1. 摘要

当前应用启动显示“未响应”的直接原因不是数据库打开或迁移，而是 Renderer 在启动后自动发起全库空搜索。空搜索对约 52 万条记录执行精确总数、文件/目录统计、类型分组和排序列表，查询通过 `DatabaseSync` 在 Electron Main 主线程同步执行，最终阻塞窗口事件循环。

当前数据库已经有两类文本索引：

- `entry_fts`：FTS5 外部内容全文索引。
- `name_trigrams`：文件名 n-gram 倒排表；英文/拉丁文本使用三元 gram，中文名称额外使用单字和二元 gram，以覆盖单字、短中文词和相邻字符查询。

但索引并不能覆盖当前全部性能问题。搜索还受到查询起点、`library_entries` 关联方向、重复统计、临时排序、路径规范化函数以及主进程同步执行的影响。

本 TRD 的总体方案是：

```text
首屏懒加载
  + 专用目录查询
  + 结果与统计分离
  + 按库复合索引
  + Query Worker / Writer Worker
  + 文件系统事件持久化队列
  + 目录级 reconciliation 兜底
  + SQLite 事实库与派生搜索索引分层
```

第一阶段不立即替换 SQLite，也不立即删除三元组表。先解决启动路径、SQL 和进程阻塞，再通过基准测试决定是否引入独立搜索引擎。

## 2. 背景与问题定义

### 2.1 历史问题现场规模

优化前测试数据库：`C:\Users\11420\AppData\Roaming\Nestify\nestify.sqlite`

| 项目 | 当前规模 |
| --- | ---: |
| SQLite 文件 | 约 4.33 GB |
| `entries` | 524,917 |
| `library_entries` | 524,917 |
| 有效文件 | 约 422,928 |
| 有效目录 | 约 101,989 |
| `name_trigrams` | 24,483,276 |
| `entry_fts` | 524,917 |
| 客户库 | 418 |
| 整台电脑库 | 524,499 |

数据库主要空间消耗在名称三元组系统，表、主键索引和 gram 索引合计约 3.3 GB。该表保留为问题定位依据；最新代码 schema 为 v7，最新 1M 复核见 11.5 与 15.10。

### 2.2 启动日志证据

启动日志显示：

- 数据库打开、PRAGMA 和迁移约 45ms。
- 历史现场日志记录的是 v4；当前代码 schema 为 v7。v5 增加有效名称和扩展名复合索引，v6 增加规范化 `parent_path` 表达式索引，v7 将 n-gram gram 索引替换为 `(gram, entry_id)` 覆盖索引。
- Renderer 显示后约 1 秒发起 `libraryId=__all__`、`text=''` 的空搜索。
- 空搜索返回 524,917 条总数、200 条结果，耗时约 12.8-14.6 秒。
- 更早运行中相同路径曾达到 23-28 秒。

因此“数据库文件大所以打开慢”不是当前首要解释；主要耗时发生在启动后的搜索请求。

### 2.3 当前查询问题

当前搜索入口见：

- [useSearchWorkspace.ts](../apps/desktop/src/app/useSearchWorkspace.ts)
- [query.ts](../packages/core/src/search/query.ts)
- [query-filters.ts](../packages/core/src/search/query-filters.ts)
- [ipc.ts](../apps/desktop/electron/ipc.ts)

一次普通搜索当前至少执行三条 SQL：

1. 精确总数以及文件/目录数。
2. `kind GROUP BY` 统计。
3. 结果列表和排序。

默认库过滤使用 `entries` 扫描加 `library_entries EXISTS`：

```sql
e.tombstone = 0
AND EXISTS (
  SELECT 1
  FROM library_entries membership
  WHERE membership.entry_id = e.id
    AND membership.tombstone = 0
)
```

实测执行计划包含：

```text
SCAN e
SEARCH membership EXISTS USING INDEX idx_library_entries_entry
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR ORDER BY
```

当前查询的主要成本是：

- 先扫描 `entries`，再逐条检查库成员关系。
- 精确统计和列表重复遍历候选集。
- `path_mtime` 排序无法直接使用当前索引，需要临时排序结构。
- `replace()`、`lower()`、`substr()` 等函数使部分路径和扩展名条件难以使用索引。
- IPC handler 虽然声明为 `async`，实际调用的 `DatabaseSync` 仍是同步执行。

### 2.4 当前扫描问题

当前 `runScan()` 的“增量”主要是写入增量：每次仍然遍历整个文件系统，并对路径进行数据库查询，比较 `size / mtime / ino / dev`，未变化时只标记已看到。

这能减少部分 upsert，但不能消除：

- 全盘目录遍历。
- 全量 `stat`。
- 每个路径的同步数据库访问。
- 网络盘或 SMB 的重复读取。

当前还缺少持久化变更事件队列、事件去重与合并、rename 配对、失败重试、watcher 溢出恢复和目录级一致性校验。

## 3. 目标与非目标

### 3.1 目标

目标基于目标机器、目标数据集和 p95/p99 压测定义，不以单次平均值作为承诺。

| 场景 | 目标 |
| --- | ---: |
| 数据库已存在时，应用启动到可交互 | p95 < 200ms |
| 空搜索首屏 | 不访问全库精确统计；首批 UI 不被阻塞 |
| 目录直属子项 | p95 < 50ms |
| 已建立索引的普通名称搜索，首批 50 条 | p95 < 100ms |
| 常见扩展名、类型、时间、大小过滤 | p95 < 100ms |
| 中文或模糊搜索，首批结果 | 先达到 p95 < 200ms，再以基准决定是否引入独立搜索引擎 |
| 文件变化到可搜索 | 本地盘 p95 < 3s |
| 增量同步批处理 | 不阻塞窗口，不丢失已持久化事件 |
| watcher 丢事件恢复 | 能标记 dirty 并完成目录级 reconciliation |

压测必须覆盖 100 万、300 万和 1,000 万条记录，并记录 p50、p95、p99、冷缓存和热缓存结果。

### 3.2 非目标

- 本 TRD 不要求首阶段把 SQLite 替换为服务端数据库。
- 不要求把所有结构化过滤迁移到搜索引擎。
- 不要求每次启动执行全盘一致性扫描。
- 不承诺在所有低速磁盘、杀毒软件干预或 SMB 网络环境下绝对达到 100ms。
- 不在本阶段重写规则、重复文件分析或文件操作计划模块。

## 4. 根因判断

| 假设 | 判断 | 说明 |
| --- | --- | --- |
| 数据库打开慢 | 不是主因 | 当前打开、PRAGMA、迁移约 45ms |
| 没有懒加载 | 是 | 启动自动执行全库空搜索，树查询也复用通用搜索接口 |
| SQL 设计不合理 | 是，主因之一 | 三次扫描、`EXISTS` 方向不佳、临时排序和精确统计叠加 |
| 完全没有索引 | 否 | 已有常规索引、FTS5 和名称 n-gram 倒排 |
| 索引没有按访问模式设计 | 是 | 缺少按库、有效状态、entry 联接方向的复合索引 |
| 没有倒排索引 | 否 | FTS5 和 `name_trigrams` 都是现有倒排结构 |
| 只有倒排索引就能解决 | 否 | 目录、库成员、过滤、排序、统计和同步不由文本倒排单独解决 |
| 架构边界不适合百万级 | 是 | `DatabaseSync` 慢查询运行在 Electron Main，直接阻塞窗口 |
| 当前已经是真增量同步 | 否 | 当前是全量遍历加增量写入，不是事件驱动增量同步 |

## 5. 目标架构

> 实施边界：P0、P1、P3 已落地，P2 已完成 Query Worker 和基础 Writer Worker 接入；扫描/规则/计划等其他长任务尚未全部移出 Main，P4 独立搜索引擎仍需基准测试后决策。下文的“目标进程模型”是最终架构，不代表当前代码已经全部完成。

### 5.1 进程与连接边界

目标进程模型：

```text
Renderer
  -> Preload 白名单 IPC
  -> Electron Main：窗口、权限、请求转发
      -> Query Worker：只读 SQLite 连接，执行搜索和目录查询
      -> Sync Worker：watcher、事件队列和扫描调度
      -> Writer Worker：唯一 SQLite 写连接，批量事务提交
      -> Index Worker：FTS / n-gram / 外部搜索索引更新
```

约束：

1. Electron Main 不直接执行不可预估时长的同步 SQL。
2. SQLite 使用 WAL；单一 Writer Worker 负责写入，Query Worker 使用只读连接。
3. 查询请求带 request id；新搜索可取消或丢弃旧请求结果。
4. 扫描、哈希、缩略图和规则执行不能占用 Main 的事件循环。
5. Worker 化不是 SQL 优化的替代品；每个关键查询仍必须有执行计划和基准测试。

### 5.2 数据分层

```text
SQLite 主库
  - libraries / entries / library_entries
  - sync_state / change_queue
  - jobs / signals / thumbnails

派生索引
  - entry_fts
  - 名称 n-gram 或替代倒排
  - 可选：Tantivy / Lucene / Meilisearch 等本地搜索索引
```

SQLite 是事实来源。所有派生索引必须能够从 SQLite 重建，不能把搜索引擎当作唯一数据源。

## 6. 分阶段实施计划

### P0：立即止血，消除启动未响应

目标：首屏不执行 52 万条全库空搜索。

任务：

1. Renderer 启动时不再调用空文本的全库 `search.query`。
2. 空搜索只显示空状态、最近搜索或库摘要，不计算精确 `COUNT(*)`。
3. 首屏只读取 `libraries` 和轻量级缓存摘要。
4. 树视图改用专用 `listChildren(parentId, libraryId)` 接口。
5. 目录展开时才按需加载直属子项，默认限制返回数量并支持继续翻页。
6. 将查询逻辑先移出 Electron Main，至少放入 `utilityProcess` 或 Query Worker。
7. 为启动路径、空搜索和根目录加载增加日志字段：`requestId`、`queueWaitMs`、`sqlElapsedMs`、`ipcElapsedMs`。

验收：

- 启动日志不再出现 `text="" + libraryId="__all__"` 的全库搜索。
- 应用窗口可交互时间 p95 < 200ms。
- 目录树只请求当前根目录或当前展开目录，不请求全库 1,000 条记录。

### P1：SQLite 查询与索引优化

目标：在百万级数据上让结构化查询和普通名称搜索先达到 p95 100ms。

任务：

1. 按库查询从 `library_entries` 进入，再 JOIN `entries`。
2. 增加并验证库成员复合索引：

```sql
CREATE INDEX IF NOT EXISTS idx_library_entries_active
ON library_entries(library_id, tombstone, entry_id);
```

3. 目录直属查询使用 `parent_id`，增加候选索引：

```sql
CREATE INDEX IF NOT EXISTS idx_entries_parent_active_name
ON entries(parent_id, tombstone, name, id);
```

实际索引列和排序规则必须通过 `EXPLAIN QUERY PLAN` 验证后冻结；如果 `name COLLATE NOCASE` 是固定排序，应引入持久化 `name_key` 或相同 collation 的索引列。

4. 结果和统计拆分：首批结果先返回，精确总数、文件数、目录数和 `kindCounts` 异步计算或读取缓存。
5. 默认返回 50-100 条，不以 200 条作为所有场景的固定值。
6. 深分页从 `OFFSET` 改为基于稳定排序键的 keyset pagination。
7. 写入时预计算 `ext_norm`、`path_key`、`parent_path_key`、`name_key`，避免查询时对列执行 `lower()`、`replace()`。
8. 目录查询、普通结构化过滤和全文查询分别建立 SQL 模板，不用一条通用搜索 SQL 覆盖所有场景。
9. 对当前数据库执行一次维护任务：

```sql
ANALYZE;
PRAGMA optimize;
```

10. 对 FTS、n-gram 和 LIKE 的结果一致性增加测试，确认 FTS 参数化、中文短词和特殊字符处理。

11. 只根据查询基准增加 `kind`、`mtime`、`size` 等索引，禁止无条件为每个字段建立索引。

验收：

- `library_entries` 复合索引被目标查询使用。
- 目录直属查询不再扫描全表、不再对 `parent_path` 做 `replace()`。
- 首批结果不等待精确统计。
- 结构化搜索在 100 万条 fixture 上达到 p95 < 100ms。

### P2：查询与写入 Worker 化

目标：慢查询或扫描不能使窗口进入“未响应”。

任务：

1. Query Worker 启动独立只读 SQLite 连接。
2. Writer Worker 成为唯一写入者，所有 upsert、tombstone、FTS 和 n-gram 更新通过 Writer Worker 排队。
3. Main 仅做 IPC 校验、转发、取消和错误映射。
4. 查询支持取消；至少保证旧查询完成后不会覆盖新查询结果。
5. 扫描进度、查询耗时、写队列长度和索引延迟纳入可观测指标。
6. 对 WAL checkpoint、busy timeout、数据库关闭和 worker 崩溃重启定义恢复流程。
7. Writer Worker 启动时恢复 `processing` 队列，并为尚未完成首次 reconciliation 的库排入根目录校验任务。
8. Electron 退出时先等待 Query/Writer Worker 关闭，再关闭 Main 的事实库连接。

验收：

- 人为运行 5 秒以上查询时，窗口仍可拖动、点击和关闭。
- 扫描写入期间，查询不会长时间阻塞；锁等待有独立指标。
- Writer Worker 崩溃后，未完成任务可恢复，数据库不处于半提交状态。

### P3：真正的事件驱动增量同步

目标：正常运行时只处理发生变化的路径，并保证事件不丢失时最终一致。

任务：

1. 本地 Windows 目录接入文件系统 watcher；底层优先使用 `ReadDirectoryChangesW` 能力，Node watcher 作为封装层。
2. 文件事件先写入持久化 `change_queue`，再异步处理，不能只留在内存。
3. 按库、路径和短时间窗口做事件去重与合并，典型延迟 300-1000ms。
4. 处理事件时以当前 `stat` 结果为准，不依赖单个事件类型推断最终状态。
5. 变化路径批量 upsert；删除路径批量 tombstone；FTS 和名称索引在同一写事务内更新。
6. create/change 合并为一次 upsert，连续 change 合并为一次 upsert，rename old/new 配对后处理为一次 rename。
7. 队列项增加重试次数、错误信息、generation 和完成时间。
8. watcher 缓冲区溢出、休眠恢复、网络盘断线或进程异常时，将对应目录标记为 dirty。
9. dirty 目录执行 reconciliation；成功后清除 dirty，不执行无条件全盘扫描。
10. 启动时优先重放 pending 队列，不等待全盘重扫。

验收：

- 单文件创建、修改、删除在 1-3 秒内可搜索。
- 1000 个文件批量变化时，事件会合并为有限批次，不产生每事件一次事务。
- 重启后 pending 事件可重放。
- 模拟 watcher 丢事件后，目录 reconciliation 能恢复索引一致性。

### P4：独立搜索索引决策

目标：在 SQLite 优化后仍无法满足中文模糊搜索或复杂相关性查询时，增加可重建的派生搜索引擎。

触发条件：满足任意一项时进入评估：

- 100 万条数据上中文/模糊搜索 p95 持续高于 200ms。
- 300 万条数据上普通全文搜索 p95 无法达到 100ms。
- 产品确定需要中文分词、拼音、同义词、复杂相关性或多字段高阶检索。
- `name_trigrams` 继续增长导致数据库体积和维护成本不可接受。

候选技术：SQLite FTS5 trigram tokenizer、Tantivy、Lucene、Meilisearch 或 Typesense。桌面场景优先评估无需外部服务依赖的嵌入式方案。

迁移原则：

1. SQLite 保留事实数据和同步状态。
2. 搜索索引通过 outbox/generation 从 SQLite 派生。
3. 首次建立索引支持后台全量构建，不阻塞应用启动。
4. 增量更新使用同一变更事件，成功后推进索引 generation。
5. 搜索结果返回 entry id，再从 SQLite 批量补齐最终展示字段并过滤 tombstone。
6. 搜索索引损坏或版本变化时可删除并从 SQLite 重建。

## 7. 增量同步数据模型

P3 引入以下逻辑表。具体列类型和迁移版本已在现有 v5 schema 中冻结。

### 7.1 `sync_state`

```sql
CREATE TABLE sync_state (
  library_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0,
  last_event_id INTEGER,
  last_reconcile_at INTEGER,
  last_success_at INTEGER,
  watcher_state TEXT NOT NULL DEFAULT 'starting',
  dirty INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
```

作用：记录每个库的 watcher、事件游标、reconciliation 和一致性状态。

### 7.2 `change_queue`

```sql
CREATE TABLE change_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  old_path TEXT,
  observed_at INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at INTEGER
);

CREATE INDEX idx_change_queue_pending
ON change_queue(status, library_id, id);
```

实现时需要补充：

- 路径大小写和分隔符规范化规则。
- 相同库同一路径的去重键。
- 队列保留和清理策略。
- 失败重试上限以及转入 dead-letter 状态的规则。
- rename old/new 无法配对时的降级处理。

### 7.3 事务边界

单批同步事务应包含：

```text
读取并锁定一批 queue item
  -> stat 当前路径
  -> 更新 entries / library_entries
  -> 更新 FTS
  -> 更新名称倒排或写出 index outbox
  -> 更新 sync_state generation
  -> 标记 queue item completed
  -> COMMIT
```

任何一个派生索引更新失败时，必须根据设计选择：

- 与主表同事务回滚；或
- 主表提交，记录 index outbox 待重试。

不能出现“队列已完成但主表未更新”的状态。

## 8. 重命名、移动和目录一致性

### 8.1 稳定 ID

当前路径参与 entry id 生成，重命名或移动可能造成旧记录与新记录难以关联。长期方案应让 `entry.id` 使用稳定随机 ID，并把路径作为可变属性；`ino/dev` 仅作为本地文件身份辅助，不能作为所有文件系统的唯一保证。

### 8.2 文件重命名

```text
rename old_path -> new_path
  -> 找到旧 entry
  -> 更新 path / name / parent_path / parent_id / rel_path
  -> 同事务刷新 FTS 和名称索引
```

### 8.3 目录重命名

目录重命名会影响所有后代路径。处理要求：

1. 计算受影响的后代集合，不执行无条件全表更新。
2. 按 depth 或路径长度从深到浅/浅到深选择稳定更新顺序，具体以外键和实现测试确定。
3. 大目录移动采用后台批次，并有单独 generation。
4. 批次期间不让 UI 看到混合的新旧路径；可通过事务、generation 或 dirty 状态屏蔽中间结果。
5. 目录移动失败时保留可重试任务和错误原因。

## 9. 搜索策略

### 9.1 查询类型分流

| 查询类型 | 首选路径 |
| --- | --- |
| 目录直属子项 | `parent_id` + `library_entries` 复合索引 |
| 扩展名、类型、时间、大小 | SQLite 结构化条件和复合索引 |
| 长文本/前缀名称 | FTS5 |
| 短文本或任意子串 | n-gram 倒排或独立搜索索引 |
| 复杂中文、拼音、相关性 | 独立搜索索引评估 |

### 9.2 统计策略

搜索 API 应支持以下模式，而不是所有请求强制做精确统计：

```text
resultMode=hits-only
resultMode=hits-and-approximate-count
resultMode=hits-and-exact-stats
```

默认使用 `hits-only` 或缓存统计。用户主动打开统计面板时再请求 `exact-stats`。

### 9.3 分页策略

结果排序必须包含稳定唯一键，例如：

```text
(sort_key, entry_id)
```

下一页通过上一页最后一个键查询，不使用随页码增长而变慢的深度 `OFFSET`。

### 9.4 中文单字索引兼容

搜索派生索引增加独立版本号。版本 2 会为 CJK 名称回填单字 gram；版本 1 数据库在回填完成前继续使用旧查询语义，过滤单字 gram 并通过 `LIKE` 兜底，避免只命中部分已回填数据。回填由 Writer Worker 分批执行，每批使用短事务并让出事件循环；新增、重命名和删除仍走现有增量索引路径。回填完成后写入版本 2，后续查询才使用持久化单字 gram。

Spotlight 搜索同样按两段执行：第一批使用 `hits-only` 直接返回最相关结果，精确总数、文件/目录数和类型分布再用独立请求补齐，避免首批渲染等待全量 `COUNT/GROUP BY`。

## 10. 兼容、迁移与回滚

1. 新索引先通过新 migration 增加，不直接修改用户现有数据库文件。
2. 迁移必须可中断恢复；大表索引创建应安排在后台维护任务，避免启动阶段执行。
3. `name_trigrams` 不在 P0/P1 直接删除，先保留兼容查询和重建能力。
4. 新增 `name_key`、`path_key` 等字段时，先回填，再切换查询，再删除旧路径函数依赖。
5. 独立搜索引擎只作为派生索引，失败时回退 SQLite 查询。
6. 每次 schema migration 前备份数据库，并记录迁移耗时、页数和失败原因。
7. `docs/04-database.md`、代码和交付文档统一使用 schema v7；运行旧版本日志中的 v4-v6 只代表迁移前状态。大库执行 v6/v7 索引 migration 可能需要数十秒，这是首次启动的一次性成本。

## 11. 可观测性与压测

### 11.1 必采集指标

```text
app_ready_ms
window_interactive_ms
ipc_queue_wait_ms
query_sql_ms
query_total_ms
query_rows_examined（能采集时）
query_result_count
query_stats_ms
writer_queue_depth
writer_batch_size
writer_commit_ms
watcher_to_queue_ms
queue_to_indexed_ms
reconcile_duration_ms
wal_size
```

### 11.2 基准数据集

至少准备：

- 100 万条：接近目标基线。
- 300 万条：增长压力测试。
- 1,000 万条：架构上限和独立搜索引擎决策依据。

数据分布需要包含：

- 大量重复名称和高频 gram。
- 中文文件名、英文文件名、混合文件名。
- 深目录和单目录几十万子项。
- 多库重叠路径。
- 大量 tombstone。
- 文件批量创建、删除、重命名和目录移动。

### 11.3 验收方法

每个版本固定运行：

1. 冷启动测试 30 次。
2. 热缓存查询测试 1000 次。
3. 冷缓存查询测试 100 次。
4. 每类查询记录 p50/p95/p99。
5. 采集 `EXPLAIN QUERY PLAN`，对比是否出现 `SCAN`、`TEMP B-TREE` 和不期望的相关子查询。
6. 在扫描写入并发时重复查询测试。
7. 模拟进程崩溃、watcher 溢出、数据库锁等待和索引重建。

### 11.4 本轮基准结果

已通过 `npm run benchmark:search` 完成 100k 和 1M SQLite fixture 基准。结果为单连接 SQL 基准，不等同于真实 Electron Query Worker/Writer Worker 并发；`connectionCold` 只表示每次重新打开只读 SQLite 连接，未清空 Windows 操作系统文件缓存，因此不是真正的物理冷缓存。

本表保留早期 100k/1M 采样作为历史对照；当前结论以下方“最新 1M 复核”为准。历史 1M 进程加载代码时未包含最新的 CJK 单字、Spotlight hits-first、自动取消和 n-gram anchor 修正。

| 数据量 | 场景 | hot p95 | connectionCold p95 |
| ---: | --- | ---: | ---: |
| 100k | 空搜索 | 0.69ms | 已记录于 benchmark 输出 |
| 100k | 普通名称 FTS | 6.04ms | 已记录于 benchmark 输出 |
| 100k | 任意子串 n-gram | 35.20ms | 已记录于 benchmark 输出 |
| 100k | 中文 n-gram | 22.71ms | 已记录于 benchmark 输出 |
| 100k | 扩展名过滤 | 1.31ms | 已记录于 benchmark 输出 |
| 100k | 结构化过滤 | 1.04ms | 已记录于 benchmark 输出 |
| 100k | keyset 第二页 | 231.92ms | 已记录于 benchmark 输出 |
| 100k | 直属目录 | 0.89ms | 已记录于 benchmark 输出 |
| 1M | 空搜索 | 1066.92ms | 1008.88ms |
| 1M | 普通名称 FTS | 52.74ms | 67.59ms |
| 1M | 任意子串 n-gram | 230.91ms | 251.64ms |
| 1M | 中文 n-gram | 162.33ms | 1217.41ms |
| 1M | 扩展名过滤 | 1081.48ms | 1008.76ms |
| 1M | 结构化过滤 | 1116.85ms | 1131.76ms |
| 1M | keyset 第二页 | 1570.33ms | 1648.85ms |
| 1M | 直属目录 | 0.65ms | 18.55ms |

### 11.5 最新 1M 复核（schema v7）

同一 fixture 升级到 schema v7 后复核：实际写入 1,001,000 行，派生 n-gram 19,496,611 行。热缓存 30 次，`connectionCold` 2 次，warmup 10 次；`connectionCold` 仍只是重开 SQLite 连接，没有清空 Windows 文件缓存。

| 场景 | hot p95 | connectionCold p95 | 结论 |
| --- | ---: | ---: | --- |
| 空搜索 hits-only | 0.31ms | 202.79ms | 热缓存达标 |
| 普通名称 FTS | 38.56ms | 235.97ms | 热缓存达标 |
| 任意子串 n-gram | 58.16ms | 304.84ms | 热缓存达到 100ms，仍需更大样本与真实冷缓存 |
| 中文 n-gram | 154.79ms | 271.70ms | 达到 200ms 阶段目标，未达 100ms |
| 扩展名过滤 | 1.94ms | 已记录于 benchmark 输出 | 热缓存达标 |
| 结构化过滤 | 0.99ms | 已记录于 benchmark 输出 | 热缓存达标 |
| broad keyset 第二页 | 54.52ms | 202.02ms | 热缓存达标，仍需完整冷缓存与 Worker 并发验收 |
| 直属目录 | 0.22ms | 2.87ms | 达标 |

最新 `EXPLAIN QUERY PLAN` 显示：空搜索、扩展名和直属目录已使用覆盖索引；普通 FTS 仍从虚拟表取候选并用临时 B-tree 排序；broad keyset 使用单个最低频 n-gram anchor；显式 substring 使用两个最低频 gram 的 `INTERSECT`，两次探测均使用 `idx_name_trigrams_gram_entry(gram, entry_id)` 覆盖索引，不再需要回查 `(entry_id, gram)` 主键来补齐 ID。

本次同时修正了频率估计器的截断问题：旧实现固定 `LIMIT 1001`，当候选 gram 频率全部超过上限时会并列，导致 lexical 选择出错误的两个 gram。新实现会逐步提高 count cap，直到拿到确定数量的精确低频 gram，并按数据库缓存 60 秒。回归测试构造超过初始 cap 的频率，验证选中 gram 不再回退到 lexical tie-break。

强制 `CROSS JOIN entry_fts` 曾把 1M keyset hot p95 推高到约 6.14s，已移除；该历史路径恢复常规 join 后仍为 1.94s，最终由 anchor-only 方案降到当前 54.52ms。中文要达到 100ms，仍需要按排序键聚族的候选 ID 流、相关性索引或独立搜索引擎排序。

索引重建必须作为后台可恢复任务执行，不能进入启动关键路径。CJK 单字兼容会增加派生索引体积和回填时间；升级后第一次启动可能在 Writer Worker 中分批回填，查询在完成前保持版本 1 的 LIKE 兜底语义。

## 12. 风险与决策门

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| SQLite 单写入吞吐不足 | 增量延迟升高 | Writer 批量事务、事件合并、WAL、必要时拆分派生索引 |
| 三元组体积继续膨胀 | 磁盘和维护成本高 | 统计 gram 频率，评估 FTS5 trigram 或独立搜索索引 |
| 中文 FTS 分词效果不足 | 结果不完整或延迟高 | 字符 n-gram、中文 analyzer、独立搜索引擎对比测试 |
| watcher 丢事件 | 索引不一致 | durable queue、dirty 标记、目录 reconciliation |
| 目录重命名影响大量后代 | 长事务、查询看到混合状态 | 稳定 ID、批次 generation、后台迁移、dirty 屏蔽 |
| 新增索引增加写入成本 | 扫描和同步变慢 | 只保留被基准证明有效的索引 |
| Worker 连接和迁移竞争 | 锁等待或启动失败 | Main 统一初始化 schema，Worker 等待就绪后打开连接 |

独立搜索引擎的决策门：完成 P0-P3 和 100 万/300 万数据压测后再决定。若 SQLite 结构化查询达到目标，而只有中文复杂模糊搜索不达标，则只将文本检索迁移到独立索引，保留 SQLite 处理库成员关系、目录和最终状态校验。

## 13. 交付清单

### P0 交付

- [x] 启动不执行全库空搜索。
- [x] 首屏库摘要和目录树按需加载。
- [x] 目录直属子项专用 API。
- [x] 查询耗时分段日志。

### P1 交付

- [x] 按库 JOIN 查询重写。
- [x] 复合索引 migration。
- [x] 结果与统计分离。
- [x] keyset pagination。
- [x] 规范化路径和排序键。
- [x] `ANALYZE` / `PRAGMA optimize` 维护任务。
- [x] SQL 计划和执行计划回归测试已完成。
- [x] 全库和稠密库使用 entries-first 查询；稀疏库继续从 `library_entries` 驱动。
- [x] 扩展名存储形态折叠，单扩展名过滤可使用 `idx_entries_active_ext_name`。
- [x] CJK 单字/二元 gram 与版本化后台回填。
- [x] Spotlight 首批 hits 与精确统计分离。
- [x] schema v6/v7：规范化 `parent_path` 索引、n-gram 覆盖索引与双低频 gram substring `INTERSECT`。
- [x] 100k/1M benchmark 已完成；1M 最新复核显示空搜索、FTS、任意子串、扩展名、结构化、直属目录和 broad keyset 热缓存达标，中文达到 200ms 阶段目标但未达 100ms。

### P2 交付

- [x] Query Worker：查询与目录请求已通过独立只读 SQLite 连接执行，Main 仅转发 IPC。
- [x] Query Worker 启动预热：主进程预创建 search/directory Worker，并用库根目录 `limit: 1` 预热目录索引后再启动 Writer 扫描。
- [x] Writer Worker 基础接入：watcher、ChangeProcessor、唯一写连接、初始 reconciliation、重启恢复。
- [ ] 扫描、规则、计划、重复分析和文件操作全部迁移到独立 Writer/Task Worker。
- [x] 旧结果丢弃：Renderer 已使用请求序列号，旧请求不能覆盖新结果。
- [x] 查询取消：终止搜索专用 Query Worker；目录请求使用独立 Query Worker，不会被搜索取消误伤。
- [ ] SQLite 原生 `interrupt`、WAL、锁等待和 worker 故障恢复的完整生产验证。

### P3 交付

- [x] Windows watcher。
- [x] `sync_state` 和 `change_queue`。
- [x] 事件去重、合并和重试。
- [x] rename/目录移动处理。
- [x] dirty 目录 reconciliation。
- [x] 重启队列恢复。

### P4 交付

- [ ] 完成 FTS5 trigram 与独立搜索引擎对比（已补充可重复的 SQLite 基准入口）。
- [ ] 完成中文、拼音、模糊和相关性基准。
- [ ] 形成是否引入独立搜索索引的评审结论。

## 14. 最终方案结论

百万级 100ms 目标不是“加倒排索引”一个动作，而是一个组合约束：

```text
首屏不查全库
  + 目录和搜索查询分流
  + 按库复合索引
  + 统计异步化
  + keyset pagination
  + 查询脱离 Electron Main
  + watcher + durable queue 增量同步
  + reconciliation 保证最终一致
  + FTS/n-gram/独立搜索索引按场景组合
```

当前最先实施的是 P0：停止启动空搜索。它能直接消除当前 12-28 秒级的启动阻塞。之后再用 P1 的查询计划和 P2 的进程隔离保证百万级场景下的可预测响应。基准入口为 `npm run benchmark:search -- --rows 1000000 --iterations 1000`；只有在这些改造和压测后仍无法满足中文模糊搜索目标，才引入独立搜索引擎。

文件系统同步不能把 `fs.watch` 的单个 `rename` 通知当成完整事实。Windows/Node 通常只提供变更路径，不保证 old/new 配对；当前实现对 rename 事件改为持久化包含目录的 reconciliation，以当前磁盘状态修正索引。明确携带 old/new 的内部事件仍可走稳定 ID 的目录树重命名路径。

## 15. 实施状态与验证结论

### 15.1 已完成代码改造

- P0：启动时不再执行 `libraryId="__all__"`、`text=""` 的全库搜索；空搜索直接显示空状态；目录树改用 `directory.children`，直属子项按需加载；搜索和目录请求使用 request sequence，旧响应不能覆盖新请求。
- P1：默认搜索返回量调整为 100；增加 `hits-only`、`hits-and-approximate-count`、`hits-and-exact-stats`；精确统计只在 exact stats 模式执行；结果使用 `limit + 1` 判断下一页；全库和稠密库改从 `entries` 驱动，稀疏库保留 `library_entries` 起点并使用成员密度缓存；增加按库有效成员索引和目录父节点索引；扩展名过滤折叠历史 bare/dot 形态，单扩展名走有效扩展名复合索引；n-gram join 按实际 gram 频率选择 anchor；名称、`path_mtime` 支持 keyset cursor；已移除被 1M 基准证伪的 broad FTS keyset `CROSS JOIN` 强制顺序；增加 `EXPLAIN QUERY PLAN` 回归测试。
- P1 中文兼容：`name_trigrams` 为 CJK 名称写入单字和二元 gram；派生索引状态携带版本号，Writer Worker 将版本 1 数据库分批回填到版本 2。回填完成前查询过滤单字 gram 并使用 `LIKE` 兜底，完成后再启用单字倒排。
- P1 维护：新增 `maintainDatabase()`，执行 `ANALYZE` 和 `PRAGMA optimize`，但不在启动关键路径执行；应由后台空闲任务、手动维护入口或大批量同步后调用。
- P1 schema v6/v7：v6 为 `replace(coalesce(parent_path, ''), '\', '/')`、`tombstone`、`name COLLATE NOCASE`、`id` 增加表达式覆盖索引，解决 `C:\` 这类没有根 entry 的 drive-root fallback；v7 用 `idx_name_trigrams_gram_entry(gram, entry_id)` 替换原 gram 索引，使 anchor 与 substring `INTERSECT` 只探测覆盖索引。
- P1 substring：显式 `textMode: "substring"` 使用两个实际频率最低的 gram 做候选交集；频率估计不再固定 `LIMIT 1001`，而是逐步扩大 count cap 直到确定精确低频 gram，避免高频并列时的错误 tie-break。
- P2：新增 Query Worker 和 Writer Worker。搜索、目录直属查询在独立只读连接执行，并设置 `query_only`；搜索和目录使用独立 Worker 通道，新的首页搜索会取消仍在执行的旧搜索，分页请求不取消统计；搜索取消只终止搜索 Worker。Writer Worker 使用唯一可写连接承载 watcher/ChangeProcessor，启动时恢复 `processing` 队列并为未完成首次同步的库排入根目录 reconciliation，同时后台执行派生索引版本回填；Worker 关闭等待处理器空闲和回填完成，Electron 退出等待 Worker 完成后再关闭 Main 数据库。扫描、规则、计划、重复分析和文件操作尚未全部迁移。
- P2 首页预热：启动时预创建 search/directory Query Worker，等待 Worker 打开只读连接后，用每个库第一个根目录执行 `limit: 1` 目录查询；预热完成后才启动 Writer Worker 的初始扫描，减少首个目录页与冷索引读、后台扫描和 Worker 懒初始化的叠加。
- P3：watcher 事件先持久化到 `change_queue`，再由 ChangeProcessor 批量认领和处理；支持事件合并、重试、dead-letter、processing 恢复、显式 rename、目录子树更新、dirty 标记和目录级 reconciliation。对 Node `fs.watch` rename 的缺失 old path，使用包含目录 reconciliation 兜底；FTS 与名称三元组随事实数据更新。

### 15.2 根因结论

当前“启动未响应”不是单一的“没有倒排索引”：

1. 启动自动发起全库空搜索，触发了约 52 万条记录的候选、精确统计和排序。
2. 查询通过 Main 进程的同步 `DatabaseSync` 执行，即使 IPC handler 声明为 `async`，也仍会阻塞 Electron Main 事件循环。
3. 原查询对候选集合进行了重复统计和结果扫描，库成员过滤方向、临时排序和路径函数进一步放大成本。
4. 数据库已有 FTS5 和 `name_trigrams` 倒排结构，因此“完全没有倒排索引”不成立；倒排索引也不能单独解决库成员关系、目录树、结构化过滤、排序、统计和增量同步。
5. 原同步是全量文件系统遍历加增量写入，不是真正的事件驱动增量同步；watcher 持久化队列和 dirty reconciliation 是保证最终一致性的必要补充。

### 15.3 当前验证结果

- `npm run typecheck`：通过，shared/core/rules/desktop 全部通过。
- `npm test -w @nestify/core`：通过，113/113。
- `npm test -w @nestify/rules`：通过，2/2。
- `npm run build -w @nestify/desktop`：通过，主进程、preload、renderer、`walk-worker.mjs`、`writer-worker.mjs` 和 `query-worker.mjs` 均生成。
- Query Worker 冒烟：独立只读连接可以返回搜索结果，`hits-only` 不返回统计并成功关闭 Worker。
- `git diff --check`：未发现空白错误；工作区仍包含任务之外的既有改动，未做回滚。

以上验证证明代码路径和构建链路可用，但没有证明百万级 p95 100ms 已达标。

### 15.4 尚未完成和生产风险

- Writer Worker 已完成基础接入并通过临时目录真实冒烟，但扫描、规则、计划、重复分析和文件操作仍由 Runtime Main 连接处理；因此 Main 仍可能被这些长时间同步任务阻塞，P2 不能称为“所有写入已隔离”。
- 查询取消采用 Worker 级终止而非 SQLite 原生 `sqlite3_interrupt`：可靠阻断同步查询，但会销毁搜索 Worker 并在下一次搜索时重建；目录请求已使用独立 Worker，当前不会被搜索取消误伤。
- 已完成 100 万条数据的热缓存和 `connectionCold` p50/p95/p99 基准；本轮为 30 次热缓存样本、2 次重开连接样本，且操作系统文件缓存未清空。300 万/1,000 万、真正物理冷缓存和真实 Worker 并发基准仍未完成，因此不能宣称整体验收已达成。
- 最新 1M fixture 实际包含 1,001,000 条 entry 和 19,496,611 条 `name_trigrams`。热缓存 p95：空搜索 hits-only 0.31ms、普通名称 FTS 38.56ms、任意子串 58.16ms、扩展名 1.94ms、结构化 0.99ms、直属目录 0.22ms、broad keyset 第二页 54.52ms；中文 n-gram 154.79ms，达到 200ms 阶段目标但未达 100ms。
- broad keyset 的执行计划已从 FTS 扫描改为最低频 n-gram anchor 驱动；任意子串使用两个最低频 gram 的覆盖索引 `INTERSECT`。两者候选后仍可能需要 `TEMP B-TREE FOR ORDER BY`，且 connectionCold p95 分别为 202.02ms 和 304.84ms。中文复杂检索仍是 P4 候选 ID 流 / 独立搜索索引的主要决策输入。
- 尚未采集完整的 `writer_queue_depth`、`writer_batch_size`、`writer_commit_ms`、锁等待、WAL 大小、`queue_to_indexed_ms`，以及 Writer Worker 写入期间 Query Worker 的 p95/p99。
- 尚未验证 SMB/网络盘断线、休眠恢复、watcher buffer overflow、大规模目录移动以及 Node `fs.watch` 与原生 `ReadDirectoryChangesW` 的差异。
- P4 尚未完成中文、拼音、模糊、相关性 benchmark，也尚未形成是否引入 Tantivy/Lucene/Meilisearch 等独立派生搜索索引的决策。

### 15.5 百万级验收计划

下一阶段必须使用固定 fixture 和固定机器重复测试：

1. 100 万条 fixture 已完成；继续构造 300 万、1,000 万条记录，覆盖中文/英文/混合名称、重复名称、高频 gram、深目录、单目录大子项、多库重叠、tombstone 和批量 rename。
2. 每个数据集执行 30 次冷启动、1,000 次热缓存查询、100 次冷缓存查询，分别记录 `app_ready_ms`、`window_interactive_ms`、`query_sql_ms`、`query_total_ms`、p50/p95/p99。
3. 空搜索、普通名称搜索、任意子串、扩展名/类型/大小/时间过滤、直属目录和 broad keyset 热缓存已在最新 1M 单连接复核中达到当前阶段目标；中文已达到 p95 < 200ms 阶段目标但未达 100ms；keyset 和 substring 还需真实 Worker 并发与冷缓存复核。
4. 在真实 Electron Query Worker/Writer Worker 同步写入并发期间重复查询，并记录 writer queue depth、批量大小、提交耗时、锁等待、WAL 大小、`queue_to_indexed_ms` 和 Query Worker p95/p99。
5. 模拟 watcher 丢事件、进程异常、数据库锁等待和索引损坏，验证 pending queue 重放、dirty reconciliation 和派生索引重建。
6. 只有当 SQLite + FTS5/n-gram 在目标数据集上仍无法满足中文复杂检索，或三元组体积/维护成本不可接受时，才进入独立搜索引擎评审。

### 15.6 本轮 Writer Worker 真实冒烟

在临时 SQLite 和临时文件库上验证：

- Worker 启动后会对已有根目录执行初始 reconciliation，已有文件可进入索引。
- 文件修改后 size 更新，文件删除后对应 membership/entry 进入 tombstone。
- 目录重命名通过包含目录 reconciliation 后，后代路径、`parent_id`、`depth` 和 `rel_path` 均更新。
- `change_queue` 的 pending/processing 项最终清零。
- Worker 收到 close 后等待处理器空闲并正常关闭，Main 连接随后可关闭。

该冒烟验证了同步正确性和生命周期，不代表百万级延迟目标已达标。

### 15.7 可重复基准入口

新增 `tools/search-benchmark.mjs`，通过 `npm run benchmark:search` 执行。工具固定随机种子生成包含中文/英文/混合名称、重复 gram、深度目录、结构化字段和直属子项的 SQLite fixture，并分别输出：

- 空搜索、FTS、短词 trigram、中文、扩展名/结构化过滤、直属目录查询的冷/热 p50、p95、p99。
- `EXPLAIN QUERY PLAN` 详情，便于发现不期望的全表扫描、临时排序和相关子查询。
- 可选写入并发样本、查询耗时和 WAL 指标说明。

该工具的 `--write-concurrency` 模式用于快速回归 SQL 写入成本；真实 Electron Query Worker/Writer Worker 锁竞争仍须在桌面进程中测量，不能用单连接结果替代。最新 1M fixture 生成耗时 216.12 秒、包含 CJK 单字的派生索引重建耗时 450.28 秒，说明索引初始化必须后台可恢复，不能阻塞启动。

### 15.8 当前验收结论

已解决的核心启动问题是“首屏全库空搜索 + Main 同步查询阻塞”，不是单纯缺少倒排索引。当前数据库已经同时具备结构化 SQL 索引、FTS5 和名称 n-gram 倒排；最终性能取决于懒加载、查询起点、统计策略、分页、Worker 隔离和同步写入竞争的组合效果。

百万级 p95 100ms 仍为整体验收目标，不是当前已完成的结论。最新 1M 单连接热缓存复核中，空搜索 hits-only、普通名称 FTS、任意子串、扩展名/结构化过滤、直属目录和 broad keyset 第二页达标；中文达到 200ms 阶段目标但未达 100ms。下一步应优先做中文/复杂模糊候选 ID 流、相关性排序和按排序键聚族的派生索引，并对比 SQLite FTS5 trigram、Tantivy/Lucene 等可嵌入索引；同时在真实 Worker 并发、物理冷缓存、300 万/1,000 万、SMB 和 watcher overflow 场景验收。SQLite 继续作为事实库和最终状态校验来源。

### 15.9 2026-09-10 keyset 复核修正

本轮针对 broad 名称 keyset 做了两条路径对照：

1. 尝试以 `entries` 名称索引为外层流，再按 rowid 探测 FTS。100k 复核显示 SQLite 仍会对每个候选执行 `SCAN entry_fts VIRTUAL TABLE INDEX 0:=M4`，keyset hot p95 升至 278.60ms，该方案已放弃。
2. n-gram 候选裁剪只保留实际频率最低的 anchor gram，最终精确匹配仍由既有 `LIKE` 条件保证。去掉冗余 `EXISTS` 探测后，同一 100k fixture 的 keyset 第二页 hot p95 降至 6.90ms、p99 8.68ms，`connectionCold` p95 28.13ms；执行计划不再出现 `SCAN entry_fts`，但仍保留 anchor 驱动后的临时 B-tree 排序。

新增回归测试构造超过 1,000 条 broad 名称数据，验证 keyset 页面不重复、只保留一个 `name_trigrams` 探测点。100k 复核先确认了该方向，后续已继续完成 1M 单连接复核。

后续 1M 复核采用固定 seed、30 次热缓存、2 次重开连接和 10 次 warmup：fixture 实际 1,001,000 条 entry、19,614,259 条 `name_trigrams`。broad keyset 第二页 hot p50 58.74ms、p95 76.97ms、p99 80.03ms，connectionCold p95 255.83ms；结果分页一致性校验通过，执行计划保持单个 `name_trigrams` anchor 探测且无 `SCAN entry_fts`。这证明该路径的 1M 热缓存目标达到，但样本量和环境边界仍不足以替代完整验收。

### 15.10 2026-09-10 schema v7 与首页冷读修正

本节记录 schema v6/v7 后的最终实现状态和 live 库首页诊断。

- schema v6 为 drive-root fallback 增加 `idx_entries_parent_path_active_name`。根 entry（例如 `C:\` 本身）不存在时，`directory.children` 通过规范化 `parent_path` 表达式索引直接取子项，不再退化为扫描候选。
- schema v7 将 `idx_name_trigrams_gram` 替换为 `idx_name_trigrams_gram_entry(gram, entry_id)`。broad keyset 仍使用单最低频 anchor；显式 substring 使用两个最低频 gram 的 `INTERSECT`，执行计划只做覆盖索引 search。
- 旧 gram 频率估计器固定 `LIMIT 1001`，高频 gram 全部截断后并列，导致 lexical tie-break 选错探测词。新估计器逐步扩大 count cap，直到确定所需数量的精确低频 gram，并缓存 60 秒；已增加超过初始 cap 的回归测试。
- `HIT_SELECT` 不再对每个候选执行相关 membership 子查询。指定库直接绑定库 ID；全库模式只在当前页批量解析 membership，且该批查询去掉不必要的 `ORDER BY`。
- 最新 1M 复核见 11.5：任意子串 hot p95 从 329ms 降至 58.16ms，broad keyset hot p95 从 76.97ms 降至 54.52ms，直属目录 hot p95 0.22ms。中文 hot p95 154.79ms，仍只达到 200ms 阶段目标。

live 库只读诊断时观察到：`entries` 776,802 条、有效 entry 280,358 条、`name_trigrams` 28,631,743 条，主库约 5.83GB，WAL 约 876MB。用户现场首次 `directory.children C:\` 日志为 SQL 3932ms、IPC 7558ms；只读复测的执行计划确认使用 `idx_entries_parent_path_active_name` covering index，第一次 fallback count 4381ms，紧接着同条件 page query 1.2ms。因此该次耗时不是分页扫描全部子项，而是冷索引页读、directory Worker 懒启动、初始 Writer 扫描 IO 竞争和较大 WAL 的叠加。

修正为主进程启动时预创建 search/directory Query Worker，等待 Worker ready 后用每个库第一个根目录执行 `limit: 1` 预热，预热完成后才启动 Writer Worker 扫描。这样首个用户目录请求不再承担 Worker module/SQLite 连接初始化，且排在已被预热的索引页之后；后台扫描延后到首页索引可用之后。该项改善的是首次页面路径，不把物理冷缓存或 Worker 并发基准标记为已验收。2026-09-10 用户确认当前性能体验满意，性能主线转入维护状态，后续优化优先处理长任务隔离、安全与产品完整性。

首次打开 schema v5 及更早版本的大库时，v6/v7 migration 需要创建/替换大索引，可能阻塞数十秒；这是预期的一次性成本。后续冷启动仍可能受 Windows 文件缓存、磁盘负载和 WAL 大小影响，必须继续采集 `query_sql_ms`、IPC 总耗时、WAL 大小和 Writer 并发样本。
