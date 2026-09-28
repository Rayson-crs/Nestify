# TRD 14：功能页加载反馈、重复结果首屏与合并预览（2026-09-28）

> 状态：14-1 至 14-15 已完成并等待手工验收。
> 约束：不读取用户个人媒体文件；性能验证只使用新生成的合成数据和临时数据库。

## 任务表

| ID | 任务 | 状态 | 结果 | 验证 |
| --- | --- | --- | --- | --- |
| 14-1 | 功能页懒加载时显示明确加载状态 | 已完成，待验收 | `正在打开页面` 增加旋转图标和 `role="status"`，页面不再像静止损坏 | `@nestify/desktop` typecheck 通过 |
| 14-2 | 识别重复模块第 3 步扫描完成后长时间无反应 | 已完成，待验收 | 区分扫描、保存结果、加载第一页结果三个阶段；完成后不再重复发起结果加载 | 重复模块 15 项测试通过 |
| 14-3 | 修复取消扫描按钮在 100% 后不可用 | 已完成，待验收 | 有 jobId 即可点击；扫描/保存阶段执行取消，完成或失败后变为返回设置 | sidecar 重复测试通过 |
| 14-4 | 重复结果分页只计算当前页，不做全量成员排序 | 已完成，待验收 | 默认类型走分组摘要和当前页分组驱动查询；取消全量窗口排序 | 合成 2000 组 / 4000 文件首屏 55ms |
| 14-5 | 降低重复分析结果落库耗时 | 已完成，待验收 | 分组与成员改为事务内分块批量插入 | 合成 2000 组落库约 113ms |
| 14-6 | 清理本轮验证产物 | 已完成，待验收 | 移除本轮生成的 benchmark 脚本和 6 个带固定前缀的临时 benchmark 目录 | 临时目录复查为空 |
| 14-7 | 合并第 2 步视频能显示第一帧但播放时画面不动 | 已完成，待验收 | 移除外层静态视频覆盖层；真实视频按解码尺寸立即可见，不再被跨源 canvas 像素探测误判隐藏 | 预览测试 3 项、typecheck、生产构建通过 |
| 14-8 | 合并第 3 步图片 / 视频合成预览只显示视频第一帧 | 已完成，待验收 | 移除外层选中视频首帧覆盖层；图片段显式选择图片渲染层；代理 MP4 转为本地 media 地址 | 预览测试 3 项、typecheck、生产构建通过 |
| 14-9 | 合成预览播放进度变化但画面不刷新 | 已完成，待验收 | 播放进度与画面重新由 `VideoSequencePreview` 的真实视频元素驱动；直连失败时自动切换 H.264 代理 | 预览测试 3 项、typecheck、生产构建通过 |
| 14-10 | 打包版改名第 3 步翻页报 `TypeError: de is not a function` | 已完成，待验收 | `RenameWorkspace` 补传 `onPlanPage`，生产 bundle 已确认包含 `handleRenamePlanPage` 回调 | typecheck、回归测试、生产构建、portable 打包通过 |
| 14-11 | 重复模块第 2 步目录预览被显示为“正在扫描重复” | 已完成，待验收 | 扫描文案仅在第 3 步 `analyzing` 状态显示；目录预览 loading 不再复用扫描状态 | typecheck、回归测试、生产构建通过 |
| 14-12 | 功能页切换 tab 后步骤和数据回到原点 | 已完成，待验收 | 访问过的功能页保持挂载，仅用 `hidden` 隐藏；各功能 controller 固定自身模块 tab；feature bridge 仅由激活页注册 | keep-alive 场景类型检查、plan-state 测试、生产构建通过 |
| 14-13 | 任务模块初始未查询任务表 | 已完成，待验收 | IPC ready 后静默预查一次任务；每次进入任务 tab 再显式刷新 | typecheck、回归测试、生产构建通过 |
| 14-14 | portable 启动弹出 `sidecar is not ready` 类错误 | 已完成，待验收 | Tauri API 可用不等于 sidecar ready；启动期 `not ready` 持续退避重试，任务与规则请求等首次 `libraryList` 成功后再发出 | typecheck、生产构建、portable 重打包通过 |
| 14-15 | 文件页 keep-alive 后内容布局漂移 | 已完成，待验收 | keep-alive 外层容器补回 `flex-col`，文件页标签条与列表恢复上下布局；切 tab 保留状态能力不变 | typecheck、回归测试、生产构建、portable 重打包通过 |

