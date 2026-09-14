# Nestify 数据库

## 1. 数据库概览

Nestify 的主存储是 SQLite。当前实现使用 Drizzle ORM 的 schema/query builder 生成类型化 SQL，再交给 Node 22 内置 `node:sqlite` 的 `DatabaseSync` 执行，不引入 `better-sqlite3` 或其他 native addon。

数据库由 Electron Main 进程中的 `NestifyRuntime` 持有，Renderer 只能通过白名单 IPC 访问。打开数据库使用 `openDatabase(path | ':memory:')`：文件数据库会先创建父目录，然后设置 PRAGMA，再按版本执行迁移。

当前数据库版本为 **v7**，由 `packages/core/src/db/migrations.ts` 中的 `CURRENT_SCHEMA_VERSION` 定义。以下表结构以 v1 初始化 SQL 加 v2-v7 迁移后的最终物理数据库为准；`packages/core/src/db/schema.ts` 是 ORM 层声明，个别历史字段和约束存在差异，文末有专门说明。

当前应用维护的表/虚表共 **18 张**：

| 序号 | 表名 | 类型 | 主要用途 |
| ---: | --- | --- | --- |
| 1 | `schema_migrations` | 普通表 | 记录已应用的迁移版本 |
| 2 | `libraries` | 普通表 | 资料库配置和根目录 |
| 3 | `entries` | 普通表 | 文件、目录及其索引属性 |
| 4 | `library_entries` | 普通表 | 资料库与 canonical entry 的成员关系 |
| 5 | `sync_state` | 普通表 | 每个资料库的同步状态 |
| 6 | `change_queue` | 普通表 | 文件系统变更事件队列 |
| 7 | `search_index_state` | 普通表 | 派生搜索索引状态 |
| 8 | `signals` | 普通表 | 规则分析信号缓存 |
| 9 | `name_trigrams` | 普通表 | 文件名 gram 倒排索引 |
| 10 | `scan_cursors` | 普通表 | 扫描断点/游标 |
| 11 | `dup_groups` | 普通表 | 重复文件组 |
| 12 | `dup_members` | 普通表 | 重复组成员 |
| 13 | `rulesets` | 普通表 | 规则集元数据和 YAML 快照 |
| 14 | `rules` | 普通表 | 规则集中的规则记录 |
| 15 | `jobs` | 普通表 | 计划、整理、改名等任务 |
| 16 | `job_ops` | 普通表 | 任务内逐项文件操作账本 |
| 17 | `thumbnails` | 普通表 | 缩略图缓存索引 |
| 18 | `entry_fts` | SQLite FTS5 外部内容虚表 | 文件名和路径全文检索 |

SQLite FTS5 会在内部创建若干影子表，例如 `entry_fts_data`、`entry_fts_idx`。这些是 FTS5 引擎内部实现细节，不属于 Nestify 应用直接维护的业务表。

## 2. SQLite 类型约定

SQLite 是动态类型数据库，下面的“SQLite 类型”表示建表时声明的类型亲和性和应用约定，不代表 SQLite 像传统数据库一样强制所有值的类型。

| 约定 | 含义 |
| --- | --- |
| `INTEGER` 时间字段 | Unix 毫秒时间戳；迁移初始化 `search_index_state` 时使用 `unixepoch('now') * 1000` |
| `INTEGER` 布尔字段 | `0` 表示否，`1` 表示是 |
| `TEXT` JSON 字段 | 保存 JSON 文本，读取时由应用解析；写入前应保持合法 JSON |
| `TEXT` YAML 字段 | 保存规则集或规则的 YAML 原文，读取时由规则仓库校验 |
| 空字符串 | `ext` 等字段使用空字符串表达“没有扩展名”；这与 SQL `NULL` 不同 |
| `NULL` | 表示值未知、不适用或尚未计算；是否允许为空以各表字段定义为准 |

## 3. ORM 边界和 PRAGMA

### ORM 边界

1. `packages/core/src/db/schema.ts` 定义 ORM 侧的表、字段、主键、外键和索引。
2. `packages/core/src/db/orm.ts` 使用 `drizzle-orm/sqlite-proxy` 创建 query factory，将生成的 SQL 和参数交给 `DatabaseSync`。
3. `libraries`、`entries`、`rulesets`、`jobs`、`dup_groups`、`dup_members` 和 `thumbnails` 的常规 CRUD 已使用 Drizzle query builder。
4. 版本化迁移、PRAGMA、FTS5、FTS 触发器、name trigram、搜索计划边界和部分重复数据持久化仍使用 raw SQL。

### PRAGMA

