# Nestify 架构

> 配套文档。冻结进程边界、包目录、六大模块端口、配置叠加和 SQLite 落盘位置。实现可以后补，契约先稳定。

## 1. 仓库目录

```text
cuttlefish/
  apps/
    desktop/                 Electron 壳
      electron/              main / preload / IPC
      src/                   React + shadcn 渲染层
        components/          通用控件，ui 来自 shadcn
        features/            搜索、规则、去重、改名、计划、预览
        lib/                 IPC 封装
      workers/               scanner / hasher / query / rule-vm / planner / executor / thumbnail
  packages/
    shared/                  跨进程共享类型、规则 schema、IPC 协议
    core/                    可单测的领域逻辑，不依赖 Electron
      src/
        modules/             六大模块端口（接口 + 注册表，尚无真实扫描）
        rules/               占位符与链式函数名
        db/                  SQLite schema / 连接（另任务）
        config/              配置加载（另任务）
        layout/              目录整形计划（另任务）
    rules/                   内置 RuleSet
      profiles/              YAML 方案，TS 常量镜像
      src/                   listBuiltinProfiles / getBuiltinProfile / YAML 加载
  config/                    打包默认配置与平台 overlay
  docs/                      产品与架构文档
```

`packages/core` 必须能在 Node 测试里跑 fixture，不启动窗口。Renderer 不直接 `fs`、不开 SQLite。

## 2. 进程模型

```text
Renderer (React + shadcn)
  搜索框 / 结果表 / 规则编辑器 / Dry-Run / 预览
        |
preload (contextBridge，白名单 IPC)
        |
Electron Main
  窗口、菜单、shell.showItemInFolder、shell.trashItem
  任务调度、库配置、worker 生命周期
        |
Node Workers / utilityProcess
  scanner / indexer / query / rule-vm / planner / executor / thumbnail
        |
better-sqlite3 (WAL)
preview cache   (%APPDATA%/Nestify/cache/thumbnails)
quarantine      (库内 .nestify-quarantine 或用户数据目录)
Filesystem / SMB
```

| 进程 | 职责 | 禁止 |
| --- | --- | --- |
| Renderer | 展示、筛选、确认计划 | 直接扫盘、直接写 SQLite、直接跑规则 VM |
| Preload | 暴露白名单 IPC | 转发任意 Node API |
| Main | 窗口、native shell、任务编排 | 阻塞式全盘 walk / 全量 hash |
| Workers | 扫描、查询、规则、计划、执行、缩略图 | 操作 DOM；规则函数内直接 IO |

硬约束：

1. 扫描和哈希在 worker 里，Main 只收进度。
2. 缩略图队列独立：当前选中 > 可视区 > 后台；出屏取消。
3. 写盘执行器按磁盘/卷限流，前台搜索仍可查询。
4. 规则 VM 只读索引 View，不现场 `readdir`，除非 signal 缺失。

## 3. 六大模块映射

模块端口在 `packages/core/src/modules/`。当前只有类型、注册表和 `not_implemented` 控制器，没有真实 FS 扫描。

| 产品名 | ModuleId | workerName | 端口文件 | 主请求类型 |
| --- | --- | --- | --- | --- |
| 建巢 | `scan` | `scanner` | `scan.ts` | `ScanRequest` / `ScanProgress` |
| 寻巢 | `search` | `query` | `search.ts` | `SearchRequest` |
| 清巢 | `duplicates` | `hasher` | `duplicates.ts` | `DuplicateAnalyzeRequest` |
| 精准雕琢 | `rename` | `rule-vm` | `rename.ts` | `RenamePreviewRequest` |
| 透视眼 | `preview` | `thumbnail` | `preview.ts` | `ThumbnailRequest` |
| 筑巢 | `organize` | `planner` | `organize.ts` | `OrganizeRequest` |

`ModuleRegistry` 列出这六个模块的 `id`、`titleZh`、`workerName`。每个 `createController()` 返回 typed 方法；`execute` 一律抛 `not_implemented`，直到后续任务接上 worker。

筑巢的默认方案来自 `@nestify/rules` 的 `download-inbox`；路径上下文改名示例是 `media-rename`。

## 4. 数据流

```text
ScanRequest
  -> scanner worker 迭代 walk
  -> sqlite entries / paths / fts_names upsert
  -> SearchRequest / RuleSet match 读同一份索引
  -> planner 在虚拟 FS 上生成 Change Plan
  -> UI Dry-Run 确认
  -> executor 写盘
  -> job_ops 记录 + 索引增量更新
```

1. **Scan**：Fast 扫描只记 path / size / mtime / ino / kind。Hash 默认 `duplicate-candidate-only`，首次全量 SHA256 禁止。
2. **SQLite**：扫描写连接和查询读连接分开，WAL。扫描中已入库部分可搜。
3. **Search / Rules**：搜索走 FTS5 + trigram；规则 match 尽量下推到索引字段。占位符与链式函数见 `packages/core/src/rules/placeholders.ts`。
4. **Plan**：不写盘。虚拟路径映射检测冲突、父改名带子走、覆盖风险。默认 Dry-Run。
5. **Execute**：同卷 `rename`，跨卷 copy + verify + delete。删除优先系统回收站，失败或网络盘进隔离区。执行后按任务回滚，不需要全库重扫。

## 5. 配置叠加顺序

后者覆盖前者，只覆盖出现过的键：

1. `config/default.yaml`：打包默认值（扫描排除、冲突策略 `suffix`、哈希策略、缩略图尺寸）。
2. `config/<platform>.yaml`：`windows.yaml` / `darwin.yaml` 平台差量。
3. `%APPDATA%/Nestify/config.yaml`：用户全局配置。
4. 库级 `settings.yaml`：与该库 SQLite 同目录，覆盖根路径、排除、限流档位、默认 RuleSet。
5. 进程环境 / 启动参数：`NESTIFY_DB_PATH`、`NESTIFY_CONFIG`、`--library` 等，只覆盖显式传入项。

方案 YAML（`packages/rules/profiles/*.yaml` 或用户导入的 RuleSet）不是应用配置，不参与上述叠加；执行时按“选中方案 + 作用域”单独加载。外部方案含 delete/quarantine 时，导入后强制 Dry-Run。

## 6. 数据库与缓存位置

| 数据 | 默认位置 | 说明 |
| --- | --- | --- |
| 应用根 | `%APPDATA%/Nestify/` | Electron `userData`，macOS 为 `~/Library/Application Support/Nestify/` |
| 全局配置 | `%APPDATA%/Nestify/config.yaml` | 第 3 层 overlay |
| 库索引 | `%APPDATA%/Nestify/data/libraries/<libraryId>/index.sqlite` | better-sqlite3 WAL；可用配置改路径 |
| 库设置 | 同目录 `settings.yaml` | 第 4 层 overlay |
| 任务日志 | 同目录 `jobs.sqlite` 或 `index.sqlite` 内 `jobs` / `job_ops` | 执行崩溃后可定位改到哪 |
| 缩略图 | `%APPDATA%/Nestify/cache/thumbnails` | 键：`entry_id + size + mtime + generator_version` |
| 隔离区 | 库根 `.nestify-quarantine/`；网络盘可改到 userData | 禁止静默物理删除 |

索引文件位置可配置，但默认不放在被扫描的库根里，避免自扫描和权限问题。
