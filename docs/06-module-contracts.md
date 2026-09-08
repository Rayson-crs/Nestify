# Nestify 模块契约

> 冻结六大模块端口、请求类型和当前 `not_implemented` 占位行为。控制器签名保持稳定。
>
> 产品是规则驱动的本地文件治理工作台：Electron + Node + TypeScript + React + shadcn。v1 不上 Rust。

三条铁律：

1. 先匹配，后动作。
2. 先 Change Plan / Dry-Run，再写盘。
3. 破坏性操作可预览、可抽样、可回滚。

模块端口在 [`packages/core/src/modules`](../packages/core/src/modules)。这些控制器当前仍是有意的 `not_implemented` 占位；真实入口是 Electron Main 内的 `NestifyRuntime` 和 preload 白名单 IPC。Renderer 不直接 `fs`、不开 SQLite。Node worker / `utilityProcess` 仍是后续架构目标。

## 1. 六大模块

| 产品名 | ModuleId | 目标 workerName | 端口文件 | 主请求类型 | 控制器 |
| --- | --- | --- | --- | --- | --- |
| 建巢 | `scan` | `scanner` | `scan.ts` | `ScanRequest` | `ScanController` |
| 寻巢 | `search` | `query` | `search.ts` | `SearchRequest` | `SearchController` |
| 清巢 | `duplicates` | `hasher` | `duplicates.ts` | `DuplicateAnalyzeRequest` | `DuplicatesController` |
| 精准雕琢 | `rename` | `rule-vm` | `rename.ts` | `RenamePreviewRequest` | `RenameController` |
| 透视眼 | `preview` | `thumbnail` | `preview.ts` | `ThumbnailRequest` | `PreviewController` |
| 筑巢 | `organize` | `planner` | `organize.ts` | `OrganizeRequest` | `OrganizeController` |

`ModuleRegistry` 列出这六个模块的 `id`、`titleZh`、`workerName`。`createController(id)` 返回对应 typed 控制器。

共享上下文：

```ts
interface ModuleContext {
  libraryId: string
  libraryRoot?: string
  dbPath?: string
  abortSignal?: AbortSignal
  pauseGate?: PauseGate
  onProgress?: (progress: ScanProgress) => void
}
```

v1 只有一份 SQLite：Node 内置 `node:sqlite` 打开的 `%APPDATA%/Nestify/nestify.sqlite`。`libraries` 表保存根路径；`ModuleContext.dbPath` 指向这一份文件，不是每库一份。

## 2. 默认安全与哈希

| 项 | 默认 | 说明 |
| --- | --- | --- |
| Dry-Run | `safety.dryRunDefault: true` | 写盘动作默认只出计划。`OrganizeRequest.dryRun` 未传时按此默认。 |
| Hash | `scan.defaultHashStrategy: duplicate-candidate-only` | 首次扫描禁止全量 SHA256。 |
| 覆盖 | 关闭；后续 typed/explicit confirm | 不要密码框。 |
| 删除 | 本地 `shell.trashItem`，失败进隔离区 | UNC/SMB 强制隔离。 |
| 筑巢规则 4 | `move-videos-to-videos-folder` 默认禁用 | 目标是库内 `Videos/`，不是盘符根。 |

增量扫描键（变化才重摘信号）：

```text
path + ino/dev + size + mtime + is_dir
```

重复分析流水线（hasher，不是首次 walk）：

```text
size bucket (count >= 2)
  -> quick hash（头 1MB + size + 尾 64KB）
  -> full hash 确认
```

同一 inode / 硬链接标为同一物理文件，不记浪费空间。Hash 策略可被 `ScanRequest.hashStrategy`、`DuplicateAnalyzeRequest.hashStrategy` 或 `libraries.hash_strategy` 覆盖：`off` / `on-demand` / `duplicate-candidate-only` / `all`。

## 3. 请求类型

类型源：[`packages/core/src/modules/types.ts`](../packages/core/src/modules/types.ts)。

### 3.1 ScanRequest（建巢 / scanner）

```ts
interface ScanRequest {
  roots: string[]
  mode?: 'fast' | 'deep'
  incremental?: boolean
  hashStrategy?: 'off' | 'on-demand' | 'duplicate-candidate-only' | 'all'
  excludes?: string[]
}
```

| 字段 | 含义 |
| --- | --- |
| `roots` | 本次 walk 的根。通常来自 `libraries.roots_json`，也可临时收窄。 |
| `mode` | `fast`：path / size / mtime / ino / kind，不算 full hash。`deep` 才允许补哈希和媒体信号。 |
| `incremental` | `true` 时用增量键对比；未变化复用行，变化才 invalidate hash/preview/signals。 |
| `hashStrategy` | 缺省 `duplicate-candidate-only`。首次扫描即使 `deep` 也不默默改成 `all`。 |
| `excludes` | 额外排除；与默认 `$RECYCLE.BIN`、`.git`、`node_modules`、`.nestify-quarantine` 等合并。 |

契约方法为 `execute` / `pause` / `resume` / `cancel` / `progress`。当前由 `NestifyRuntime.startScan` / `pauseScan` / `resumeScan` / `cancelScan` / `getScanProgress` 实现，并通过 `scan.*` IPC 暴露。进度 `ScanProgress.phase` 为 `walk` | `upsert` | `idle` | `cancelled`，暂停时带 `paused: true`。

