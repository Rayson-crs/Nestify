# Nestify 模块契约

> 冻结六大模块端口、请求类型和当前 `not_implemented` 行为。实现可以后补，控制器签名先稳定。
>
> 产品是规则驱动的本地文件治理工作台：Electron + Node + TypeScript + React + shadcn。v1 不上 Rust。

三条铁律：

1. 先匹配，后动作。
2. 先 Change Plan / Dry-Run，再写盘。
3. 破坏性操作可预览、可抽样、可回滚。

模块端口在 [`packages/core/src/modules`](../packages/core/src/modules)。当前只有类型、注册表和 `not_implemented` 控制器，没有真实 worker。Renderer 只经 IPC 调这些端口，不直接 `fs`、不开 SQLite。

## 1. 六大模块

| 产品名 | ModuleId | workerName | 端口文件 | 主请求类型 | 控制器 |
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
  onProgress?: (progress: ScanProgress) => void
}
```

v1 只有一份 SQLite：`%APPDATA%/Nestify/nestify.sqlite`。`libraries` 表保存根路径；`ModuleContext.dbPath` 指向这一份文件，不是每库一份。

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

`ScanController`：`execute` / `pause` / `resume` / `cancel` / `progress`。进度 `ScanProgress.phase` 为 `walk` | `upsert` | `idle` | `cancelled`。

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

查询走同一份 SQLite 的 FTS5 + trigram，不现场 `readdir`。`limit` 默认 200，`debounceMs` 默认 300，都只是 UI/查询上限，不是性能来源。

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

入口是“分析重复”，不是“立刻全库 Hash”。`keepStrategy` 只预勾选，仍进 Dry-Run；默认 newest 按 mtime。`DuplicatesController.execute` 在确认计划前不得写盘。

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

`preview` 产出 from/to/reason 计划，不写盘。`collision` 默认 `suffix`。`overwrite` 需要后续显式确认，不要密码框。目录改名与文件改名可同一次计划，由虚拟 FS 算最终路径。

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

内置方案来自 `@nestify/rules`：`download-inbox`（默认下载整理，全部 Dry-Run，规则 4 禁用）、`media-rename`（路径上下文改名示例）。`dryRun` 缺省为 `true`。`preview` 出 Change Plan；`execute` 在确认前拒绝落地。

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

缓存目录：`%APPDATA%/Nestify/cache/thumbnails`。缓存键 `entry_id + size + mtime + generator_version`。队列优先级：当前选中 > 可视区 > 后台；出屏取消。默认 128 WebP；ffmpeg 未装时视频降级为图标。

## 4. 当前实现状态

每个 `createController()` 返回 typed 方法，但 `execute` / `analyze` / `preview` / `pause` / `resume` / `cancel` / `progress` 一律：

```ts
Promise.reject(new Error('not_implemented'))
```

这是有意的。worker（scanner / query / hasher / rule-vm / thumbnail / planner）落地前，端口必须先拒绝写盘和假进度，避免 UI 以为已经扫描或已经整理。

后续接 worker 时保持同一请求类型：

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
