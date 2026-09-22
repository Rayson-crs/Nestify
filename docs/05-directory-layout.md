# Nestify 目录布局

> 冻结仓库树、运行时目录、配置叠加和索引落盘位置。路径契约保持稳定，当前实现按此落地。
>
> 产品是规则驱动的本地文件治理工作台：Electron + Node + TypeScript + React + shadcn。v1 不上 Rust。
>
> 当前状态（2026-09-22 / v1.9.0）：仓库名是 nestify。打包输出在 `apps/desktop/release`。根目录 `scripts/sync-app-version.mjs` 把版本同步到桌面包。下文历史树里的 `cuttlefish/` 不再作为当前仓库名。

三条铁律对目录设计同样生效：先匹配，再出 Change Plan / Dry-Run，最后写盘；破坏性操作必须可预览、可回滚。索引、缓存、隔离区因此都放在应用数据目录，而不是被扫描的库根里。

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
        modules/             六大模块端口（默认 not_implemented；真实入口在 Runtime / IPC）
        assistant/           魔法棒目录与插入
        layout/              resolveAppPaths / ensureAppDirs
        config/              YAML 加载与 deepMerge
        db/                  单一 nestify.sqlite
        rules/               占位符与链式函数
        organize/            整理快照与预览
    rules/                   内置 RuleSet
      profiles/              YAML 方案，TS 常量镜像
      src/                   listBuiltinProfiles / getBuiltinProfile
  config/                    打包默认配置与平台 overlay
    app.default.yaml
    windows.yaml
    darwin.yaml
    library.default.yaml
    exclusions.default.yaml
  scripts/                   根目录版本同步到桌面包
  docs/                      产品与架构文档
```

`packages/core` 必须能在 Node 测试里跑 fixture，不启动窗口。Renderer 不直接 `fs`、不开 SQLite。

路径解析在 [`packages/core/src/layout/directories.ts`](../packages/core/src/layout/directories.ts)：`resolveAppPaths(appDataRoot)`。目录创建在 [`packages/core/src/layout/ensure.ts`](../packages/core/src/layout/ensure.ts)：`ensureAppDirs(paths)`。

## 2. 运行时目录

Windows 默认应用根是 `%APPDATA%/Nestify`。macOS 为 `~/Library/Application Support/Nestify/`。可用环境变量 `NESTIFY_APPDATA` 改根路径。

```text
%APPDATA%/Nestify/
  nestify.sqlite             唯一 SQLite（node:sqlite，WAL）；libraries 表保存各库根
  config/
    app.yaml                 用户全局覆盖（不是根上的 config.yaml）
  logs/
  cache/
    thumbnails/              缩略图缓存
  quarantine/                应用级隔离区
  rules/                     用户导入 / 另存的 RuleSet
  tmp/
