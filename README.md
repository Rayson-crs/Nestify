<div align="center">

<img src="./apps/desktop/resources/nestify-icon.png" width="72" alt="Nestify" />

**Nestify**

本机文件治理工作台。给指定目录建索引，再搜索、整理、改名和去重。写盘前先出变更计划，确认后才执行，执行完可以按任务回滚。

</div>

## 它解决什么

资源管理器能打开目录，但不适合处理几万到几十万个文件堆在一起的情况。下载目录、移动硬盘、NAS 映射盘常见的问题不是“找不到某一个文件”，而是这些事情叠在一起：

- 目录很深，同名副本、压缩包和解压结果同时存在。
- 真正有用的名字经常不在当前文件名上，而在父目录、祖父目录，或者目录里那一个主视频上。
- 系统搜索慢，过滤能力弱。PowerToys 能批量改名，Everything 能快搜，去重工具能比哈希，但规则不能共用，改完也没有统一的预览和回滚。
- 直接对磁盘跑脚本最危险。路径冲突、文件占用、网络盘掉线，出错时往往已经改了一半。

Nestify 把这些步骤收成一条本地流水线：先扫描进 SQLite，再按规则匹配，再生成 Dry-run 计划，最后才写盘。索引和缓存放在应用数据目录，不往被扫描的库根里塞数据库文件。

它不是网盘，不是备份软件，也不是资源管理器替代品。预览是为了核对规则，不是做播放器。v1 不做云账号、双向同步、定时无人值守删除。

## 为什么要做

整理乱目录这件事，现成工具都能做一点，但缺的是同一套数据。搜索用一套索引，改名又现场遍历，去重再扫一遍哈希，规则写完只能用一次。目录一乱，正确信号又分散在路径层级里，单看文件名的工具基本做不好 `a/b/c/a.txt -> b.txt` 这种改名。

所以这个项目从一开始就按工作台来做，而不是再画一个文件树：

1. 库是治理范围，不是“再做一个盘符窗口”。
2. 规则操作的是路径、扩展名、目录子项这类信号，不只是当前文件名。
3. 任何会改磁盘的动作都先出计划。删除默认进隔离区，不静默物理删除。

技术上用 Electron + Node.js + TypeScript，是为了先把产品契约跑通：SQLite schema、规则 YAML、IPC、计划执行和回滚。扫描和查询已经拆了一部分 Worker；后面如果真把百万文件打满，替换的是 Worker，不是整套界面和协议。

## 现在能做什么

打开 Electron 窗口后，主界面是资料库栏加五个工作区：文件、整理、改名、重复、任务。设置里有「关于」，会显示 Logo、名称、版本、作者和仓库地址。


| 入口        | 做什么                                                                |
| --------- | ------------------------------------------------------------------ |
| 资料库       | 添加本机目录、多文件夹或按磁盘建库；扫描可暂停、恢复、取消。                                     |
| 文件        | 按文件名 / 路径搜索，支持 `ext:`、`kind:`、`parent:`、`size:` 等过滤；也可以切到目录结构逐层进入。 |
| Spotlight | 默认 `Ctrl+Space`，在已索引内容里快速搜并打开。快捷键可在设置里改。                           |
| 整理        | 选定目录后配规则：移动、改文件名、改目录名、拍平套娃、送隔离区。先预览再执行。                            |
| 改名        | 用模板和规则组批量改名，界面上红绿对照旧名和新名。                                          |
| 重复        | 先按大小分桶，再算哈希；可选保留最新、最旧、路径最短、文件名质量等策略。                               |
| 任务        | 查看执行记录和逐步日志，按任务回滚已经成功的操作。                                          |
| 设置 / 关于   | 扫描和缩略图线程、搜索延迟、关闭窗口最小化到托盘；关于页展示当前版本。                                |


表格只是入口。真正把这个工作台和其他文件工具分开的，是同一套输入助手贯穿搜索、整理、改名和去重。

### 魔法棒 / 输入助手

搜索框、Spotlight、整理筛选、改名范围、改名分组条件和改名模板，右侧都是同一根火花按钮。点开后是同一份能力目录，不是每个页面再做一套助手。顶栏搜索和 Spotlight 的输入壳仍然分开，统一的只是魔法棒。

能插进去的是引擎真正认识的东西：