| Pragma | 值 | 说明 |
| --- | --- | --- |
| `foreign_keys` | `ON` | 启用实际声明的外键和级联删除 |
| `journal_mode` | `WAL` | 支持扫描写入和查询读取并发；`:memory:` 数据库会返回 `memory` |
| `busy_timeout` | `5000` | 等待数据库锁最长 5 秒 |
| `synchronous` | `NORMAL` | 配合 WAL 使用的落盘策略 |

## 4. 完整表结构

字段表中的“关联”只在数据库确实声明 `REFERENCES` 时标记为外键；没有数据库外键但在业务上有关联的字段，会标注为“逻辑关联”。

### 4.1 `schema_migrations`

**用途：** 记录数据库已应用的迁移版本。迁移版本号唯一，打开数据库时以最大版本号判断待执行迁移。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `version` | `INTEGER` | 否 | 无 | 是 | 无 | 已应用的迁移版本号 |
| `applied_at` | `INTEGER` | 否 | 无 | 否 | 无 | 应用迁移的时间，Unix 毫秒时间戳 |

**约束：** `PRIMARY KEY(version)`。

### 4.2 `libraries`

**用途：** 资料库配置。一个资料库可以配置一个或多个根目录，并持有扫描、哈希、媒体和预览策略。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `TEXT` | 否 | 无 | 是 | 被 `entries.library_id`、`library_entries.library_id` 等引用 | 资料库唯一 ID |
| `name` | `TEXT` | 否 | 无 | 否 | 无 | 资料库显示名称 |
| `roots_json` | `TEXT` | 否 | 无 | 否 | 无 | 根目录路径数组 JSON |
| `exclude_globs_json` | `TEXT` | 否 | `'[]'` | 否 | 无 | 排除规则 glob 数组 JSON |
| `max_depth` | `INTEGER` | 是 | `NULL` | 否 | 无 | 最大扫描深度；空值表示不限制 |
| `follow_symlinks` | `INTEGER` | 否 | `0` | 否 | 无 | 是否跟随符号链接，`0/1` |
| `scan_hidden` | `INTEGER` | 否 | `0` | 否 | 无 | 是否扫描隐藏文件和目录，`0/1` |
| `hash_strategy` | `TEXT` | 否 | `'duplicate-candidate-only'` | 否 | 无 | 哈希策略 |
| `media_strategy` | `TEXT` | 否 | `'off'` | 否 | 无 | 媒体分析策略 |
| `preview_strategy` | `TEXT` | 否 | `'standard'` | 否 | 无 | 预览/缩略图策略 |
| `created_at` | `INTEGER` | 否 | 无 | 否 | 无 | 创建时间，Unix 毫秒时间戳 |
| `updated_at` | `INTEGER` | 否 | 无 | 否 | 无 | 更新时间，Unix 毫秒时间戳 |

### 4.3 `entries`

**用途：** 文件和目录的 canonical 索引。每个实际路径在当前物理数据库中只保留一个 canonical entry；多资料库成员关系由 `library_entries` 保存。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `TEXT` | 否 | 无 | 是 | 被 `library_entries.entry_id`、`signals.entry_id` 等逻辑/外键引用 | entry 唯一 ID |
| `library_id` | `TEXT` | 否 | 无 | 否 | 外键 -> `libraries.id`，`ON DELETE CASCADE` | 创建该 entry 的资料库 ID；历史结构保留此列 |
| `parent_id` | `TEXT` | 是 | `NULL` | 否 | 自引用 `entries.id`，`ON DELETE CASCADE` | 父目录 entry ID；盘符根目录 fallback 时可能为空 |
| `name` | `TEXT` | 否 | 无 | 否 | 无 | 文件或目录名称 |
| `stem` | `TEXT` | 否 | 无 | 否 | 无 | 去掉扩展名后的名称 |
| `ext` | `TEXT` | 否 | 无 | 否 | 无 | 扩展名；无扩展名时为空字符串 |
| `is_dir` | `INTEGER` | 否 | 无 | 否 | 无 | 是否为目录，`0/1` |
| `size` | `INTEGER` | 否 | `0` | 否 | 无 | 文件大小；目录通常为 `0` 或扫描器计算值 |
| `mtime` | `INTEGER` | 是 | `NULL` | 否 | 无 | 修改时间，Unix 毫秒时间戳或文件系统原始时间映射 |
| `ctime` | `INTEGER` | 是 | `NULL` | 否 | 无 | 创建时间/元数据变更时间 |
| `atime` | `INTEGER` | 是 | `NULL` | 否 | 无 | 最后访问时间 |
| `ino` | `TEXT` | 是 | `NULL` | 否 | 无 | 文件系统 inode 或等价文件标识 |
| `dev` | `TEXT` | 是 | `NULL` | 否 | 无 | 文件系统设备标识 |
| `depth` | `INTEGER` | 否 | `0` | 否 | 无 | 相对根目录的深度 |
| `kind` | `TEXT` | 否 | 无 | 否 | 无 | 资源类型，例如 `file`、`dir`、`video` 等 |
| `protocol` | `TEXT` | 否 | `'local'` | 否 | 无 | 存储协议，当前本地文件系统默认 `local` |
| `mime` | `TEXT` | 是 | `NULL` | 否 | 无 | MIME 类型 |
| `path` | `TEXT` | 否 | 无 | 否 | 无 | 规范化后的绝对路径 |
| `parent_path` | `TEXT` | 是 | `NULL` | 否 | 无 | 父目录路径；用于根目录没有 entry 时的目录查询 fallback |
| `rel_path` | `TEXT` | 否 | 无 | 否 | 无 | 相对资料库根目录的路径 |
| `hash_quick` | `TEXT` | 是 | `NULL` | 否 | 无 | 快速哈希，用于重复候选筛选 |
| `hash_full` | `TEXT` | 是 | `NULL` | 否 | 无 | 完整内容哈希，用于确认重复 |
| `child_count` | `INTEGER` | 是 | `NULL` | 否 | 无 | 直属子项数量 |
| `file_count` | `INTEGER` | 是 | `NULL` | 否 | 无 | 后代文件数量或扫描统计值 |
| `dir_count` | `INTEGER` | 是 | `NULL` | 否 | 无 | 后代目录数量或扫描统计值 |
| `tombstone` | `INTEGER` | 否 | `0` | 否 | 无 | canonical entry 是否已失效，`0/1` |
| `seen_at` | `INTEGER` | 是 | `NULL` | 否 | 无 | 最近一次扫描发现时间 |
| `indexed_at` | `INTEGER` | 是 | `NULL` | 否 | 无 | 最近一次写入搜索索引的时间 |

