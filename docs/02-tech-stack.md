# Nestify 技术栈（Node + shadcn）

> 配套文档。v1 明确采用 Electron + Node.js + TypeScript + React + shadcn/ui，不上 Rust core。

## 1. 选型结论

用户已指定：**技术栈用 Node + shadcn**。这与“先出可运行的治理工作台”一致，也和模块五已经点名的 `sharp` / `fluent-ffmpeg` 对齐。

v1 不引入 Rust/NAPI core。扫描、索引、规则、计划、执行全部用 TypeScript 跑在 Electron 主进程和 Node worker 里。如果以后百万级文件把 JS 打满，再把 scanner/query 替换为 native，但 SQLite schema、规则 YAML、IPC 协议必须先稳定，保证可替换。

## 2. 确定技术栈

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 壳 | Electron | Windows exe 优先，macOS 兼容 |
| 语言 | TypeScript | 主进程、worker、渲染层统一 |
| 渲染层 | React + Vite | 组件化，热更新快 |
| UI | shadcn/ui + Tailwind CSS | 高密度桌面工具风，表格/对话框/表单/命令面板直接复用 |
| 虚拟列表 | @tanstack/react-virtual | 搜索结果和 Dry-Run 表都不允许全量 DOM |
| 状态 | Zustand 或等价轻量库 | 不要上过重的全局方案 |
| 主进程 | Electron Main + utilityProcess / worker_threads | 扫描、哈希、规则、执行绝不能堵渲染进程 |
| 索引 | better-sqlite3 + FTS5 | 同步 API 快，扫描写入和查询分连接 |
| 图片预览 | sharp | 128x128 WebP 缩略图 |
| 视频预览 | fluent-ffmpeg + 本地/可选 ffmpeg | 抽第一帧；未安装则降级 |
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
  任务调度、库配置
        |
Node Workers / utilityProcess
  scanner / indexer / query / rule-vm / planner / executor / thumbnail
        |
better-sqlite3  (WAL)
preview cache   (%APPDATA%/Nestify/cache/thumbnails)
quarantine      (.nestify-quarantine 或用户目录)
```

硬约束：

1. Renderer 不直接 `fs`、不直接开 SQLite。
2. 扫描和哈希在 worker 里，主进程只收进度。
3. 缩略图队列独立，当前选中优先，出屏取消。
4. 写盘执行器按磁盘/卷限流，前台搜索仍可查询。

## 4. 目录建议

```text
apps/desktop/
  electron/          main, preload, ipc
  src/               React + shadcn
    components/      ui 来自 shadcn，业务组件自建
    features/        search, rules, duplicates, rename, plan, preview
    lib/             query client, ipc wrappers
  workers/           scanner, hasher, rule-vm, planner, executor, thumbs
  core/              纯 TS 领域逻辑，可单测，不依赖 Electron
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
6. 风格：深色默认、高密度、8px 内卡片半径、少装饰。这是文件治理工具，不是相册官网。

新增业务控件（不在 shadcn 里，要自建）：

1. 路径面包屑
2. from/to 对照列
3. 规则命中解释
4. 占位符当前值检查器
5. 缩略图网格
6. 扫描进度条

## 6. Node 实现要点

1. 扫描用迭代 walk，不用递归。Windows 走 `\\?\` 长路径。
2. `better-sqlite3` 开 WAL；扫描写连接和查询读连接分开。
3. 文件名模糊搜：FTS5 + 自建 trigram 表，避免 `LIKE '%keyword%'` 扫全表。
4. Hash：`crypto.createHash('sha256')` 流式读，只对 size 分桶后的候选算。
5. 规则 VM：把模板和链式函数编成 AST，对每个 entry 求值；禁止规则函数里直接 IO。
6. 计划器：内存虚拟路径映射，先出 Dry-Run，再执行。
7. 删除：本地 `shell.trashItem`，失败或网络盘则搬隔离区。
8. 定位：`shell.showItemInFolder`。
9. 缩略图：worker 调 sharp/ffmpeg，结果落盘，Renderer 只拿 `media://` 或 file URL。

## 7. 与六大模块的对应

| 模块 | Node 侧 | shadcn 侧 |
| --- | --- | --- |
| 建巢 | scanner worker + sqlite upsert + 进度 IPC | Status Bar、进度、暂停/继续 |
| 寻巢 | FTS/trigram query worker | 搜索框、虚拟表格、右键菜单 |
| 清巢 | size 分桶 + quick/full hash | 重复组表、保留策略、Dry-Run |
| 精准雕琢 | matcher + template AST + 虚拟 FS | 过滤器表单、模板输入、from/to 表 |
| 透视眼 | sharp / fluent-ffmpeg worker | 缩略图列、预览面板 |
| 筑巢 | 内置 YAML RuleSet + planner/executor | 方案列表、规则开关、执行确认框 |

## 8. v1 明确放弃

1. Rust/NAPI core
2. Next.js / SSR
3. 云同步与账号
4. 渲染进程里跑全盘 walk
5. 首次启动全量 SHA256

## 9. 验收

1. `pnpm test` 能在不启动窗口的情况下跑规则、计划、路径清洗单测。
2. 开发模式能添加一个本地目录，扫完即可搜索。
3. shadcn 主题可切换深色，默认深色。
4. 打包出 Windows exe，主流程不依赖本机全局 Node。