## 问题与根因

1. 功能页第一次打开时，React lazy fallback 只有一行文字，没有活动指示。用户无法区分“正在加载”和“页面坏了”。
2. 重复分析进度到 100% 后进入保存与结果加载阶段，但 UI 仍显示“正在扫描重复文件”。真正的扫描已结束，卡住的是结果读取。
3. 前端每 500ms 轮询完成状态，没有重叠保护；前一次昂贵结果查询未返回时，后续轮询又发起同类请求，形成请求堆积并放大 10060 超时风险。
4. 默认“全部类型”的结果文件分页 SQL 对所有重复成员做窗口排序，SQLite 还可能从 `library_entries` 反向扫描，导致先算全量再取一页。
5. 取消按钮此前被综合 busy 状态锁住；扫描已经有 jobId 时，用户仍应能发出取消请求。
6. 合并第 2 步和第 3 步都出现了“双播放器”结构：真实播放器在底层推进进度，外层又渲染了一个只 seek 到裁剪起点的 `z-30` 静态视频。上层视频永不播放，因此用户看到第一帧不动；第 3 步这个上层视频还只按选中视频生成，直接遮住图片段。
7. 移除外层静态层后还有第二个误判源：页面与 sidecar 媒体服务在不同端口，代码用 `drawImage` + `getImageData` 判断“画面是否变亮”。跨源媒体会让 canvas 变成 tainted，读取抛错后被判定为未绘制，真实视频被抽帧图长期覆盖。
8. 原始 MP4 解码失败时生成的 H.264 预览代理返回 `nestify-media://preview/...`，但该协议未注册且不在 CSP `media-src` 内，代理视频也加载失败，最终只剩时间轴抽帧图。
9. 生产包第 3 步分页回调在打包压缩后暴露为 `de`；`RenamePane` 收到分页事件时上层工作区没有传入 `onPlanPage`。
10. 重复模块第 2 步目录分页预览和第 3 步重复分析复用同一个 busy 字段，导致目录读取被误报为“正在扫描重复”。
11. 功能页按当前 tab 条件渲染，切走即卸载，向导状态丢失；重构后又需要避免多个隐藏工作区重复注册桥接控制器。
12. 任务列表只依赖活跃任务轮询，应用启动或首次进入任务页时没有主动查询历史任务表。
13. portable 首次解压或冷启动时，Node sidecar 绑定端口可能晚于渲染进程挂载；前端原固定重试 8 次、每次 400ms，约 3.2 秒后把 `sidecar is not ready` 当成业务错误弹出。
14. 功能页 keep-alive 外层容器只写了 `flex`，Tailwind 默认横向排列；文件页的 `目录结构 / 搜索结果` 标签条与列表内容被放到同一行，视觉上像内容漂移到资料区下面。

## 修改内容