**主键和唯一约束：**

- `PRIMARY KEY(id)`。
- 当前 v3 迁移后的物理数据库为 `UNIQUE(path)`，用于保证规范化绝对路径唯一。
- v1 初始化 SQL 和早期文档曾写为 `UNIQUE(library_id, path)`；v3 重建 `entries` 时已改为 `UNIQUE(path)`。因此新文档以当前 v7 物理结构为准。

**索引：**

| 索引名 | 列/表达式 | 用途 |
| --- | --- | --- |
| `idx_entries_library_name` | `(library_id, name)` | 资料库内按名称筛选 |
| `idx_entries_library_ext` | `(library_id, ext)` | 资料库内按扩展名筛选 |
| `idx_entries_library_size` | `(library_id, size)` | 资料库内按大小筛选 |
| `idx_entries_library_mtime` | `(library_id, mtime)` | 资料库内按修改时间筛选 |
| `idx_entries_library_kind` | `(library_id, kind)` | 资料库内按类型筛选 |
| `idx_entries_hash_quick` | `(hash_quick)` | 快速哈希候选 |
| `idx_entries_hash_full` | `(hash_full)` | 完整哈希重复分组 |
| `idx_entries_parent_id` | `(parent_id)` | 通过父 entry 查询子项 |
| `idx_entries_parent_active_name` | `(parent_id, tombstone, name COLLATE NOCASE, id)` | 目录直属有效项分页和排序 |
| `idx_entries_parent_path_active_name` | `replace(coalesce(parent_path, ''), '\\', '/')`, `tombstone`, `name COLLATE NOCASE`, `id` | 父 entry 缺失时按规范化父路径查询 |
| `idx_entries_active_name` | `(tombstone, name COLLATE NOCASE, id)` | 全局有效项按名称查询 |
| `idx_entries_active_ext_name` | `(tombstone, ext, name COLLATE NOCASE, id)` | 全局有效项按扩展名和名称查询 |

### 4.4 `library_entries`

**用途：** 资料库与 canonical entry 的成员关系。v3 迁移后，一个 entry 可以被多个资料库复用，资料库内的相对路径、最近扫描时间和软删除状态独立保存。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `entry_id` | `TEXT` | 否 | 无 | 复合主键 | 外键 -> `entries.id`，`ON DELETE CASCADE` | canonical entry ID |
| `library_id` | `TEXT` | 否 | 无 | 复合主键 | 外键 -> `libraries.id`，`ON DELETE CASCADE` | 资料库 ID |
| `rel_path` | `TEXT` | 否 | 无 | 否 | 无 | 该资料库视角下的相对路径 |
| `seen_at` | `INTEGER` | 否 | 无 | 否 | 无 | 该资料库最近发现此项的时间 |
| `tombstone` | `INTEGER` | 否 | `0` | 否 | 无 | 该资料库中的成员是否已失效，`0/1` |

