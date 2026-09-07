# Nestify 数据库

v1 主存储是 SQLite。测试用 Node 内置 `node:sqlite`（`DatabaseSync`），Electron 运行时再换成 `better-sqlite3`。SQL 两边兼容。

打开库：`openDatabase(path | ':memory:')`。文件路径会先建父目录，再设 pragma，再按版本跑迁移。当前版本 **1**，重复打开幂等。

## Pragma

| Pragma | 值 | 说明 |
| --- | --- | --- |
| `foreign_keys` | `ON` | 库删除级联清 entries / signals |
| `journal_mode` | `WAL` | 扫描写与查询读可并发；`:memory:` 会落成 `memory` |
| `busy_timeout` | `5000` | 等锁 5 秒 |
| `synchronous` | `NORMAL` | 配合 WAL 的默认落盘策略 |

## 迁移

`schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)` 记录已应用版本。v1 一次性建齐下面的表、索引、FTS 和触发器。

## 表字典

| 表 | 作用 |
| --- | --- |
| `libraries` | 扫描库。`roots_json` / `exclude_globs_json` 存根路径和排除规则；`hash_strategy` 默认 `duplicate-candidate-only`，`media_strategy` 默认 `off`，`preview_strategy` 默认 `standard`。 |
| `entries` | 文件/目录索引。物化 `path` / `parent_path` / `rel_path`，增量键含 `size` / `mtime` / `ino` / `dev`。`UNIQUE(library_id, path)`。删除库或父目录 `ON DELETE CASCADE`。 |
| `signals` | 规则抽取缓存，一 entry 一行 JSON。 |
| `entry_fts` | FTS5 虚表，字段 `name, stem, parent_path, rel_path`。`content='entries'`，由 `entries_ai/ad/au` 触发器同步。 |
| `name_trigrams` | 文件名三元组倒排，`(entry_id, gram)` 主键，另有 `gram` 索引。由 indexer 维护，不靠 SQL 触发器。 |
| `scan_cursors` | 每库一条扫描游标 JSON，NAS 断点续扫用。 |
| `dup_groups` / `dup_members` | 重复组及成员。组成员 `keep` 标记保留项。 |
| `rulesets` / `rules` | 规则方案与有序规则，YAML 原文入库。 |
| `jobs` / `job_ops` | 变更任务与逐步 IO 日志。`jobs.dry_run` 默认 1。 |
| `thumbnails` | 缩略图缓存键和落盘路径，按 `entry_id` 唯一。 |

## entries 索引

`library_id+name`、`library_id+ext`、`library_id+size`、`library_id+mtime`、`library_id+kind`、`hash_quick`、`hash_full`、`parent_id`。

## FTS 约定

外部内容表比 contentless 更稳：插入/更新/删除 entries 后即可 `MATCH`，级联删除也会走 delete 触发器。若触发器漏同步，可执行 `INSERT INTO entry_fts(entry_fts) VALUES('rebuild')`。模糊搜的短串走 `name_trigrams`，不要 `LIKE '%keyword%'`。
