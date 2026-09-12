# Nestify Docs

- [00-product-requirements.md](./00-product-requirements.md) 核心需求
- [01-six-core-modules.md](./01-six-core-modules.md) 六大模块与规则流
- [02-tech-stack.md](./02-tech-stack.md) Node + shadcn 技术栈
- [03-architecture.md](./03-architecture.md) 目录树、进程模型、六大模块映射、数据流、配置叠加、DB 位置
- [04-database.md](./04-database.md) SQLite schema 与迁移
- [05-directory-layout.md](./05-directory-layout.md) 仓库树、运行时目录、配置叠加
- [08-performance-sync-trd.md](./08-performance-sync-trd.md) 百万级搜索性能、查询架构与增量同步 TRD
- [09-input-assistant-unification-trd.md](./09-input-assistant-unification-trd.md) 魔法棒 / 输入助手统一：同一套弹层与目录，不合并顶栏搜索和 Spotlight
- [10-organize-trd.md](./10-organize-trd.md) 整理模块：虚拟目录树、规则组、预览优先与嵌套整理
- [06-module-contracts.md](./06-module-contracts.md) 六大模块端口与请求契约
- [07-delivery-status.md](./07-delivery-status.md) 当前实现可用性、IPC 暴露、桌面入口与验收路径

当前交付状态见 [07-delivery-status.md](./07-delivery-status.md)：Electron 内已可用添加/Dialog 编辑资料库、活动扫描暂停/恢复、文件搜索与逐层目录结构、缩略图、规则内容编辑、Dry-run、执行、任务日志和回滚主链路；当前工作台核心控件已完成原生 shadcn/ui 迁移，默认使用官方 light 主题 token。功能验收必须在 Electron 中进行，浏览器只可用于纯 UI 调试；最新全仓 typecheck、core 107 项与 rules 2 项测试、desktop build、diff check 与 Electron `ipcReady` 健康检查均通过。100k/1M SQLite 搜索基准已完成，但百万级全场景 p95 100ms 尚未达标。