```

| 字段 | 相对 `appDataRoot` | 说明 |
| --- | --- | --- |
| `root` | `.` | 应用数据根 |
| `configDir` | `config/` | 用户 `app.yaml` 所在目录 |
| `dbPath` | `nestify.sqlite` | Node 内置 `node:sqlite` 打开；v1 **只有这一份** 库文件，不是每库一份 |
| `logsDir` | `logs/` | 任务与诊断日志 |
| `cacheDir` | `cache/` | 可丢弃缓存 |
| `thumbnailsDir` | `cache/thumbnails` | 图片/视频缩略图 |
| `quarantineDir` | `quarantine/` | 删除失败或网络盘的隔离落点 |
| `rulesDir` | `rules/` | 用户规则方案 |
| `tmpDir` | `tmp/` | 执行器临时文件 |

`ensureAppDirs` 会对 `configDir`、`logsDir`、`cacheDir`、`thumbnailsDir`、`quarantineDir`、`rulesDir`、`tmpDir` 做 `mkdirSync({ recursive: true })`。它不创建 `dbPath` 这个文件；打开数据库时再建。

打包默认配置还声明了这些名字，供扫描排除和同卷隔离使用，它们 **不是** `resolveAppPaths` 的字段：

| 配置键 | 默认值 | 用途 |
| --- | --- | --- |
| `paths.dbFileName` | `nestify.sqlite` | 与 `dbPath` 对齐 |
| `paths.thumbnailsSubdir` | `cache/thumbnails` | 与 `thumbnailsDir` 对齐 |
| `paths.quarantineDirName` | `.nestify-quarantine` | 库内同卷隔离目录名；扫描默认排除 |

## 3. 配置叠加顺序

后者覆盖前者，只覆盖出现过的键。对象 `deepMerge`；**数组整段替换，不拼接**。

1. `config/app.default.yaml`：打包默认值（locale `zh-CN`、哈希策略、排除名单、Dry-Run、冲突 `suffix`）。
2. `config/windows.yaml` 或 `config/darwin.yaml`：平台差量。可以很瘦；Windows 重申 `locale: zh-CN` 和 `Thumbs.db`，Darwin 补 `.DS_Store`。
3. `%APPDATA%/Nestify/config/app.yaml`：用户全局覆盖。路径必须是 `config/app.yaml`，**不是** 应用根上的 `config.yaml`。与 [`packages/core/src/config/load.ts`](../packages/core/src/config/load.ts) 一致；文件缺失当空覆盖。
4. SQLite `libraries` 行：该库的 `roots_json`、`exclude_globs_json`、`hash_strategy`、`max_depth`、`follow_symlinks`、`scan_hidden` 等。`config/library.default.yaml` 只是建库时的种子（`inherit` 表示沿用应用默认），不直接参与 AppConfig 文件叠加。
5. 环境变量：`NESTIFY_APPDATA` 改应用根，`NESTIFY_DB_PATH` 改 SQLite 文件路径。只覆盖显式传入项，且最后生效。

相关但不进入上述 1–5 链的文件：

- `config/exclusions.default.yaml`：默认排除目录/文件名目录，已被 `app.default.yaml` 的 `scan.excludeGlobs` 吸收。
- `packages/rules/profiles/*.yaml`：RuleSet 方案，按“选中方案 + 作用域”单独加载。外部方案含 delete/quarantine 时，导入后强制 Dry-Run。

当前 `loadAppConfig({ appDataRoot, bundledConfigDir, platform })` 已合并第 1–3 层：`app.default.yaml` → `windows.yaml`/`darwin.yaml` → 用户 `config/app.yaml`。缺失的 overlay / 用户文件按空覆盖跳过。库行与 `NESTIFY_APPDATA` / `NESTIFY_DB_PATH` 仍由调用方在打开库时套上。

## 4. 为什么索引不放在被扫描的库根

v1 使用 Node 内置 `node:sqlite` 打开 **一份** `%APPDATA%/Nestify/nestify.sqlite`。`libraries` 表保存一个或多个根路径，`entries.library_id` 区分库。不按库拆 sqlite，不依赖 `better-sqlite3`，更不把 `index.sqlite` 写进用户目录。

原因：

1. 自扫描。索引、WAL、`-shm`、缩略图、隔离区如果落在库根，下一次 walk 会把应用文件当成条目。
2. 权限。库根可能只读、是 NAS 映射、或用户没有写权限；计划仍要可生成，索引仍要可更新。
3. 可移动 / 断连存储。USB 拔出、SMB 掉线不能把库标损坏，更不能把唯一索引一起带走。
4. 网络盘上的 SQLite 不可靠。UNC/SMB 上跑 WAL 容易锁死或损坏；删除在这些卷上也强制进隔离区，而不是系统回收站。
5. 多根一库。一个 library 可以有多个 `roots`；每根放一份索引无法做跨根去重和统一搜索。

扫描排除默认包含 `$RECYCLE.BIN`、`System Volume Information`、`.git`、`node_modules`、`__pycache__`、`.nestify-quarantine`、`Thumbs.db`、`desktop.ini`。Darwin overlay 另加 `.DS_Store`。

## 5. 隔离区 vs 缩略图缓存

| | 缩略图缓存 | 隔离区 |
| --- | --- | --- |
| 默认位置 | `%APPDATA%/Nestify/cache/thumbnails` | `%APPDATA%/Nestify/quarantine` |
| 性质 | 可丢弃派生数据 | 用户文件的安全副本 |
| 键 | `entry_id + size + mtime + generator_version`，不能只用绝对路径 | 按任务/原路径收纳，保留回滚信息 |
| 丢失后果 | 下次重生成 | 等于丢失用户删除的文件 |
| 是否进扫描 | 不在库根，不进索引 | 库内若使用 `.nestify-quarantine/`，必须排除 |

删除策略（与位置绑定）：

1. 本地卷优先 `shell.trashItem`。
2. 回收站失败则搬入应用隔离区 `quarantine/`。
3. UNC / SMB / 无回收站卷 **强制隔离**，禁止假装进回收站。
4. 严禁静默物理删除。

同卷移动到隔离区时，可以使用库内 `.nestify-quarantine/`（`paths.quarantineDirName`），避免跨卷 copy。那只是可选落点，不是索引或缩略图的家。缩略图永远在应用 `cache/thumbnails`。

覆盖冲突不走密码框。覆盖默认关闭；若用户选择覆盖，后续用显式勾选或键入确认词，并在 Change Plan 里标红。
