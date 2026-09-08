# Nestify Docs

- [00-product-requirements.md](./00-product-requirements.md) 核心需求
- [01-six-core-modules.md](./01-six-core-modules.md) 六大模块与规则流
- [02-tech-stack.md](./02-tech-stack.md) Node + shadcn 技术栈
- [03-architecture.md](./03-architecture.md) 目录树、进程模型、六大模块映射、数据流、配置叠加、DB 位置
- [04-database.md](./04-database.md) SQLite schema 与迁移
- [05-directory-layout.md](./05-directory-layout.md) 仓库树、运行时目录、配置叠加
- [06-module-contracts.md](./06-module-contracts.md) 六大模块端口与请求契约
- [07-delivery-status.md](./07-delivery-status.md) 当前实现可用性、IPC 暴露、桌面入口与验收路径

当前交付状态见 [07-delivery-status.md](./07-delivery-status.md)：Electron 内已可用添加/Dialog 编辑资料库、活动扫描暂停/恢复、文件搜索与逐层目录结构、缩略图、规则内容编辑、Dry-run、执行、任务日志和回滚主链路；当前工作台核心控件已完成原生 shadcn/ui 迁移，默认使用官方 light 主题 token。功能验收必须在 Electron 中进行，浏览器只可用于纯 UI 调试；最新全仓 typecheck、84/84 测试、desktop build、diff check 与 Electron `ipcReady` 健康检查均通过。