**主键：** `PRIMARY KEY(entry_id, library_id)`。

**索引：** `idx_library_entries_library(library_id)`、`idx_library_entries_entry(entry_id)`、`idx_library_entries_active(library_id, tombstone, entry_id)`。

### 4.5 `sync_state`

**用途：** 每个资料库一条同步状态记录，供 watcher、变更队列和 reconciliation 使用。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `library_id` | `TEXT` | 否 | 无 | 是 | 逻辑关联 -> `libraries.id`；当前 SQL 未声明 FK | 资料库 ID |
| `generation` | `INTEGER` | 否 | `0` | 否 | 无 | 同步代次，防止旧事件污染新一轮同步 |
| `last_event_id` | `INTEGER` | 是 | `NULL` | 否 | 逻辑关联 -> `change_queue.id` | 最近处理的变更事件 ID |
| `last_reconcile_at` | `INTEGER` | 是 | `NULL` | 否 | 无 | 最近一次完整对账时间 |
| `last_success_at` | `INTEGER` | 是 | `NULL` | 否 | 无 | 最近一次成功同步时间 |
| `watcher_state` | `TEXT` | 否 | `'starting'` | 否 | 无 | watcher 状态 |
| `dirty` | `INTEGER` | 否 | `0` | 否 | 无 | 是否需要重新对账，`0/1` |
| `updated_at` | `INTEGER` | 否 | 无 | 否 | 无 | 状态更新时间 |

### 4.6 `change_queue`

**用途：** 持久化文件系统事件，支持 watcher 事件合并、重试、恢复和死信记录。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | 否 | 自增 | 是 | 被 `sync_state.last_event_id` 逻辑引用 | 事件队列 ID |
| `library_id` | `TEXT` | 否 | 无 | 否 | 逻辑关联 -> `libraries.id`；当前 SQL 未声明 FK | 资料库 ID |
| `event_type` | `TEXT` | 否 | 无 | 否 | 无 | 事件类型，例如创建、修改、删除、重命名 |
| `path` | `TEXT` | 否 | 无 | 否 | 无 | 规范化后的当前路径 |
| `old_path` | `TEXT` | 是 | `NULL` | 否 | 无 | 重命名事件的旧路径 |
| `observed_at` | `INTEGER` | 否 | 无 | 否 | 无 | 观察到事件的时间 |
| `generation` | `INTEGER` | 否 | 无 | 否 | 逻辑关联 -> `sync_state.generation` | 事件所属同步代次 |
| `status` | `TEXT` | 否 | `'pending'` | 否 | 无 | `pending`、`processing`、`completed`、`dead-letter` 等状态 |
| `retry_count` | `INTEGER` | 否 | `0` | 否 | 无 | 已重试次数 |
| `last_error` | `TEXT` | 是 | `NULL` | 否 | 无 | 最近一次处理错误 |
| `processed_at` | `INTEGER` | 是 | `NULL` | 否 | 无 | 处理完成或进入死信的时间 |

**索引：** `idx_change_queue_pending(status, library_id, id)` 用于按资料库领取待处理事件；`idx_change_queue_path(library_id, path, status)` 用于合并同一路径的待处理事件。

### 4.7 `search_index_state`

**用途：** 记录 SQLite 派生搜索索引的代次、状态和版本。当前初始化会写入 `name='sqlite'`、`version=2` 的记录。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | `TEXT` | 否 | 无 | 是 | 无 | 索引实现名称，当前为 `sqlite` |
| `generation` | `INTEGER` | 否 | `0` | 否 | 逻辑关联 -> 同步代次 | 索引对应的数据代次 |
| `status` | `TEXT` | 否 | `'ready'` | 否 | 无 | 例如 `ready`、构建中或回填状态 |
| `version` | `INTEGER` | 否 | `2` | 否 | 无 | 派生索引格式版本；与数据库 schema 版本不同 |
| `updated_at` | `INTEGER` | 否 | 无 | 否 | 无 | 状态更新时间 |

### 4.8 `signals`

**用途：** 保存规则分析产生的结构化信号缓存，每个 entry 最多一行。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `entry_id` | `TEXT` | 否 | 无 | 是 | 外键 -> `entries.id`，`ON DELETE CASCADE` | entry ID |
| `json` | `TEXT` | 否 | 无 | 否 | 无 | 规则信号 JSON |
| `updated_at` | `INTEGER` | 否 | 无 | 否 | 无 | 信号更新时间 |

### 4.9 `name_trigrams`