- 搜索字段：`ext:`、`kind:`、`parent:`、`size:`、`mtime:`、`ctime:`、`depth:`、`has:`、`missing:`、`child_count:`、`unique_video:`。
- 常用配方：空目录、只有一个视频的目录、缺字幕的视频、纯数字文件名、`CD` / `DISC` 目录。
- 改名模板：`{name}`、`{parent}`、`{ancestor(n)}`、`{children.main_video.stem}`，再挂 `.trim()`、`.remove_ads()`、`.extract_year()` 这类链式函数。
- 插入按上下文裁剪。查重范围不会塞 `dup:true`；改名模板底部能对当前文件试算。

手打也行，例如 `kind:dir AND unique_video:true`，或者 `{name.trim().remove_bracket_content()}{ext}`。点魔法棒只是少记语法，不是另一套引擎。

### 整理

整理是目录结构变换，不是按扩展名丢进几个固定文件夹。流程是：选文件夹 -> 用输入助手筛范围 -> 配规则并预览 -> 确认执行。

一条规则可以按顺序做多步：移动、改文件名、改目录名、拍平套娃、送隔离区。后面的动作读的是前面动作之后的虚拟路径，父目录改名会带到子项上。直接删除在整理页是禁用的，清理走隔离区。

预览用冻结快照，不是边执行边读盘。第 3 步编辑时就能看到命中对象、原位置、目标位置和风险；第 4 步再勾选执行。冲突行默认不勾。规则草稿只属于这次整理会话，不会改全局规则页里的方案。

### 改名

改名页按规则组工作：一组筛选表达式，一组模板。筛选吃搜索语法，模板吃占位符和链式函数。界面上红绿对照旧名和新名。

这套模板能处理“名字不在当前文件上”的情况，例如：

```text
a/b/c/a.txt -> {parent}{ext}
唯一视频文件夹 -> {children.main_video.stem}
下载文件名 -> {name.trim().remove_ads().remove_bracket_content().collapse_space()}{ext}
纯数字名 -> {name.take_parent_if_numeric()}{ext}
```

目录改名和文件改名可以同一次计划。非法字符、空名、超长路径、目标冲突在预览里标红，默认不执行这些行。`{seq}` 按勾选行编号，取消勾选后重排。

### 重复

重复分析不是一上来全库算哈希。顺序是：按大小分桶（桶里至少两份才继续）-> 快哈希 -> 全哈希确认。同一 inode / 硬链接标成同一物理文件，不当作浪费空间。

结果按组展示。每组必须留一份，其余默认进隔离区，页面上已经去掉“执行删除”。保留策略包括最新、最旧、路径最短 / 最长、名称最短 / 最长、文件名质量、指定优先目录。组内可以手动改勾选，再生成计划。

哈希策略可调：重复候选（默认，快）、按需、全量。确认前磁盘不变；执行记录进任务页，可以按任务回滚。

搜索走 SQLite，不现场遍历磁盘。长词走 FTS5，短词和任意子串走 n-gram，必要时有 LIKE 兜底。图片缩略图由主进程生成并缓存；小图可以内嵌预览，常见视频用文件 URL 播放。

写盘统一走 Change Plan。同卷用 rename，跨卷是 copy、校验、再删来源。覆盖默认关闭。执行器不会做静默 `delete`，重复项和规则清理进隔离区。

内置规则方案在 `packages/rules/profiles`，目前有下载整理和媒体路径改名两套，默认 Dry-run。桌面上的整理/改名规则是针对当前这次任务配的，确认前不会改真实文件。

## 明确还没做完的部分

这个版本可以在本机把主链路跑通，但还不是把所有设计文档里的目标都当成已交付：

- 视频缩略图 / ffmpeg 抽帧还没接上，没装解码组件时视频预览会退化。
- `mediaStrategy` 主要是库上的配置项，深度媒体信号还没有真正进数据流。
- 扫描、规则、计划、去重仍有主进程路径。查询和增量写入已经有独立 Worker，超大库时界面仍可能被重任务拖住。
- 断点续扫表在 schema 里，跨进程重启后续扫还不能用。暂停/取消只对当前进程有效。
- 百万文件搜索的部分场景已经做过基准，但不是所有查询都达到设计里的 p95 目标。
- 开发中的 Electron 窗口 `sandbox` / `webSecurity` 仍偏松，发行前还要收。

