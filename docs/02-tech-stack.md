# Nestify 技术栈（Node + shadcn）

> 配套文档。v1 明确采用 Electron + Node.js + TypeScript + React + shadcn/ui，不上 Rust core。
>
> 当前状态（2026-09-22 / v1.9.0）：打包是 Windows x64 portable exe，输出 `apps/desktop/release/Nestify-v1.9.0.exe`，不是 NSIS。Query / Writer / Preview Worker 已存在。图片缩略图仍是 `nativeImage`；sharp / ffmpeg 仍是目标。状态仍是 React hooks，未引入 Zustand。

## 1. 选型结论

用户已指定：**技术栈用 Node + shadcn**。这与“先出可运行的治理工作台”一致，也和模块五已经点名的 `sharp` / `fluent-ffmpeg` 对齐。

v1 不引入 Rust/NAPI core。扫描、规则、计划、执行仍用 TypeScript 跑在 Electron Main 的 `NestifyRuntime` 中；搜索/目录查询、增量写入和图片缩略图已经拆到 Worker。Renderer 只通过白名单 IPC 调用这些能力。如果以后百万级文件把 JS 打满，再把 scanner/query 替换为 native，但 SQLite schema、规则 YAML、IPC 协议必须先稳定，保证可替换。

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
| 打包 | electron-builder | Windows x64 portable exe，输出 `apps/desktop/release/Nestify-v${version}.exe` |

不采用：Next.js、Remix、服务端渲染、云数据库、Rust core（v1）。

## 3. 进程模型

```text
Renderer (React + shadcn)
  搜索框 / 文件 / 整理 / 改名 / 重复 / 任务 / 预览
        |
preload (contextBridge, 白名单 IPC)
        |
Main process
  窗口、菜单、shell.showItemInFolder、shell.trashItem
  NestifyRuntime：扫描、规则 / 改名预览、计划执行 / 回滚、重复分析、整理快照
  Query Worker / Writer Worker / Preview Worker / Library-removal Worker
        |
Drizzle ORM query builder
        |
node:sqlite DatabaseSync (WAL)
Preview Worker + nestify-thumbnail://
preview cache   (%APPDATA%/Nestify/cache/thumbnails)
quarantine      (%APPDATA%/Nestify/quarantine)
```

硬约束：

1. Renderer 不直接 `fs`、不直接开 SQLite。
2. 当前扫描和重复分析仍在 Electron Main 的 `NestifyRuntime` 中执行。
3. Query / Writer / Preview / Library-removal Worker 已落地。scanner / hasher / rule-vm / planner 仍是后续性能隔离目标。
4. 缩略图队列优先级为 selected > visible > background；生成在 Preview Worker。Renderer 出屏可通过 `preview.thumbnail.cancel` 跨 IPC 取消。
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
  electron/          main, preload, ipc, Query / Writer / Preview / Library-removal Worker
  src/               React + shadcn
    app/             工作台编排
    components/      ui 来自 shadcn，业务组件自建
    lib/             ipc wrappers
  resources/         应用图标
  release/           portable 打包输出
packages/core/       NestifyRuntime 与纯 TS 领域逻辑，可单测，不依赖 Electron
packages/shared/     规则 schema、IPC types、占位符 AST
packages/rules/      内置 RuleSet
scripts/             根目录版本同步到桌面包
```

`packages/core` 必须可在 Node 测试里跑 fixture 目录，不启动 Electron。

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
10. 缩略图：当前由 Preview Worker 调度 Electron `nativeImage`，生成 192x192 JPEG 并落盘；缓存键由 entry、size、mtime 和 generator version 派生，Renderer 只拿 `nestify-thumbnail://cache/...` URL。sharp / WebP 和 ffmpeg 视频抽帧仍是后续替换目标。

## 7. 与六大模块的对应

| 模块 | Node 侧 | shadcn 侧 |
| --- | --- | --- |
| 建巢 | Main Runtime scanner + Drizzle upsert + 进度 IPC | Status Bar、进度、暂停/继续 |
| 寻巢 | Query Worker FTS/trigram query | 搜索框、分页结果、目录结构、魔法棒 |
| 清巢 | size 分桶 + quick/full hash | 重复组表、8 种保留策略、隔离 Dry-Run |
| 精准雕琢 | matcher + template AST + 虚拟 FS | 过滤器、模板输入、from/to 表、魔法棒 |
| 透视眼 | Preview Worker `nativeImage` 缩略图队列；视频 file URL 预览 | 缩略图列、预览面板 |
| 筑巢 | 整理会话快照 + 规则草稿 + planner/executor | 四步向导、独立规则草稿、预览确认 |

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
