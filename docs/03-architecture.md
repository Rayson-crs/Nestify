# Nestify 架构

> 配套文档。冻结进程边界、包目录、六大模块端口、配置叠加和 SQLite 落盘位置。实现可以后补，契约先稳定。
>
> 当前状态（2026-09-17 / v1.8.1）：仓库名是 nestify。Query / Writer / Preview / Library-removal Worker 已存在。扫描、规则、计划、重复分析仍有 Main/Runtime 路径。缩略图取消已跨 IPC。下文历史树里的 `cuttlefish/` 不再作为当前仓库名。

## 1. 仓库目录

```text
nestify/
  apps/
    desktop/                 Electron 壳
      electron/              main / preload / IPC / Query、Writer、Preview、Library-removal Worker
      src/                   React + shadcn 渲染层
        components/          通用控件，ui 来自 shadcn
        app/                 工作台编排
        lib/                 IPC 封装
      resources/             应用图标
      release/               portable 打包输出（gitignore）
  packages/
    shared/                  跨进程共享类型、规则 schema、IPC 协议
    core/                    可单测的领域逻辑，不依赖 Electron
      src/
        app/                 NestifyRuntime 编排层
        modules/             六大模块端口（默认 not_implemented；Runtime facade 可代理）
        assistant/           魔法棒目录与插入
        rules/               占位符与链式函数
        scan/                增量扫描与 pause gate
        search/              FTS5 / trigram 查询
        duplicates/          重复分析与 Dry-Run 计划
        organize/            整理快照与预览
        plan/                规则 / 改名 / 执行 / 回滚
        db/                  Drizzle schema / migrations / repositories
        config/              YAML 配置加载与 deepMerge
        layout/              应用数据目录解析与创建
    rules/                   内置 RuleSet
      profiles/              YAML 方案，TS 常量镜像
      src/                   listBuiltinProfiles / getBuiltinProfile / YAML 加载
  config/                    打包默认配置与平台 overlay
  scripts/                   根目录版本同步到桌面包
  docs/                      产品与架构文档
```

`packages/core` 必须能在 Node 测试里跑 fixture，不启动窗口。Renderer 不直接 `fs`、不开 SQLite。

## 2. 进程模型

```text
Renderer (React + shadcn)
  搜索框 / 文件 / 整理 / 改名 / 重复 / 任务 / 预览
        |
preload (contextBridge，白名单 IPC)
        |
Electron Main
  窗口、菜单、shell.showItemInFolder、shell.trashItem
  NestifyRuntime：扫描、规则 / 改名预览、计划执行 / 回滚、重复分析、整理快照
  Query Worker：搜索和目录直属查询
  Writer Worker：watcher、增量写入、派生索引回填
  Preview Worker：图片缩略图生成
  Library-removal Worker：资料库移除
        |
node:sqlite（WAL）
  单一 nestify.sqlite：libraries / entries / FTS / trigrams / jobs / job_ops
quarantine      (%APPDATA%/Nestify/quarantine)
Filesystem / SMB
```

| 进程 | 职责 | 禁止 |
| --- | --- | --- |
| Renderer | 展示、筛选、确认计划 | 直接扫盘、直接写 SQLite、直接跑规则 VM |
| Preload | 暴露白名单 IPC | 转发任意 Node API |
| Main | 窗口、native shell、NestifyRuntime 任务编排与 IPC | 绕过 preload 白名单 IPC；阻塞 UI 线程 |
| Workers | 已落地：Query / Writer / Preview / Library-removal。后续目标：scanner / hasher / rule-vm / planner / executor | 把未落地的 scanner/hasher 写成当前实现 |

当前 worker 边界：

1. 搜索和目录查询在 Query Worker，不在 Main 同步跑全库 SQL。
2. watcher 与增量写入在 Writer Worker。扫描、哈希、规则、计划、重复分析仍可能走 Main/Runtime。
3. 缩略图生成在 Preview Worker；Renderer 出屏可通过 `preview.thumbnail.cancel` 跨 IPC 取消。
4. 规则 VM 只读索引 View，不现场 `readdir`，除非 signal 缺失。
5. 写盘执行器按磁盘/卷限流仍是性能目标；当前执行器先全量预检，再逐步写盘并记录 `job_ops`。

## 3. 六大模块映射

模块端口在 `packages/core/src/modules/`。默认 `createController()` 仍是稳定的 `not_implemented` 占位；注入 runtime 后有 facade。当前真实入口仍是 Electron Main 内的 `NestifyRuntime` 与 preload 白名单 IPC。

`workerName` 是模块目标命名。Query / Preview 已有对应 Worker；scanner / hasher / rule-vm / planner 仍是目标名，不代表这些 Worker 已经存在。