### 3.2 SearchRequest（寻巢 / query）

```ts
interface SearchRequest {
  query: string
  limit?: number
  offset?: number
  debounceMs?: number
  kinds?: string[]
}
```

当前由 `NestifyRuntime.search` 查同一份 SQLite 的 FTS5 + trigram，不现场 `readdir`。`limit` 默认 200，`debounceMs` 默认 300，都只是 UI/查询上限，不是性能来源。

### 3.3 DuplicateAnalyzeRequest（清巢 / hasher）

```ts
interface DuplicateAnalyzeRequest {
  scope?: 'library' | 'directory' | 'selection'
  entryIds?: string[]
  directory?: string
  hashStrategy?: Exclude<HashStrategy, 'off'>
  keepStrategy?: 'newest' | 'oldest' | 'shortest_path' | 'name_quality' | 'preferred_dir'
}
```

入口是“分析重复”，不是“立刻全库 Hash”。当前由 `NestifyRuntime.analyzeDuplicates` 实现：先 size bucket，再 quick hash，最后 full hash 确认；支持 `library` / `directory` / `selection` 三种 scope，以及 `newest` / `oldest` / `shortest_path` / `name_quality` / `preferred_dir` 五种保留策略。`keepStrategy` 只决定每组保留哪一份，输出仍是隔离 Dry-Run 计划；确认执行前不写盘。

### 3.4 RenamePreviewRequest（精准雕琢 / rule-vm）

```ts
interface RenamePreviewRequest {
  template: string
  match?: unknown
  scope?: OrganizeScope
  entryIds?: string[]
  directory?: string
  collision?: 'suffix' | 'skip' | 'overwrite'
}
```

当前由 `NestifyRuntime.previewRename` 产出 from/to/reason 计划，不写盘。`collision` 默认 `suffix`。`overwrite` 需要后续显式确认，不要密码框。目录改名与文件改名可同一次计划，由虚拟 FS 算最终路径。

### 3.5 OrganizeRequest（筑巢 / planner）

```ts
interface OrganizeRequest {
  profileId: string
  scope?: 'library' | 'directory' | 'selection'
  entryIds?: string[]
  directory?: string
  dryRun?: boolean
  collision?: CollisionStrategy
}
```

内置方案来自 `@nestify/rules`：`download-inbox`（默认下载整理，全部 Dry-Run，规则 4 禁用）、`media-rename`（路径上下文改名示例）。`dryRun` 缺省为 `true`。当前由 `NestifyRuntime.previewRules` 生成 Change Plan，`executePlan` 只在 UI 确认 preview/draft 计划后落地。

规则 4 `move-videos-to-videos-folder` 即使以后启用，目标也是 `{library}/Videos/`，不是盘符根 `Videos`。

### 3.6 ThumbnailRequest（透视眼 / thumbnail）

```ts
interface ThumbnailRequest {
  entryId: string
  kind?: 'image' | 'video'
  width?: number
  height?: number
  priority?: 'selected' | 'visible' | 'background'
}
```

当前 Runtime / IPC 已支持图片内嵌预览和视频文件 URL 预览；缩略图生成队列、WebP 缓存和 ffmpeg 降级仍是后续 `thumbnail` worker 目标。目标缓存目录：`%APPDATA%/Nestify/cache/thumbnails`，缓存键 `entry_id + size + mtime + generator_version`，队列优先级为当前选中 > 可视区 > 后台，出屏取消。

## 4. 当前实现状态

`packages/core/src/modules` 的每个 `createController()` 返回 typed 方法，但 `execute` / `analyze` / `preview` / `pause` / `resume` / `cancel` / `progress` 一律：

```ts
Promise.reject(new Error('not_implemented'))
```

这是有意的稳定占位，防止绕过 Runtime 的安全边界、假进度或未确认写盘。

当前真实入口是 Electron Main 内的 `NestifyRuntime`：

- 扫描：启动、进度、pause / resume / cancel；活动扫描期间同库不能移除。
- 搜索：FTS5 + trigram。
- 规则 / 改名：Dry-Run Change Plan。
- 计划：执行、`jobs` / `job_ops` 记录、按任务回滚、执行后增量刷新。
- 重复分析：3 种 scope、5 种 `keepStrategy`，输出隔离 Dry-Run 计划。
- 预览：图片内嵌 Data URL、视频 file URL；过大图片返回 `too-large`。

后续接 Node worker / `utilityProcess` 时保持同一请求类型和数据流：

```text
ScanRequest
  -> scanner 迭代 walk
  -> sqlite entries / paths / fts upsert
  -> SearchRequest / RuleSet match 读同一份索引
  -> planner 在虚拟 FS 上生成 Change Plan
  -> UI Dry-Run 确认
  -> executor 写盘
  -> job_ops 记录 + 索引增量更新
```

同卷 `rename`，跨卷 copy + verify + delete。删除优先系统回收站，失败或网络盘进 `%APPDATA%/Nestify/quarantine`。执行后按任务回滚，不需要全库重扫。
