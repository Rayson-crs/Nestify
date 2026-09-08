# Nestify 交付状态地图

更新时间：2026-09-08。本文基于 `packages/core/src`、`apps/desktop/electron`、`apps/desktop/src` 的当前实现整理；数据库表结构和模块契约细节以 [04-database.md](./04-database.md)、[06-module-contracts.md](./06-module-contracts.md) 为准，本文只做交付可用性判断。

## 总体判断

当前版本已经可以在 Electron 中完成一条真实的本地文件治理链路：添加资料库、增量扫描、搜索、生成 Dry-run Change Plan、确认执行、查看任务日志并回滚。SQLite、规则/改名/重复清理、图片缩略图和桌面 Shell 能力均有真实实现，不再只是类型契约。

适用边界同样明确：它适合开发联调和内部验收，还不适合作为普通用户发行版。主要缺口是媒体/预览策略执行、真正的 worker 隔离、视频缩略图，以及 Electron 安全加固。

## 已完成的核心能力

### 桌面 UI

- 当前工作台所需的核心交互控件已完成原生 shadcn/ui 迁移：Select、Checkbox、Tabs、Dialog、AlertDialog、Alert、ScrollArea、Separator、Label、Textarea 与进度条均使用 `src/components/ui` 组件，临时 `NativeSelect` 用法已移除。
- 主界面与自定义规则编辑器共用这套控件；入口默认使用官方 shadcn light token，不挂载 `dark` 类，Electron 窗口背景为白色。`.dark` 仅保留官方暗色变量备用，业务层不新增私有配色或一次性皮肤样式。
- 资料库编辑使用 shadcn Dialog 弹窗；普通操作提示使用 Alert 自动在 4 秒后消失，错误提示保持可见便于排查。

### 运行时与存储

- `NestifyRuntime` 负责应用目录、配置叠加、SQLite 生命周期、扫描任务、搜索、规则/改名预览、计划执行/回滚、重复分析和缩略图服务。
- `ModuleRegistry(runtime)` / `createRuntimeController` 已提供 runtime-backed module facade；默认 controller 仍保持占位，写盘落地仍必须走 `Runtime.executePlan`。
- 数据库使用 Node 22 内置 `node:sqlite`，打开时设置 WAL、外键和 busy timeout，并应用版本化迁移；当前 schema version 为 2。
- Drizzle schema 和 query builder 已接入 `DatabaseSync` 适配层；`libraries`、`entries`、`rulesets`、`jobs`、`dup_groups`、`dup_members` 和 `thumbnails` 的常规 CRUD 已走 Drizzle query builder，`DatabaseSync` 仍是同步执行驱动。
- raw SQL 剩版本化 migration / PRAGMA、FTS / trigram、plan / search 边界，以及 duplicate persistence 手工事务。
- `libraries`、`entries`、FTS/trigram、重复组、规则集、任务日志和缩略图缓存均有落库表。

### 资料库与扫描

- 支持资料库新增、编辑、移除和列表；库级根目录、排除规则、扫描深度、符号链接、隐藏文件、哈希/媒体/预览策略可通过 `library.update` -> `NestifyRuntime.updateLibrary` 持久化。
- 扫描是增量模式：按 path、ino/dev、size、mtime、is_dir 判断是否复用索引行，缺失文件打 tombstone。
- Walk 会应用默认排除、库级排除、最大深度、隐藏文件和符号链接设置，并写入 entries、FTS 触发器和 name trigrams。
- 活动扫描任务支持暂停后按原 `jobId` 恢复，任务状态和原始开始时间会持久化；进度轮询返回 `jobId`、`libraryId` 与 `jobStatus`。同一 Runtime 同时只允许一个活动扫描，取消路径仍走独立取消语义。
- 扫描完成后 UI 会读取最终任务状态；只有任务为 `completed` 时进度条才显示绿色 100%，取消或失败不会被误标为完成。

### 搜索与预览

- 搜索同一份 SQLite 索引，不现场遍历磁盘；长词走 FTS5，短词/模糊词走 trigram，并有 LIKE 兜底。
- 支持类型、排序、分页、全库/目录/选择集三种 scope，以及 `ext:`、`parent:`、`path:`、`size:`、`mtime:` 等查询语法。默认排序为“目录层级 + 时间”，SQL 在分页前先按目录优先，再按路径层级和修改时间排列。
- `directChildren` 查询返回指定目录的直接子项，供桌面“目录结构”视图逐层进入 / 面包屑逐层返回；Windows 盘符和反斜杠路径会先做规范化。
- 文件预览支持小图片内嵌 Data URL、常见视频 file URL 播放、超大图片 `too-large` 状态。
- 图片缩略图有 Main 进程优先级队列、磁盘缓存、缓存键校验、路径边界校验和只读 `nestify-thumbnail://` 协议；Electron 使用 `nativeImage` 生成本地图片缩略图，支持选中项优先级和 Renderer `AbortSignal` 跨 IPC 取消。