**用途：** 文件名模糊检索的倒排索引。英文/拉丁文本通常生成三元 gram；中文名称还会生成单字和二元 gram。由 indexer 维护，不依赖 SQL 触发器。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `entry_id` | `TEXT` | 否 | 无 | 复合主键 | 逻辑关联 -> `entries.id`；当前 SQL 未声明 FK | entry ID |
| `gram` | `TEXT` | 否 | 无 | 复合主键 | 无 | 文件名切分出的 gram |

**主键：** `PRIMARY KEY(entry_id, gram)`。

**索引：** `idx_name_trigrams_gram_entry(gram, entry_id)`，用于按 gram 找到 entry，并覆盖返回 entry ID。v7 用该索引替换旧的单列 `gram` 索引。

### 4.10 `scan_cursors`

**用途：** 保存资料库扫描断点，支持大目录、NAS 或中断后的续扫。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `library_id` | `TEXT` | 否 | 无 | 是 | 逻辑关联 -> `libraries.id`；当前 SQL 未声明 FK | 资料库 ID |
| `cursor_json` | `TEXT` | 是 | `NULL` | 否 | 无 | 扫描器游标 JSON |
| `updated_at` | `INTEGER` | 否 | 无 | 否 | 无 | 游标更新时间 |

### 4.11 `dup_groups`

**用途：** 保存重复文件分析产生的重复组摘要。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `TEXT` | 否 | 无 | 是 | 被 `dup_members.group_id` 逻辑引用 | 重复组 ID |
| `library_id` | `TEXT` | 否 | 无 | 否 | 逻辑关联 -> `libraries.id`；当前 SQL 未声明 FK | 重复分析所属资料库 |
| `hash_full` | `TEXT` | 是 | `NULL` | 否 | 无 | 完整哈希；确认内容完全相同的依据 |
| `hash_quick` | `TEXT` | 是 | `NULL` | 否 | 无 | 快速哈希；候选分组依据 |
| `size` | `INTEGER` | 是 | `NULL` | 否 | 无 | 组内文件大小 |
| `file_count` | `INTEGER` | 是 | `NULL` | 否 | 无 | 组内文件数量 |
| `wasted_bytes` | `INTEGER` | 是 | `NULL` | 否 | 无 | 按保留策略估计的可释放空间 |
| `status` | `TEXT` | 否 | `'open'` | 否 | 无 | 重复组状态，例如 `open`、`candidate` |
| `created_at` | `INTEGER` | 否 | 无 | 否 | 无 | 创建时间 |

### 4.12 `dup_members`

**用途：** 保存重复组中的具体 entry 及保留决策。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `group_id` | `TEXT` | 否 | 无 | 复合主键 | 逻辑关联 -> `dup_groups.id`；当前 SQL 未声明 FK | 重复组 ID |
| `entry_id` | `TEXT` | 否 | 无 | 复合主键 | 逻辑关联 -> `entries.id`；当前 SQL 未声明 FK | 重复文件 entry ID |
| `keep` | `INTEGER` | 否 | `0` | 否 | 无 | 是否保留该成员，`0/1` |
| `reason` | `TEXT` | 是 | `NULL` | 否 | 无 | 保留或处理原因 |

**主键：** `PRIMARY KEY(group_id, entry_id)`。

### 4.13 `rulesets`

**用途：** 保存规则集元数据和完整 YAML 快照。规则集的实际规则内容当前主要序列化在 `yaml` 字段中。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `TEXT` | 否 | 无 | 是 | 被 `rules.rule_set_id`/`rules.ruleset_id` 逻辑引用 | 规则集 ID |
| `name` | `TEXT` | 否 | 无 | 否 | 无 | 规则集名称 |
| `description` | `TEXT` | 是 | `NULL` | 否 | 无 | 规则集描述 |
| `yaml` | `TEXT` | 否 | 无 | 否 | 无 | 规则集完整 YAML 内容 |
| `builtin` | `INTEGER` | 否 | `0` | 否 | 无 | 是否内置只读规则集，`0/1` |
| `enabled` | `INTEGER` | 否 | `1` | 否 | 无 | 是否启用，v2 新增，`0/1` |
| `priority` | `INTEGER` | 否 | `100` | 否 | 无 | 规则集优先级，数值越小通常越优先 |
| `created_at` | `INTEGER` | 否 | 无 | 否 | 无 | 创建时间 |
| `updated_at` | `INTEGER` | 否 | 无 | 否 | 无 | 更新时间 |

### 4.14 `rules`

