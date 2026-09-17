# Nestify Docs

> 当前状态（2026-09-17 / v1.8.1）：产品名是 Nestify。桌面工作台五个入口是文件、整理、改名、重复、任务。设置里有「关于」。版本只写在根目录 `package.json`，启动和打包同步到桌面应用。Windows x64 portable 产物是 `apps/desktop/release/Nestify-v1.8.1.exe`。历史过程保留在各篇正文，不以 2026-09-10 的目标冒充已交付。

- [00-product-requirements.md](./00-product-requirements.md) 核心需求。P0 主链路已落地，P1/P2 仍按原文规划。
- [01-six-core-modules.md](./01-six-core-modules.md) 六大模块与规则流。搜索字段、重复保留策略和预览实现以当前代码为准。
- [02-tech-stack.md](./02-tech-stack.md) Node + shadcn 技术栈。打包是 portable exe，不是 NSIS。
- [03-architecture.md](./03-architecture.md) 仓库树、进程模型、模块映射、数据流、配置叠加、DB 位置。仓库名是 nestify。
- [04-database.md](./04-database.md) SQLite schema 与迁移。当前仍是 schema v7。
- [05-directory-layout.md](./05-directory-layout.md) 仓库树、运行时目录、配置叠加。
- [06-module-contracts.md](./06-module-contracts.md) 六大模块端口与请求契约。
- [07-delivery-status.md](./07-delivery-status.md) 当前实现可用性、IPC、桌面入口与验收路径。
- [08-performance-sync-trd.md](./08-performance-sync-trd.md) 百万级搜索、查询架构与增量同步。P0-P3 基础已落地，P4 仍待决策。
- [09-input-assistant-unification-trd.md](./09-input-assistant-unification-trd.md) 魔法棒 / 输入助手。同一套弹层和目录，不合并顶栏搜索和 Spotlight。
- [10-organize-trd.md](./10-organize-trd.md) 整理模块。四步向导和会话预览已落地，快照持久化与树对比仍是规划。

当前交付状态以 [07-delivery-status.md](./07-delivery-status.md) 为准。Electron 里已经能添加/编辑资料库、增量扫描、文件搜索、目录结构、整理四步预览、模板改名、重复分析、任务回滚；设置里有「关于」。魔法棒贯穿搜索、整理、改名和去重。Query / Writer / Preview / Library-removal Worker 已存在，扫描、规则、计划、重复分析仍有 Main/Runtime 路径。功能验收必须在 Electron 窗口里做，浏览器只能看样式。schema 仍是 v7。100k/1M 热缓存主线达到阶段目标，物理冷缓存、3M/10M、SMB 和 watcher overflow 还没验收。