### 规则、计划与执行

- 内置规则集可列出和预览，但在桌面 UI 中只读；自定义规则集支持创建、更新、启停、调优先级、克隆、删除、YAML 导入导出。
- 自定义规则集支持完整规则内容编辑：规则集元数据、冲突策略、Dry-run 设置，以及单条规则启停、排序、增删和 `id` / `priority` / `action` / `template` / `reason` 编辑；`match` / `extract` 使用 JSON 文本编辑并做结构校验。
- 破坏性规则仍强制 Dry-run，实际写盘必须先生成并确认 Change Plan，再经计划执行链路落地。
- 规则预览和模板改名都会生成 Change Plan，先展示 from/to、风险、原因和默认勾选，不直接写盘。
- 计划执行前做路径、库边界、保护目录、非法名称和目标占用校验；同卷 rename，跨卷 copy + size/hash 校验后删除来源。
- 删除动作被执行器禁用，重复清理和规则清理统一进入隔离区；`jobs` / `job_ops` 记录任务与逐步结果。
- 已执行任务可按成功操作逆序回滚，并在执行/回滚后触发增量索引刷新。

### 重复文件分析

- 分析流程为 size bucket、quick hash、full hash 确认；同一 inode/硬链接会被合并，不重复计算浪费空间。
- 支持全库、目录、选择集三种 scope，以及最新、最旧、路径最短、文件名质量、优先目录五种保留策略。
- 分析结果持久化重复组和成员，并输出可勾选、可执行、可回滚的隔离计划。

## Electron IPC 暴露能力

preload 通过 `contextBridge.exposeInMainWorld('nestify', api)` 暴露以下白名单能力；Renderer 不直接访问 Node API、文件系统或 SQLite。

Renderer 以 `window.nestify` 初始化 `ipcReady`；preload 未注入时不发起功能 IPC，直接显示“Nestify IPC 未就绪”。Electron Main 在页面加载后执行 renderer health check，确认 `window.nestify` 存在。

| 能力组 | IPC channel | 当前用途 |
| --- | --- | --- |
| 资料库 | `library.list` / `library.add` / `library.update` / `library.remove` | 库列表、创建、设置编辑、移除 |
| 系统对话框 | `dialog.pickDirectory` | 添加资料库时选择根目录 |
| 扫描 | `scan.start` / `scan.progress` / `scan.pause` / `scan.resume` / `scan.cancel` | 启动、轮询活动任务进度与身份、暂停、按原任务恢复、取消 |
| 搜索 | `search.query` | 文本、类型、排序、分页和 scope 查询 |
| 规则集 | `rules.list` / `rules.get` / `rules.create` / `rules.update` / `rules.delete` / `rules.enable` / `rules.priority` / `rules.clone` / `rules.export` / `rules.import` | 规则集管理与 YAML 导入导出 |
| 计划预览 | `rules.preview` / `rename.preview` | 规则整理和模板改名 Dry-run |
| 计划落地 | `plan.execute` / `plan.rollback` | 执行选中操作和按任务回滚 |
| 任务 | `jobs.list` / `job.ops` | 最近任务与逐步日志 |
| 重复分析 | `duplicates.analyze` | 生成重复组和隔离计划 |
| Shell | `shell.reveal` / `shell.open` / `clipboard.writeText` | 定位、系统打开、复制路径 |
| 预览 | `preview.file` / `preview.thumbnail` / `preview.thumbnail.cancel` | 选中文件预览、搜索图片缩略图和跨 IPC 取消 |

## 桌面可用入口

| 入口 | 当前可用操作 |
| --- | --- |
| 左侧资料库栏 | 添加、Select 选择、Dialog 编辑、移除资料库；启动扫描；扫描中暂停/恢复/取消 |
| 文件页 | 关键词搜索、类型/排序/scope/分页、勾选结果、图片缩略图、打开/复制路径、跳转目录结构，以及把选择集送往规则/改名/重复流程 |
| 文件页目录结构 | 面包屑逐层返回、目录逐层进入、目录优先列表、打开文件、复制路径 |
| 右侧预览栏 | 查看选中条目元数据、小图片预览、视频播放，并执行系统打开 |
| 规则页 | 选择规则集、编辑自定义规则内容、管理自定义规则集、导入导出 YAML、生成 Dry-run、勾选执行、回滚 |
| 改名页 | 输入模板、选择作用域和冲突策略、预览改名、勾选执行、回滚 |
| 重复页 | 选择作用域和保留策略、分析重复组、勾选隔离、回滚 |
| 任务页 | 查看最近任务、状态、统计和逐步日志，并对可回滚任务发起回滚 |