| 文件 | 修改 |
| --- | --- |
| `apps/desktop/src/components/app/WorkspaceBody.tsx` | 懒加载 fallback 增加旋转图标、可访问状态和“正在打开页面”文案 |
| `apps/desktop/src/app/useDuplicateWizard.ts` | 增加结果加载状态、jobId、请求序号、完成加载去重和轮询重叠保护 |
| `apps/desktop/src/components/workspace/DuplicatePane.tsx` | 分开展示扫描、保存、结果加载；取消按钮按 jobId 启用；结果分组和文件均分页 |
| `packages/core/src/duplicates/query.ts` | 结果摘要直接读分组表；文件页先定位当前页分组，再按组补成员，并强制从当前页分组驱动连接 |
| `packages/core/src/duplicates/persistence.ts` | 落库改为事务内分块多行插入，减少每行 SQL 开销 |
| `packages/core/src/app/runtime-plans.ts` | 保存前发出 finalizing 进度，并在落库前再次检查取消信号 |
| `apps/desktop/src/components/workspace/MergeArrangeStep.tsx` | 删除第 2 步外层 `DirectVideoArrangePreview` 静态覆盖层，视频播放回到 `VideoTrimEditor` |
| `apps/desktop/src/components/workspace/MergeOutputStep.tsx` | 删除第 3 步外层 `DirectVideoOutputPreview` 静态覆盖层，直接渲染 `VideoSequencePreview` |
| `apps/desktop/src/components/workspace/VideoSequencePreview.tsx` | 图片段传入 `imageReady`，图片层成为当前段的明确主渲染层 |
| `apps/desktop/src/components/workspace/video-preview-surface.ts` | 主预览选择规则新增 `image` 状态；视频可显示判断改为解码尺寸；代理协议地址转换为本地 media 地址 |
| `apps/desktop/src/components/workspace/video-sequence.ts` | 预览代理轮询结果统一转换成 sidecar HTTP media URL，避免未注册自定义协议 |
| `apps/desktop/src/components/workspace/video-sequence.test.ts` | 覆盖视频层选择、图片层选择和代理地址转换 |
| `apps/desktop/src/components/app/WorkspaceBody.tsx` | 访问过的功能页保持挂载并隐藏；首次访问仍走懒加载和加载反馈 |
| `apps/desktop/src/components/app/WorkspaceBody.tsx` | keep-alive 外层容器补回 `flex-col`，恢复文件页标签条在上、列表内容在下的纵向布局 |
| `apps/desktop/src/components/app/RenameWorkspace.tsx` | 补传改名计划分页回调，修复打包版翻页崩溃 |
| `apps/desktop/src/components/app/OrganizeWorkspace.tsx` | 固定 organize 模块 tab，仅激活时注册 feature bridge |
| `apps/desktop/src/components/app/DuplicateWorkspace.tsx` | 固定 duplicates 模块 tab，仅激活时注册 feature bridge |
| `apps/desktop/src/components/app/MergeWorkspace.tsx` | 固定 merge 模块行为，仅激活时注册 feature bridge |
| `apps/desktop/src/app/useAppWorkspace.ts` | 启动/进入任务页查询任务表；功能 controller 改为按激活工作区桥接 |
| `apps/desktop/src/components/workspace/DuplicatePane.tsx` | 第 2 步目录预览不再显示“正在扫描”；仅第 3 步分析中显示扫描状态 |
| `apps/desktop/src/app/useAppWorkspace.ts` | 增加 `sidecarReady` 门闩；启动期 `not ready` 使用 250ms/1s 退避持续等待；任务与规则初始请求等待 sidecar ready |

## 性能结果

合成数据：2000 组 / 4000 文件，只使用临时目录和临时数据库。

| 指标 | 修改前 | 修改后 |
| --- | --- | --- |
| 第一页分组结果 | 约 40-47ms | 约 40ms |
| 第一页文件结果 | 旧查询路径约 1.2s；旧全量窗口对照组约 16.2s | 55ms |
| 2000 组结果落库 | 逐行插入路径明显更慢 | 约 113ms |

## 验证记录

通过：

```powershell
npm.cmd run typecheck -w @nestify/desktop
```

结果：通过。

```powershell
npm.cmd run build -w @nestify/desktop
```

结果：通过；worker 构建 257 个模块，前端构建 1902 个模块。仅存在既有大 chunk 与运行时 worker URL 提示，无本次修改引入的错误。

```powershell
node --experimental-strip-types --test apps/desktop/src/components/workspace/video-sequence.test.ts
```

结果：3 passed / 0 failed。覆盖视频解码后选择真实视频层、图片段选择图片层、代理 MP4 地址转换。

```powershell
node --experimental-strip-types --test apps/desktop/scripts/dev-tauri.test.ts apps/desktop/src/app/plan-state.test.ts apps/desktop/src/components/workspace/video-sequence.test.ts
```