**用途：** 规则集下的规则明细表。当前 v1 初始化 SQL 创建了该表，但现有规则仓库主要将规则数组保存在 `rulesets.yaml` 中，业务代码目前没有依赖该表完成规则集 CRUD。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `TEXT` | 否 | 无 | 是 | 无 | 规则 ID |
| `ruleset_id` | `TEXT` | 否 | 无 | 否 | 逻辑关联 -> `rulesets.id`；当前历史 SQL 未声明 FK | 所属规则集 ID |
| `name` | `TEXT` | 否 | 无 | 否 | 无 | 规则名称 |
| `enabled` | `INTEGER` | 否 | `1` | 否 | 无 | 是否启用，`0/1` |
| `priority` | `INTEGER` | 否 | 无 | 否 | 无 | 规则执行/排序优先级 |
| `yaml` | `TEXT` | 否 | 无 | 否 | 无 | 单条规则 YAML 内容 |

**字段命名差异：** `packages/core/src/db/sql.ts` 和 v1-v7 物理迁移创建的列名是 `ruleset_id`；Drizzle schema.ts 当前声明为 `rule_set_id`。这是代码 schema 与历史物理数据库之间的真实不一致，后续需要通过兼容迁移或统一 ORM 映射修复。文档不能将 `rule_set_id` 当作当前物理列名。

### 4.15 `jobs`

**用途：** 记录扫描、规则预览/执行、整理、改名、重复处理等异步任务的生命周期和汇总结果。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `TEXT` | 否 | 无 | 是 | 被 `job_ops.job_id` 逻辑/ORM 外键引用 | 任务 ID |
| `library_id` | `TEXT` | 是 | `NULL` | 否 | 逻辑关联 -> `libraries.id`；当前 SQL 未声明 FK | 任务所属资料库；全局任务可为空 |
| `kind` | `TEXT` | 否 | 无 | 否 | 无 | 任务类型 |
| `status` | `TEXT` | 否 | 无 | 否 | 无 | 任务状态 |
| `dry_run` | `INTEGER` | 否 | `1` | 否 | 无 | 是否为试运行/预览，`0/1` |
| `started_at` | `INTEGER` | 是 | `NULL` | 否 | 无 | 开始时间 |
| `finished_at` | `INTEGER` | 是 | `NULL` | 否 | 无 | 结束时间 |
| `error` | `TEXT` | 是 | `NULL` | 否 | 无 | 任务级错误信息 |
| `stats_json` | `TEXT` | 是 | `NULL` | 否 | 无 | 统计数据及任务元数据 JSON |

### 4.16 `job_ops`

**用途：** 任务内的逐项文件操作账本，记录移动、改名、删除到隔离区等操作的来源、目标、规则、风险和结果。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `TEXT` | 否 | 无 | 是 | 无 | 操作 ID |
| `job_id` | `TEXT` | 否 | 无 | 否 | 逻辑关联 -> `jobs.id`；当前历史 SQL 未声明 FK | 所属任务 ID |
| `seq` | `INTEGER` | 否 | 无 | 否 | 无 | 同一任务内的操作顺序 |
| `op` | `TEXT` | 否 | 无 | 否 | 无 | 操作类型 |
| `from_path` | `TEXT` | 否 | 无 | 否 | 无 | 原始路径 |
| `to_path` | `TEXT` | 是 | `NULL` | 否 | 无 | 目标路径；删除操作可能为空 |
| `rule_id` | `TEXT` | 是 | `NULL` | 否 | 逻辑关联 -> 规则 ID | 产生该操作的规则 |
| `status` | `TEXT` | 否 | 无 | 否 | 无 | 操作状态 |
| `risk` | `TEXT` | 是 | `NULL` | 否 | 无 | 风险等级 |
| `reason` | `TEXT` | 是 | `NULL` | 否 | 无 | 操作原因 |
| `error` | `TEXT` | 是 | `NULL` | 否 | 无 | 单项操作错误 |

**注意：** Drizzle schema 对 `job_ops.job_id` 声明了 `REFERENCES jobs(id) ON DELETE CASCADE`，但 v1 历史 SQL 没有写入该外键。当前物理库以迁移 SQL 为准；如果后续需要强制级联，应增加显式兼容迁移。

### 4.17 `thumbnails`

**用途：** 缩略图缓存索引。实际图片文件保存在应用缓存目录，表中保存缓存键、路径和尺寸元数据。

| 字段 | SQLite 类型 | 可空 | 默认值 | 主键 | 关联 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `entry_id` | `TEXT` | 否 | 无 | 是 | 逻辑关联 -> `entries.id`；当前 SQL 未声明 FK | 对应 entry；每个 entry 最多一条缓存记录 |
| `cache_key` | `TEXT` | 否 | 无 | 否 | 无 | 缓存内容指纹 |
| `path` | `TEXT` | 否 | 无 | 否 | 无 | 缩略图落盘路径 |
| `width` | `INTEGER` | 是 | `NULL` | 否 | 无 | 图片宽度 |
| `height` | `INTEGER` | 是 | `NULL` | 否 | 无 | 图片高度 |
| `generated_at` | `INTEGER` | 否 | 无 | 否 | 无 | 生成时间 |

