# Nestify 技术栈（Node + shadcn）

> 配套文档。v1 明确采用 Electron + Node.js + TypeScript + React + shadcn/ui，不上 Rust core。

## 1. 选型结论

用户已指定：**技术栈用 Node + shadcn**。这与“先出可运行的治理工作台”一致，也和模块五已经点名的 `sharp` / `fluent-ffmpeg` 对齐。

v1 不引入 Rust/NAPI core。扫描、索引、规则、计划、执行全部用 TypeScript 跑在 Electron Main 的 `NestifyRuntime` 中；扫描和分析使用可暂停的异步迭代器让长任务分步执行。Renderer 只通过白名单 IPC 调用这些能力。如果以后百万级文件把 JS 打满，再把 scanner/query 替换为 native，但 SQLite schema、规则 YAML、IPC 协议必须先稳定，保证可替换。

## 2. 确定技术栈

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 壳 | Electron | Windows exe 优先，macOS 兼容 |
| 语言 | TypeScript | Main、Renderer 统一 |
| 渲染层 | React + Vite | 组件化，热更新快 |
| UI | shadcn/ui + Tailwind CSS | 高密度桌面工具风，表格/对话框/表单/命令面板直接复用 |
| 虚拟列表 | 目标 @tanstack/react-virtual | 当前依赖尚未引入；搜索结果先分页，Dry-Run 先按计划规模分批展示 |
| 状态 | 目标 Zustand 或等价轻量库 | 当前实现使用 React hooks / component state，未引入全局状态库 |
| 主进程 | Electron Main + NestifyRuntime | 扫描、分析、规则、执行由 Main 调度；Renderer 不直接访问文件和数据库 |
| 索引 | Drizzle ORM + Node 22 `node:sqlite`（`DatabaseSync`）+ FTS5 | Drizzle 负责类型化 schema 与常规 CRUD query builder；`DatabaseSync` 仍是同步执行驱动，无 native addon 依赖，开启 WAL |
| 图片预览 | 目标 sharp；当前 Electron `nativeImage` | 当前本地图片生成 192x192 JPEG 缩略图；WebP 转码待接 sharp |
| 视频预览 | 目标 fluent-ffmpeg + 本地/可选 ffmpeg | 当前视频只返回 file URL 预览，不生成视频缩略图 |
| 规则序列化 | YAML | 方案导入导出 |
| 打包 | electron-builder | NSIS exe |

不采用：Next.js、Remix、服务端渲染、云数据库、Rust core（v1）。

## 3. 进程模型

```text
Renderer (React + shadcn)
  搜索框 / 结果表 / 规则编辑器 / Dry-Run / 预览
        |
preload (contextBridge, 白名单 IPC)
        |
Main process
  窗口、菜单、shell.showItemInFolder、shell.trashItem
  NestifyRuntime：任务调度、库配置
  scanner / indexer / query / rule-vm / planner / executor / analysis
  长扫描和分析用异步迭代器分步产出
        |
Drizzle ORM query builder
        |
node:sqlite DatabaseSync (WAL)
ThumbnailCacheService + nestify-thumbnail://
preview cache   (%APPDATA%/Nestify/cache/thumbnails)
quarantine      (.nestify-quarantine 或用户目录)
```

硬约束：

1. Renderer 不直接 `fs`、不直接开 SQLite。
2. 当前扫描和分析在 Electron Main 的 `NestifyRuntime` 异步迭代器中执行。
3. 独立 worker / `utilityProcess` 是后续性能隔离目标，用于避免重 IO 和 CPU 分析占用 Main。
4. 缩略图队列在 Main 内独立调度，服务层优先级为 selected > visible > background，搜索结果当前传 visible / background；跨 IPC 的出屏 Abort 传播仍是待补项。
5. 写盘执行器按磁盘/卷限流仍是性能目标；当前执行器先做全量预检，再逐步写盘并记录 `job_ops`。

## 3.1 开发启动边界

开发模式下 Vite 可能输出 `http://localhost:5173/`，但那只是 Renderer 资源服务，不是应用入口。preload 的 `contextBridge` 只存在于 Electron 窗口里；单独用浏览器打开 5173 时 `window.nestify` 不存在，会显示“Nestify IPC 未就绪”，添加目录、系统对话框、扫描和所有 Main IPC 都不可用。

正确启动方式：

```powershell
npm start
# 等价于
npm --workspace @nestify/desktop run start
```

`electron-vite dev` 会同时准备 Renderer dev server 和 Electron Main，并加载 preload。用户应操作弹出的 Electron 窗口；5173 只可作为纯 UI 调试地址，不能作为功能验收入口。