功能验收只能看 Electron 窗口。`electron-vite` 会带一个 Vite 地址，浏览器里没有 `window.nestify`，页面会提示 IPC 未就绪。那个地址只能看样式，不能当功能结果。

## 仓库结构

```text
nestify/
  apps/desktop/                 桌面壳
    electron/                   Main、preload、IPC、Query/Writer/Preview Worker
    src/                        React 工作台
    resources/                  应用图标
    release/                    打包输出目录（已 gitignore）
  packages/
    shared/                     跨进程类型、IPC、规则 schema
    core/                       可单测的领域逻辑，不依赖 Electron
      src/app                   NestifyRuntime
      src/scan                  扫描与索引
      src/search                FTS / n-gram 查询
      src/rules                 匹配、模板、占位符
      src/plan                  Dry-run、冲突、执行、回滚
      src/duplicates            重复分析
      src/organize              整理预览与快照
      src/db                    SQLite schema、迁移、仓库
    rules/                      内置 RuleSet
      profiles/                 YAML / JSON 方案
  config/                       打包进应用的默认配置
    app.default.yaml
    windows.yaml
    darwin.yaml
    library.default.yaml
    exclusions.default.yaml
  docs/                         需求、架构、schema、交付状态
  tools/                        搜索基准脚本
  scripts/                      把根目录版本同步到桌面包
  package.json                  工作区根，开发与打包入口
```

`packages/core` 必须能在 Node 测试里跑，不启动窗口。渲染进程不直接 `fs`，也不自己打开 SQLite，只通过 preload 白名单 IPC 调主进程。

更细的路径约定见 [docs/05-directory-layout.md](docs/05-directory-layout.md)，模块端口见 [docs/06-module-contracts.md](docs/06-module-contracts.md)。

## 运行时数据

Windows 默认在 `%APPDATA%\Nestify`。可以用 `NESTIFY_APPDATA` 改根目录，用 `NESTIFY_DB_PATH` 改数据库文件。

```text
%APPDATA%/Nestify/
  nestify.sqlite          唯一 SQLite，WAL
  config/app.yaml         用户全局覆盖
  logs/
  cache/thumbnails/       缩略图，可删
  quarantine/             应用级隔离区
  rules/                  用户导入或另存的规则
  tmp/
```

v1 只有这一份数据库。多个资料库是表里的多行，用 `library_id` 区分，不按库拆 sqlite，更不会把索引写进被扫描的目录。库内同卷隔离目录名是 `.nestify-quarantine`，扫描时默认排除。

配置叠加顺序：

1. `config/app.default.yaml`
2. `config/windows.yaml` 或 `config/darwin.yaml`
3. `%APPDATA%/Nestify/config/app.yaml`
4. 该资料库在 SQLite 里的根路径、排除规则、扫描深度等
5. 环境变量

对象是 deep merge，数组整段替换。用户文件不存在就当空覆盖。

## 环境

- Node.js `>= 22`。索引用的是 Node 内置 `node:sqlite`，低版本跑不起来。
- npm 工作区。在仓库根目录装依赖，不要只进 `apps/desktop` 装一份残缺树。
- Windows 10/11 x64 是当前打包和开发目标。macOS overlay 在配置里，桌面发行包还没作为主产物。
- 开发机需要能跑 Electron 37。首次 `npm install` 会拉 Chromium，体积不小。

## 开发

在仓库根目录：

```powershell
npm install
npm start
```

`npm start` 和 `npm run dev` 一样，都是启动 `@nestify/desktop` 的 `electron-vite dev`。操作弹出的 Electron 窗口：添加资料库、扫描、再搜索。

根目录脚本：


| 命令                          | 作用                                    |
| --------------------------- | ------------------------------------- |
| `npm run sync:version`      | 把根目录版本写进 `apps/desktop/package.json`  |
| `npm start` / `npm run dev` | 启动 Electron 开发窗口                      |
| `npm run build`             | 只构建桌面应用，不打安装包                         |
| `npm run dist`              | 构建并打 Windows portable exe             |
| `npm test`                  | `@nestify/core` 和 `@nestify/rules` 单测 |
| `npm run typecheck`         | shared / core / rules / desktop 类型检查  |
| `npm run benchmark:search`  | 搜索基准，见 `tools/search-benchmark.mjs`   |