读取缩略图时还需要由应用校验缓存键、尺寸、MIME、缓存目录边界和文件是否存在；entry 的大小、修改时间或生成器版本变化后应重建缓存。

### 4.18 `entry_fts`

**用途：** SQLite FTS5 外部内容全文索引，用于搜索文件名、无扩展名名称、父路径和资料库相对路径。

```sql
CREATE VIRTUAL TABLE entry_fts USING fts5(
  name,
  stem,
  parent_path,
  rel_path,
  content='entries',
  content_rowid='rowid'
);
```

| 字段 | FTS5 类型 | 可空 | 关联 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | FTS5 文本列 | 按 FTS5 规则 | `entries.name` | 文件或目录名称 |
| `stem` | FTS5 文本列 | 按 FTS5 规则 | `entries.stem` | 去扩展名名称 |
| `parent_path` | FTS5 文本列 | 按 FTS5 规则 | `entries.parent_path` | 父目录路径 |
| `rel_path` | FTS5 文本列 | 按 FTS5 规则 | `entries.rel_path` | 相对资料库根路径 |

这不是普通关系表，没有业务主键或常规外键。它通过 `content='entries'` 和 `content_rowid='rowid'` 与 `entries` 关联，由以下触发器同步：

| 触发器 | 时机 | 行为 |
| --- | --- | --- |
| `entries_ai` | `entries` 插入后 | 写入 FTS 新行 |
| `entries_ad` | `entries` 删除后 | 删除 FTS 旧行 |
| `entries_au` | `entries` 更新后 | 删除旧 FTS 行并插入新行 |

如果发现 FTS 与 `entries` 不一致，可执行：

```sql
INSERT INTO entry_fts(entry_fts) VALUES('rebuild');
```

## 5. 表关系总图

```text
libraries
  ├──< entries.library_id                 [真实 FK，级联删除]
  ├──< library_entries.library_id         [真实 FK，级联删除]
  ├──< sync_state.library_id              [逻辑关联，无 FK]
  ├──< change_queue.library_id            [逻辑关联，无 FK]
  ├──< scan_cursors.library_id            [逻辑关联，无 FK]
  ├──< dup_groups.library_id              [逻辑关联，无 FK]
  └──< jobs.library_id                    [逻辑关联，无 FK]

entries
  ├──< entries.parent_id                  [自引用真实 FK，级联删除]
  ├──< library_entries.entry_id           [真实 FK，级联删除]
  └──< signals.entry_id                   [真实 FK，级联删除]

entries
  ├── name_trigrams.entry_id              [逻辑关联，无 FK]
  ├── dup_members.entry_id                [逻辑关联，无 FK]
  ├── thumbnails.entry_id                 [逻辑关联，无 FK]
  └── entry_fts                            [FTS 外部内容关联]

dup_groups
  └──< dup_members.group_id               [逻辑关联，无 FK]

rulesets
  └──< rules.ruleset_id                    [逻辑关联；历史 SQL 无 FK]

jobs
  └──< job_ops.job_id                      [逻辑关联；历史 SQL 无 FK]
```

## 6. 关联和删除行为

### 真实数据库外键

当前迁移后的物理数据库中明确声明的外键如下：

| 子表字段 | 父表字段 | 删除行为 |
| --- | --- | --- |
| `entries.library_id` | `libraries.id` | `ON DELETE CASCADE` |
| `entries.parent_id` | `entries.id` | `ON DELETE CASCADE` |
| `library_entries.entry_id` | `entries.id` | `ON DELETE CASCADE` |
| `library_entries.library_id` | `libraries.id` | `ON DELETE CASCADE` |
| `signals.entry_id` | `entries.id` | `ON DELETE CASCADE` |

因此删除资料库时，数据库会级联删除其 `entries` 和 `library_entries`；删除 entry 时会级联清理其成员关系、信号缓存和直属子 entry。资料库删除代码还会显式清理没有真实 FK 的 `sync_state`、`change_queue`、`scan_cursors`、重复数据、trigram 和缩略图数据。

### 逻辑关联

以下字段在业务上引用其他表，但当前物理 SQL 没有声明外键：

- `sync_state.library_id` -> `libraries.id`
- `change_queue.library_id` -> `libraries.id`
- `scan_cursors.library_id` -> `libraries.id`
- `dup_groups.library_id` -> `libraries.id`
- `dup_members.group_id` -> `dup_groups.id`
- `dup_members.entry_id` -> `entries.id`
- `name_trigrams.entry_id` -> `entries.id`
- `thumbnails.entry_id` -> `entries.id`
- `jobs.library_id` -> `libraries.id`
- `job_ops.job_id` -> `jobs.id`
- `job_ops.rule_id` -> `rules.id`
- `rules.ruleset_id` -> `rulesets.id`