结果：10 passed / 0 failed。覆盖开发端口选择、功能页状态保持相关 plan-state 逻辑、视频预览层选择与代理地址转换。

```powershell
npm.cmd run package:exe
```

结果：通过。portable 产物 `apps/desktop/release/Nestify-v1.9.6.exe`，大小 83,382,792 bytes（约 79.52 MB），生成时间 2026-09-28 21:10:58，FileVersion / ProductVersion 均为 1.9.6，SHA256 为 `B1704CBE7CC99E9263F07B6C5BC383D95418B50A4E85F5D61FA92E648F8E449D`。

14-14 修复后重新打包：`apps/desktop/release/Nestify-v1.9.6.exe`，大小 83,378,184 bytes（约 79.52 MB），生成时间 2026-09-28 22:48:02，FileVersion / ProductVersion 均为 1.9.6，SHA256 为 `FF55FBB00CA97CC066B4DCF0B7137E6E84F04E1C4B53BA0D634724B5FFE82844`。生产 bundle 已确认包含启动退避与 `sidecarReady` 门控逻辑。

14-15 布局修复后验证：`@nestify/desktop` typecheck 通过；`dev-tauri.test.ts`、`plan-state.test.ts`、`video-sequence.test.ts` 共 10 项通过；生产构建通过，bundle 已确认包含 `flex min-h-0 min-w-0 flex-1 flex-col`。portable 重新打包通过，产物 `apps/desktop/release/Nestify-v1.9.6.exe`，大小 83,382,280 bytes（约 79.52 MB），生成时间 2026-09-28 23:05:36，SHA256 为 `7A2B77C7E3F77BBFE48EFF6E80DA1006CA3FC28F4935C4025BBCB0226719CEFB`。

```powershell
node --experimental-strip-types --test packages/core/src/duplicates/query.test.ts packages/core/src/duplicates/persistence.test.ts packages/core/src/duplicates/analyzer.test.ts apps/desktop/sidecar/duplicates.test.ts
```

结果：15 passed / 0 failed。

备注：`npm.cmd run typecheck -w @nestify/core` 当前仍有 5 个既有错误，位于 `runtime-media-merge.ts`、`media/executor.ts`、`plan/planner.test.ts` 和 `plan/planner.ts`，属于合并与规划器旧改动，不是本轮重复模块引入；本轮触碰的 persistence 类型错误已移除。

## 手工验收清单

| 步骤 | 预期 |
| --- | --- |
| 第一次打开整理、改名、重复、合并、任务页 | 显示旋转加载状态，随后进入页面 |
| 重复模块开始扫描 | 取消扫描可点击 |
| 进度到 100% 后 | 显示“分析完成，正在加载第一页结果…”，按钮变为可操作的返回设置 |
| 结果加载完成 | 直接进入第 4 步，左右列表显示当前页，底部显示总数 |
| 点击分组页或文件页下一页 | 只请求下一页，不重新卡在全量计算 |
| 合并第 2 步选择视频并点击播放 | 预览画面随播放进度变化，不再停留第一帧 |
| 合并第 3 步播放图片 / 视频混合序列 | 到达图片段时显示图片，视频段播放时画面刷新，进度条与画面一致 |
| 使用新 portable 包在改名第 3 步点击上一页 / 下一页 | 不再出现 `TypeError: de is not a function`，当前页数据更新 |
| 重复模块第 2 步选择目录 | 只显示目录预览加载；未进入第 3 步前不显示“正在扫描重复” |
| 在重复 / 整理 / 改名 / 合并之间切换后返回 | 原步骤、筛选、分页和待执行数据保留 |
| 应用启动后以及进入任务页 | 能看到任务表中的历史任务，不需要等待某个活跃任务触发轮询 |
| portable 首次启动或冷启动 | 不再弹出 `sidecar is not ready`；页面保持加载，sidecar ready 后自动进入工作台 |
| 文件页切换目录结构 / 搜索结果 | 标签条在内容区上方，列表不再横向漂移到资料区域旁边 |