当前根目录 `postinstall` 会再跑一次 `npm run dist`。也就是说，依赖装完后会继续编译并打包。机器上第一次安装会比较久，这是现在的打包入口，不是装坏了。

如果只想改代码、暂时不打包，等 `npm install` 结束后用 `npm start`。功能联调不要打开 Vite 打印出来的 `http://localhost:5173/`。

建议验收顺序：

1. 起 Electron，确认没有“IPC 未就绪”或数据库初始化错误。
2. 准备一个临时目录，放几张图片、一个视频、两个内容相同的文件。
3. 添加为资料库并扫描，看文件数、当前路径和进度；试一次暂停/恢复。
4. 在文件页搜文件名，切到目录结构逐层进入，点开预览。
5. 用改名页做一条模板预览，只执行一项，再到任务页回滚。
6. 在重复页分析那两个相同文件，隔离一份后再回滚。

更完整的对照表在 [docs/07-delivery-status.md](docs/07-delivery-status.md)。

## 打包

发行产物是 Windows x64 portable，不是 NSIS 安装器。输出目录固定为 `apps/desktop/release`。改版本只改根目录 `package.json`，再 `npm start` 或 `npm run dist`；产物名是 `Nestify-v${version}.exe`，当前即 `Nestify-v1.9.0.exe`。

```powershell
npm install
```

根目录安装依赖时会走 `postinstall`，等价于再执行：

```powershell
npm run dist
```

也可以在依赖已经装好之后单独打一次包。`dist` 会先 `electron-vite build`，再编 Worker，再调用 electron-builder：

```powershell
npm run dist
```

成功后看这个文件：

```text
apps/desktop/release/Nestify-v1.9.0.exe
```

这是便携包，单文件可直接跑。应用数据仍然写到 `%APPDATA%\Nestify`，不会跟 exe 放在一起。`release/` 已忽略，不要把本地打出来的 exe 提交进 git。

desktop 包里的关键字段：

```json
{
  "build": {
    "productName": "Nestify",
    "directories": { "output": "release" },
    "win": {
      "target": [{ "target": "portable", "arch": ["x64"] }],
      "artifactName": "Nestify-v${version}.exe"
    }
  }
}
```

打包时会把根目录 `config/` 和 `apps/desktop/resources/` 带进 extraResources。图标用 `apps/desktop/resources/nestify-icon.ico`。

## 测试

```powershell
npm test
npm run typecheck
```

单测覆盖扫描增量、搜索、规则匹配、模板、计划冲突、执行回滚、去重和缩略图缓存这类不需要窗口的逻辑。桌面 UI 没有完整的自动点击套件，主路径还是 Electron 里手工过一遍。

## 文档

根目录这份 README 只说明仓库怎么用。设计细节在 `docs/`：


| 文档                                                                                       | 内容                                |
| ---------------------------------------------------------------------------------------- | --------------------------------- |
| [docs/00-product-requirements.md](docs/00-product-requirements.md)                       | 产品边界和规则模型                         |
| [docs/01-six-core-modules.md](docs/01-six-core-modules.md)                               | 扫描、搜索、去重、改名、预览、整理                 |
| [docs/02-tech-stack.md](docs/02-tech-stack.md)                                           | Electron / Node / SQLite / shadcn |
| [docs/03-architecture.md](docs/03-architecture.md)                                       | 进程模型和数据流                          |
| [docs/04-database.md](docs/04-database.md)                                               | schema 与迁移                        |
| [docs/05-directory-layout.md](docs/05-directory-layout.md)                               | 仓库树和运行时目录                         |
| [docs/06-module-contracts.md](docs/06-module-contracts.md)                               | 模块端口                              |
| [docs/07-delivery-status.md](docs/07-delivery-status.md)                                 | 当前能用和还不能用的部分                      |
| [docs/08-performance-sync-trd.md](docs/08-performance-sync-trd.md)                       | 搜索性能与增量同步                         |
| [docs/09-input-assistant-unification-trd.md](docs/09-input-assistant-unification-trd.md) | 输入助手 / 魔法棒                        |
| [docs/10-organize-trd.md](docs/10-organize-trd.md)                                       | 整理模块                              |


英文说明见 [README.en.md](README.en.md)。

## License

仓库目前没有单独的 LICENSE 文件。使用或分发前先和作者确认。