这些表的删除和清理由资料库仓库、任务仓库、重复分析持久化逻辑和缩略图服务显式完成。增加真实 FK 前，需要先兼容现有数据并设计迁移顺序，不能只修改 ORM 声明。

## 7. 迁移版本

`schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)` 记录已应用版本。迁移按版本升序执行，每个版本使用 `BEGIN IMMEDIATE`、成功后记录版本并提交，失败则回滚。

| 版本 | 内容 |
| ---: | --- |
| v1 | 创建基础表、索引、FTS5 虚表和 FTS 同步触发器 |
| v2 | 为 `rulesets` 增加 `enabled`、`priority` |
| v3 | 增加 `library_entries`，将重复路径 entry 归并为 canonical entry，重建 `entries` 唯一路径约束并重建 FTS |
| v4 | 增加资料库有效成员索引、目录直属索引、`sync_state`、`change_queue`、`search_index_state` |
| v5 | 增加有效名称和扩展名复合索引 |
| v6 | 增加规范化 `parent_path` 表达式索引，支持 Windows 盘符根目录 fallback |
| v7 | 将 name trigram 索引升级为 `(gram, entry_id)` 覆盖索引 |

v6/v7 在已有大库上创建索引时可能需要数十秒，这是首次打开旧版本数据库的一次性成本；迁移完成后重复打开应保持幂等。迁移不应直接修改用户已有数据库的历史数据，涉及列名或外键变化时必须增加新版本兼容迁移。

## 8. 搜索索引约定

当前搜索同时使用三类结构：

1. `entries` 上的结构化索引，负责资料库、类型、扩展名、大小、时间、目录关系和排序入口。
2. `entry_fts` FTS5，负责文件名、stem、父路径和相对路径全文检索。
3. `name_trigrams`，负责短字符串、任意子串和中文单字/二元 gram 检索。

模糊搜索不应默认使用 `LIKE '%keyword%'` 扫描全表。FTS 触发器漏同步时使用 FTS rebuild；trigram 则由 indexer 分批维护，并通过 `search_index_state.version` 管理派生索引格式回填。

## 9. 任务数据设计

整理、改名和重复处理任务的数据库记录不仅是进度日志，也是文件变更的审计和恢复依据。当前基础表为：

```text
jobs
  -> job_ops
```

`jobs.stats_json` 当前保存统计及部分任务上下文。若需要完整支持整理任务的中断恢复、精确回滚和规则快照，建议将 `stats_json` 演进为版本化的 `metadata_json` 对象，至少包含：

| 内容 | 说明 |
| --- | --- |
| `module` | `organize`、`rename`、`duplicates` 等模块 |
| `parent_job_id` | 回滚任务指向原任务 |
| `session_id` | 整理会话 ID |
| `snapshot_id` | 执行前冻结的原始快照 |
| `preview_id` / `plan_id` | 用户确认的预览/计划版本 |
| `root_directory` | 本次任务根目录 |
| `rule_set_version` | 规则内容版本或哈希 |
| `rule_set_snapshot_json` | 执行时完整规则快照 |
| `selected_operation_ids_json` | 用户确认的操作 ID |
| `options_json` | 冲突、目标目录、空目录等选项 |

现有 `job_ops` 足以记录基础 `from_path/to_path/op/status`，但要实现强校验回滚，建议进一步增加操作指纹、阶段、依赖、执行时间、回滚状态和元数据字段。必要时可新增 `job_events` 事件表，以记录复制、校验、删除源文件和回滚等事实事件。

## 10. 维护注意事项

1. 文档、迁移 SQL 和 ORM schema 变更必须同步评审；特别是 `ruleset_id` 与 `rule_set_id` 的列名差异必须通过正式兼容迁移解决。
2. 新增真实外键前先检查历史数据中的孤儿记录，再设计迁移；不能假设 ORM 的 `.references()` 会自动改造已存在的 SQLite 表。
3. 大表索引迁移需要记录耗时、锁等待、数据库页数和失败原因，避免用户误以为扫描或启动永久卡死。
4. 清理资料库数据时，除了真实 FK 级联表，还必须处理所有逻辑关联表和缓存文件。
5. `entry_fts`、`name_trigrams` 和 `search_index_state` 属于派生搜索数据，重建时应允许分批执行，并在状态表中记录代次和版本。
6. 修改 `entries.path`、`parent_path`、`rel_path` 或 `tombstone` 的写入逻辑时，要同时验证目录树查询、FTS 同步、trigram 索引和资料库成员关系。