## 4. 目录建议

```text
apps/desktop/
  electron/          main, preload, ipc
  src/               React + shadcn
    components/      ui 来自 shadcn，业务组件自建
    features/        search, rules, duplicates, rename, plan, preview
    lib/             query client, ipc wrappers
  core/              NestifyRuntime 与纯 TS 领域逻辑，可单测，不依赖 Electron
packages/shared/     规则 schema、IPC types、占位符 AST
```

`core/` 必须可在 Node 测试里跑 fixture 目录，不启动 Electron。

## 5. shadcn 使用边界

用 shadcn 做工作台控件，不把它做成营销站：

1. 表格：搜索结果、Dry-Run、重复组，必须虚拟滚动，不能直接用会撑爆 DOM 的普通 Table。
2. 对话框：冲突确认、覆盖确认、方案选择。覆盖确认用明确文案，不用密码框。
3. 表单：规则过滤器、占位符模板、库设置。
4. Command：命令面板搜规则/方案。
5. Sidebar + 底部 Status Bar：库/规则/问题导航 + 扫描进度。
6. 风格：使用 shadcn 官方默认主题 token，默认 light，`.dark` 只保留官方暗色变量；高密度、少装饰。这是文件治理工具，不是相册官网。业务层不得新增私有配色、任意字号或一次性视觉皮肤。

新增业务控件（不在 shadcn 里，要自建）：

1. 路径面包屑
2. from/to 对照列
3. 规则命中解释
4. 占位符当前值检查器
5. 缩略图网格
6. 扫描进度条

## 6. Node 实现要点

1. 扫描用迭代 walk，不用递归。Windows 走 `\\?\` 长路径。
2. `libraries`、`entries`、`rulesets`、`jobs`、`dup_groups`、`dup_members` 和 `thumbnails` 的常规 CRUD / upsert 已走 Drizzle query builder；`node:sqlite` 的 `DatabaseSync` 仍是同步执行驱动，开启 WAL，不引入 `better-sqlite3`。
3. raw SQL 剩版本化 migration、PRAGMA、FTS / trigram、plan / search 边界，以及 duplicate persistence 手工事务；避免把 SQLite 专有能力硬塞进 ORM 模型。
4. 文件名模糊搜：FTS5 + 自建 trigram 表，避免 `LIKE '%keyword%'` 扫全表。
5. Hash：`crypto.createHash('sha256')` 流式读，只对 size 分桶后的候选算。
6. 规则 VM：把模板和链式函数编成 AST，对每个 entry 求值；禁止规则函数里直接 IO。
7. 计划器：内存虚拟路径映射，先出 Dry-Run，再执行。
8. 删除：本地 `shell.trashItem`，失败或网络盘则搬隔离区。
9. 定位：`shell.showItemInFolder`。
10. 缩略图：当前由 Main 侧 `ThumbnailCacheService` 调度 Electron `nativeImage`，生成 192x192 JPEG 并落盘；缓存键由 entry、size、mtime 和 generator version 派生，Renderer 只拿 `nestify-thumbnail://cache/...` URL。sharp / WebP、ffmpeg 视频抽帧和独立 worker 是后续替换目标。

## 7. 与六大模块的对应

| 模块 | Node 侧 | shadcn 侧 |
| --- | --- | --- |
| 建巢 | Main Runtime scanner + Drizzle upsert + 进度 IPC | Status Bar、进度、暂停/继续 |
| 寻巢 | Main Runtime FTS/trigram query | 搜索框、虚拟表格、右键菜单 |
| 清巢 | size 分桶 + quick/full hash | 重复组表、保留策略、Dry-Run |
| 精准雕琢 | matcher + template AST + 虚拟 FS | 过滤器表单、模板输入、from/to 表 |
| 透视眼 | Main 调度 `nativeImage` 缩略图队列；视频 file URL 预览 | 缩略图列、预览面板 |
| 筑巢 | 内置 YAML RuleSet + planner/executor | 方案列表、规则开关、执行确认框 |

## 8. v1 明确放弃

1. Rust/NAPI core
2. Next.js / SSR
3. 云同步与账号
4. 渲染进程里跑全盘 walk
5. 首次启动全量 SHA256

## 9. 验收

1. `npm test` 能在不启动窗口的情况下跑 core / rules 单测。
2. 用 `npm start` 启动 Electron 后，能在弹出的窗口添加一个本地目录，扫完即可搜索。
3. shadcn 使用官方默认主题 token；如后续提供切换，只能切换官方 light/dark token，不引入自定义配色。
4. 打包出 Windows exe，主流程不依赖本机全局 Node。