| 产品名 | ModuleId | 目标 workerName | 端口文件 | 主请求类型 |
| --- | --- | --- | --- | --- |
| 建巢 | `scan` | `scanner` | `scan.ts` | `ScanRequest` / `ScanProgress` |
| 寻巢 | `search` | `query` | `search.ts` | `SearchRequest` |
| 清巢 | `duplicates` | `hasher` | `duplicates.ts` | `DuplicateAnalyzeRequest` |
| 精准雕琢 | `rename` | `rule-vm` | `rename.ts` | `RenamePreviewRequest` |
| 透视眼 | `preview` | `thumbnail` | `preview.ts` | `ThumbnailRequest` |
| 筑巢 | `organize` | `planner` | `organize.ts` | `OrganizeRequest` |

`ModuleRegistry` 列出这六个模块的 `id`、`titleZh`、`workerName`。每个 `createController()` 返回 typed 方法，但操作仍按契约拒绝 `not_implemented`；Runtime 当前提供的对应能力不经过这些控制器。

筑巢的桌面入口是整理四步向导和会话规则草稿，不再把 `download-inbox` 当默认 UI。`@nestify/rules` 的 `download-inbox` / `media-rename` 仍可用于规则预览兼容路径。

## 4. 数据流

```text
ScanRequest
  -> NestifyRuntime 扫描任务（可 pause / resume / cancel）
  -> node:sqlite entries / paths / FTS / trigrams upsert
  -> SearchRequest 读 FTS5 + trigram
  -> 规则 / 改名 preview 在索引条目上生成 Change Plan
  -> UI Dry-Run 确认
  -> Runtime executor 写盘并记录 job_ops
  -> rollback 按任务恢复，之后增量刷新索引
```

1. **Scan**：Fast 扫描只记 path / size / mtime / ino / kind。Hash 默认 `duplicate-candidate-only`，首次全量 SHA256 禁止。
2. **SQLite**：Node 内置 `node:sqlite`，单一 `nestify.sqlite`，WAL；多库用 `library_id` 区分。
3. **Search / Rules**：搜索走 FTS5 + trigram；规则和模板预览读同一份索引。占位符与链式函数见 `packages/core/src/rules/placeholders.ts`。
4. **Plan**：规则 / 改名 / 重复清理都先生成 Dry-Run Change Plan，不写盘。虚拟路径映射检测冲突、父改名带子走、覆盖风险。
5. **Execute / Rollback**：只执行仍为 preview/draft 的计划；执行记录 `jobs` / `job_ops`，可按任务回滚，之后增量刷新索引。

## 5. 配置叠加顺序

后者覆盖前者，只覆盖出现过的键：

1. `config/app.default.yaml`：打包默认值（扫描排除、冲突策略 `suffix`、哈希策略、Dry-Run）。
2. `config/windows.yaml` 或 `config/darwin.yaml`：平台差量。
3. `%APPDATA%/Nestify/config/app.yaml`：用户全局配置。
4. SQLite `libraries` 行：保存该库根路径、排除、哈希策略、扫描深度等库级设置。
5. 进程环境 / 启动参数：`NESTIFY_APPDATA`、`NESTIFY_DB_PATH`、`--library` 等，只覆盖显式传入项。

方案 YAML（`packages/rules/profiles/*.yaml` 或用户导入的 RuleSet）不是应用配置，不参与上述叠加；执行时按“选中方案 + 作用域”单独加载。外部方案含 delete/quarantine 时，导入后强制 Dry-Run。

## 6. 数据库与缓存位置

| 数据 | 默认位置 | 说明 |
| --- | --- | --- |
| 应用根 | `%APPDATA%/Nestify/` | Electron `userData`，macOS 为 `~/Library/Application Support/Nestify/` |
| 全局配置 | `%APPDATA%/Nestify/config/app.yaml` | 第 3 层 overlay |
| 应用索引 | `%APPDATA%/Nestify/nestify.sqlite` | Node 内置 `node:sqlite`，WAL；可用 `NESTIFY_DB_PATH` 改路径 |
| 库设置 | `nestify.sqlite` 的 `libraries` 行 | 多库共用同一份数据库，用 `library_id` 隔离 |
| 任务日志 | `nestify.sqlite` 内 `jobs` / `job_ops` | 执行崩溃后可定位改到哪 |
| 缩略图 | `%APPDATA%/Nestify/cache/thumbnails` | 当前 Preview Worker 生成 192x192 JPEG；缓存键由 entry_id、size、mtime 和 generator_version 派生，经 `nestify-thumbnail://` 只读返回 |
| 隔离区 | `%APPDATA%/Nestify/quarantine/` | 计划执行与重复清理使用；禁止静默物理删除 |

索引文件位置可配置，但默认不放在被扫描的库根里，避免自扫描和权限问题。