## 暂未闭环能力

- `mediaStrategy` 目前主要是持久化字段，标准/深度媒体信号分析未实现；`signals` 表尚未进入实际数据流。
- `previewStrategy` 未完全驱动调度：搜索图片缩略图按可见/后台优先级请求，视频缩略图和 eager/off 等完整策略语义未闭环。
- 库级 `hashStrategy` 已保存，但扫描阶段不物化 quick/full hash；重复分析在分析时按请求或默认策略计算哈希，库级设置与分析参数的联动还需要收敛。
- `overwrite` 和 `delete` 不是可交付执行语义：执行器会跳过 overwrite 风险并禁用 delete，实际破坏性收敛依赖隔离区；这与“回收站删除”的目标契约仍有差异。
- 六大模块的默认控制器仍返回 `not_implemented`。`ModuleRegistry(runtime)` / `createRuntimeController` 已提供 runtime-backed facade：scan/search/preview、organize/rename 的 preview、duplicates.analyze 可用；organize/rename/duplicates 的模块级 execute 刻意保持 `not_implemented`，必须经已确认 Change Plan 和 `Runtime.executePlan`（preload IPC 为 `plan.execute`）落地，避免绕过 Dry-run 与执行校验。
- scanner/query/hasher/rule-vm/planner/thumbnail worker 或 `utilityProcess` 尚未落地，扫描、哈希、同步 SQLite 操作和缩略图生成仍在 Main/Runtime 进程内，长库和大库可能影响响应性。
- 视频抽帧、ffmpeg 降级和 WebP/sharp 方案未实现。
- `scan_cursors` 表已定义但断点续扫未实现；当前暂停/取消不等于可跨进程重启续扫。
- Electron 当前 `sandbox: false` 且 `webSecurity: false`。虽然 IPC 白名单和 context isolation 已存在，发行前仍需要安全评审和本地资源访问方案收敛。

## 用户验收路径（仅 Electron）

最新验证快照：全仓 `npm run typecheck` 通过，`npm test` 84/84 通过，desktop build 通过，`git diff --check` 通过；Electron health check 确认 Renderer `ipcReady: true`。

功能验收必须从 Electron 启动，不要打开 Vite 的浏览器地址；浏览器页面没有 `window.nestify`，会直接显示“Nestify IPC 未就绪”。浏览器只能作为纯视觉调试入口，其中的操作结果不作为功能验收证据。

1. 在仓库根目录执行 `npm install`（依赖已就绪时可跳过），再执行 `npm start`。该命令通过 workspace 启动 `@nestify/desktop` 的 Electron dev shell。
2. 确认 Electron 窗口可启动，页面没有 IPC 未就绪或数据库初始化错误。
3. 准备一个只用于验收的临时目录，复制少量图片、视频、文档和两个内容完全相同的文件。点击“添加”选择该目录。
4. 点击“扫描”，观察文件/目录计数、当前路径、速度和错误数；扫描期间试一次暂停/恢复，等待完成后确认进度条为绿色 100%。
5. 在文件页验证关键词、类型筛选、“目录层级 + 时间”排序、分页和目录 scope；切换“目录结构”后用面包屑逐层返回、用目录行逐层进入。图片结果应出现缩略图，选中文件后右侧应显示元数据并可用“打开”。
6. 勾选少量文件，送入改名页，输入模板并预览；检查 from/to、风险和默认勾选后只执行一条，确认磁盘变化、搜索刷新、任务日志和回滚结果。
7. 选择内置规则集做 Dry-run，确认能生成计划并能查看任务与逐步日志；只有继续使用隔离副本时才执行规则计划。
8. 在重复页对包含相同文件的目录执行分析，确认重复组、保留项、可释放空间和隔离计划；执行一条选中操作后到任务页回滚并确认原路径恢复。
9. 关闭并重新执行 `npm start`，确认资料库、索引、任务历史和缩略图缓存仍然可用。

打包链路可在上述开发验收通过后再验证：`npm run dist` 会构建桌面应用并生成 Windows portable 包。若 dev Electron 无法启动，浏览器验收不作为替代结果。
