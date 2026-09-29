# 整理、改名、重复、合并流程审查报告

日期：2026-09-27

## 结论与状态

本报告基于当前工作区 diff、源码静态审阅、Noether 与 Aquinas 两个真实子代理复核，以及主线程最终验证。自动验证已经全部通过：core、desktop、rules 测试，media 专项测试，core/shared/rules/desktop 类型检查，Rust `cargo check --offline`，性能基准和 `git diff --check` 均无失败。Windows 窗口/托盘行为和真实磁盘、慢盘场景仍需手工矩阵验证，因此不能把当前状态表述为发布级完成。

当前确认的核心事实：

1. 整理和改名的第三步没有丢掉第二步筛选条件。代码语义是：第二步筛选先构成外层 source universe，第三步只取这个 universe 的一个 source page，再在 page 内用规则或规则组做二次过滤。后续页在用户翻页时再用 cursor 计算。
2. 用户实际看到“第二步快、第三步一直转”的直接根因已确认：当时开发窗口加载的是 2026-09-26 02:49 的旧静态 `dist`，不是包含分页修复的 Vite 源码。旧请求没有 `offset/limit`，改名第三步真实耗时曾达到 22 秒到 243 秒。
3. 旧实现本身还有算法放大：同一页候选在多个规则间重复构建上下文，以及某些表达式不需要大上下文却仍然构建了大上下文。当前已增加按需上下文判断和同页共享评估对象。
4. 分页预览曾会漏掉未入选但已存在于目标路径的文件，导致冲突漏报。当前整理和改名都会按精确目标路径补加载 bystander entries。
5. 重复分析不能改成“只分析当前页”，因为必须全局分组和哈希。当前方向是任务化：立即返回 jobId，后台分析，持续进度，可取消，结果持久化后分组和文件都分页查询。
6. 合并流程已增加资源护栏和不覆盖发布，但异常退出后的历史残留清理、超大任务自动分批 tree merge 仍未完全闭环。
7. 窗口行为的代码路径符合目标语义，但依赖 Windows 任务栏扩展样式，仍需打包版手工矩阵验证。
8. 子代理复核发现的四个后置问题也已修复：整理确认页本地假分页、无 `entryId` 的 `mkdir` 取消后仍可能执行、跨页选择迁移误用刷新后状态、媒体失败/取消后 session 泄漏。

### 状态总览

| 流程 | 主要问题 | 当前落盘状态 | 主要剩余风险 | 验证状态 |
| --- | --- | --- | --- | --- |
| 整理第三步 | 开发窗口曾加载旧 `dist`；规则重复计算、冲突漏报、本地假分页、跨页选择丢失 | dev 强制走 Vite；source page 懒加载、共享规则上下文、精确目标 bystander、访问页聚合、确认页受控分页 | 复杂上下文规则仍可能慢；旧预览后台计算未完全取消 | 真实 IPC 首页约 674ms；core/desktop 全量与性能基准通过 |
| 改名第三步 | 开发窗口曾加载旧 `dist`；规则组重复计算、目标兄弟漏报、分页状态错乱 | dev 强制走 Vite；第二步外层筛选传入第三步、规则组去重、分页 cursor 重置、访问页聚合 | 同上下文规则和大目录子项风险；请求级取消未闭环 | 真实 IPC 首页约 648-728ms；core/desktop 全量与性能基准通过 |
| 重复 | 长 RPC 等待全局分析，易出现 10060 体验 | jobId 后台分析、进度、取消、持久化结果分页；执行改为 `plan.execute.start`，大计划在 task worker 内构建 | 不能暂停恢复；执行计划仍在 worker 内一次性构建；计划执行不能取消 | core 全量、media 专项与 sidecar worker 测试通过 |
| 合并 | 图片内存常驻、视频命令膨胀、临时文件和恢复状态风险；FFmpeg 失败信息缺少路径证据 | 图片路径合成、资源上限、临时文件登记清理、link 发布不覆盖、终态 session 清理；worker 记录并诊断 FFmpeg/FFprobe 路径 | 超限只拒绝不自动分批；buildPlan 仍是同步 RPC；需复测用户报错的合并场景 | core 全量与 media 专项通过；慢盘/强杀专项待手工 |
| 窗口/托盘 | 最小化、关闭、任务栏语义混淆 | 最小化保留任务栏；关闭到托盘移除任务栏；关闭设置分流 | Windows API 行为需真实 GUI 验证 | 静态核对完成；待手工验证 |

## 1. 整理与改名第三步

### 问题与影响

用户看到的现象是：第三步表格长时间加载，分页没有带来预期首屏速度；规则变化后刷新无响应；跨页选择容易丢失。实际影响分为三层：

1. 性能：进入第三步慢，用户误以为第二步筛选没有传递，实际是第三步对同一 page 做了重复或过大的上下文计算。
2. 正确性：分页计划看不到目标路径上未入选的已有文件，可能漏报冲突、错误生成 suffix、skip、overwrite 结果。
3. 语义：当前页替换完整 plan 后，翻页选择丢失；执行范围容易被误解为“全部匹配”。

### 根因

1. 开发运行链路会加载旧静态包：`tauri.conf.json` 同时配置了 `frontendDist: ../dist` 和 `devUrl: http://127.0.0.1:5173`，但 Cargo 侧曾无条件启用 `tauri/custom-protocol`。直接 Cargo 开发窗口因此绕过 Vite，读取修复前的 `dist`，造成“源码已分页、界面仍全量慢”的假象。
2. 外层筛选和内层规则过滤的调用边界不清。旧实现中，多个规则分别调用搜索，每个调用都可能重复做候选加载和上下文构建。
3. 搜索层此前没有精确判断表达式是否需要 parent、children、peer、same_stem 等上下文。`filename.match()` 这类只依赖当前行的规则也可能触发大范围上下文构建。
4. 分页 planner 只知道当前候选，不知道精确目标路径上已经存在的旁观者文件，Virtual Fs 因此看不到真实磁盘状态。
5. 前端 plan 状态以“当前页替换全量”的方式维护，选择又依赖数字 index；刷新导致 index 移动时，旧选择会错绑到别的操作。
6. UI 曾用当前行数推断是否还有下一页，稀疏页命中为 0 或很少时会错误停止分页。

### 已落盘修改方案

1. 保持二次过滤语义：第二步筛选作为 outer filter 传入 `searchEntries()`，先取一个最多 200 条的 source page；整理规则和改名规则组只在这个 page 内评估，不为了补满命中页继续扫描后续 source page。
2. 增加共享候选评估：`createSearchCandidateEvaluation()` 为当前 page 建立一次可复用的上下文；同页多个规则或多个规则组复用它，相同 filter 的匹配结果也会去重。
3. 增加按需上下文：只有 `same_stem`、`children.*`、`peer_dir` 等真正需要邻居或子项的表达式才构建上下文；普通文件名、类型、路径类规则不再构建大兄弟索引。
4. 补充分页冲突上下文：先根据当前 page 生成初始 plan，再按 plan 的精确目标路径批量加载 bystander entries，重新运行 planner。整理和改名均使用该策略。
5. 修正分页状态：UI 直接使用后端 `sourceHasMore`；source、规则、collision、目录、筛选任一变化时回到第 0 页，并同步清空 offset、cursor、页缓存和选择状态。
6. 聚合访问页：`PlanState` 保存用户已访问的页，刷新某页只替换该页；整理和改名共享这套状态。
7. 选择按 operation identity 迁移：用 entryId、操作类型、路径、规则等组成稳定 key，页刷新导致数字 index 移动时，选择跟随原操作而不是错绑。
8. 明确执行语义：只执行已加载且勾选的操作，不提供未加载页的“执行全部”。这是保守但诚实的边界，避免在完整计划未生成时误删或误移动文件。
9. 修正开发加载链路：Cargo 将 `custom-protocol` 放入默认 feature，正式打包继续使用静态 `dist`；`dev-tauri.mjs` 直跑 Cargo 时追加 `--no-default-features`，确保开发窗口加载 Vite URL。新增脚本测试锁定该行为，避免再次把旧 `dist` 当成开发前端。

### 后置接线修复

子代理复核发现，core 已经按 source page 计算，但整理确认页的表格仍只对已进入 `plan.ops` 的数组做本地 200 条切片，后续后端页无法通过确认页加载。当前已补齐：

1. `PlanTable` 保留规则页的默认本地分页，同时支持 `pageRows/pageOffset/pageSize/total/hasMore/busy/onPage` 受控分页。
2. `usePlans` 为整理结果暴露 `organizeResultOps`：从 `planState.pages` 取当前页 `opIndexes`，再映射到聚合 plan 的真实 index，勾选和执行使用同一套索引。
3. `OrganizePane` 确认页直接传当前页行、后端 offset/total、`sourceHasMore` 和翻页回调，不再从聚合数组本地切片。
4. `usePlanExecution` 对整理/改名按聚合 index 过滤，用户取消没有 `entryId` 的 `mkdir` 后不会执行；重复流程仍保留持久化 keep 状态的全局执行语义。
5. `applyPlan` 刷新前先保存 `previousState`，再用它执行 operation identity 选择迁移，避免把刷新后的状态误当旧状态。

关键落点：

- `packages/core/src/organize/preview.ts`
- `packages/core/src/app/runtime-rules.ts`
- `packages/core/src/search/query.ts`
- `packages/core/src/rules/context.ts`
- `packages/core/src/db/repos/entries.ts`
- `apps/desktop/src/app/plan-state.ts`
- `apps/desktop/src/app/useOrganizeWizard.ts`
- `apps/desktop/src/app/useRenameWizard.ts`
- `apps/desktop/src/components/workspace/OrganizePane.tsx`
- `apps/desktop/src/components/workspace/RenamePane.tsx`

### 已改效果

1. 进入第三步时只计算第一页 source universe。第二页及后续页在用户翻页时基于 cursor 计算，稀疏页不会被后台继续扫描填充。
2. 20 条 `filename.match()` 类规则不再分别放大成 20 次大上下文构建；同页规则共享上下文，重复 filter 复用结果。
3. 分页和全量预览在目标文件已存在时能看到同一个 bystander，suffix、skip、overwrite 的风险判断更一致。
4. 用户在 Page 1 选择后翻到 Page 2 再返回，选择保留；规则刷新导致页面内容变化时，选择按操作身份迁移，避免 index 错绑。
5. 稀疏页仍可继续翻页，因为是否有下一页来自后端 `sourceHasMore`，不是当前页命中数。
6. 整理确认页不再出现“后端已分页但 UI 本地假分页”的断层；用户翻页会请求下一个 source page。
7. 跨页已访问页保留在聚合 plan 中，执行范围仍是“已加载且勾选”的操作，未加载页不会被隐式执行。
8. 修复开发加载链路后，真实 WebView -> Tauri -> sidecar 链路实测：整理第三步请求 `offset: 0, limit: 200`，耗时约 674ms，返回 200 条 source 且 `sourceHasMore: true`；改名第三步同样请求第一页 200 条，耗时约 648-728ms。当前主窗口 URL 已确认是 `http://127.0.0.1:5173/`。

### 收益

- 首屏计算从“分页 UI 但规则阶段重复放大”回到以 source page 为边界。
- 保住正确的二次过滤：第二步目录或筛选条件先收敛范围，第三步规则只在这个范围内匹配。
- 修掉了分页特有的冲突漏报，避免用户看到安全预览但执行失败或覆盖。
- 跨页选择和执行范围明确，不再依赖含糊的“快照已固定”语义。

### 代价与剩余限制

- `same_stem`、`children.*`、`peer_dir` 这类规则在语义上必须知道邻居或子项，不能简单变成 O(200)。如果当前 page 来自很多大目录，仍可能慢。
- 当前 page 中包含目录时，planner 为了目录类操作仍可能加载这些目录的直接子项；这是正确性需要，但规模可能超过 200。
- 前端会用 requestId 忽略过期响应，但后台旧预览计算还没有完整的请求取消。连续修改规则时，旧任务仍可能占用 worker，只是结果被丢弃。
- `sourceHasMore=true` 时总数显示为未知，这是避免为了显示总数而扫描全库的代价。
- 规则变化回到第 1 页，用户会丢失当前页位置；这是保守状态机，换取 cursor 和 `{seq}` 稳定。
- “执行全部匹配”仍未提供。若未来要做，应先在后端生成完整计划 token，并完成冲突校验和用户确认，而不是让前端把所有页偷偷加载完。

### 后续建议

1. 为预览请求增加后端 fingerprint 取消和任务去重，避免 debounce 期间旧计算继续占资源。
2. 对必须构建大上下文的规则输出阶段耗时和上下文规模，便于用户知道慢在目录规模而不是分页失效。
3. 为真正“执行全部”设计后端持久化 plan job，而不是扩大前端内存。

## 2. 重复流程

### 问题与影响

重复分析必须全局执行：只有看到所有候选，才能知道某个文件在别处是否有相同大小和哈希。因此把分析改成当前页是错误方向。

旧体验的问题是：

1. 第二步到第三步长时间等待一个 RPC，链路空闲或断开时用户会看到 10060 类超时错误。
2. 分析过程中缺少持续进度和可靠取消。
3. 分析结果即使文件表分页，左侧分组列表仍可能全量渲染，导致大结果集 UI 卡顿。

### 根因

1. 分析生命周期和 RPC 生命周期绑在一起。RPC 只适合短请求，不适合承载全局扫描、哈希和持久化全过程。
2. 结果模型偏一次性返回，前端持有完整分组，而不是按 jobId 从持久化结果中查页。
3. 完成事件和数据库可查询状态之间存在竞态，前端收到 completed 后立即查询可能读不到结果。

### 已落盘修改方案

1. `duplicates.analyze` 立即创建 duplicates job 并返回 `{ jobId }`，实际分析交给 task worker。
2. 后台任务持续上报 phase、current/total、path、percent 等进度；`duplicates.progress` 支持按 jobId 查询。
3. `duplicates.cancel` 将 job 标记为 cancelling，并取消后台执行。
4. 完成顺序修正：先把 job row 更新为 completed，再发布 completed 进度事件，保证前端收到完成事件时结果已可查询。
5. 分析结果持久化，新增：
   - `listDuplicateResultPage()`：分组分页，组列表不携带完整文件，减少单页负载。
   - `listDuplicateFilesPage()`：全部文件或指定组文件分页。
   - `listDuplicateExecutionPlan()`：从持久化结果生成执行计划。
   - keep strategy 持久化，包括全局策略和单文件调整。
6. UI 左侧分组按页加载，右侧文件表继续按组或跨组分页；任务运行中显示进度和取消入口。
7. 执行阶段改为 `plan.execute.start`：sidecar 预生成 `requestId/jobId` 后立即返回 queued snapshot，task worker 从持久化结果构建执行计划；前端通过 SSE 终态事件接收结果，并用 500ms 状态轮询兜底。
8. 渲染层不再接收或发送完整重复执行计划。前端只传 `duplicateJobId/kind/deselectedEntryIds`，计划构建发生在 task worker 内；取消勾选的 entry 不会被加入执行索引。

关键落点：

- `apps/desktop/sidecar/handlers.ts`
- `apps/desktop/sidecar/state.ts`
- `apps/desktop/runtime/task-worker.ts`
- `packages/core/src/duplicates/query.ts`
- `apps/desktop/src/app/useDuplicateWizard.ts`
- `apps/desktop/src/components/workspace/DuplicatePane.tsx`
- `apps/desktop/src/lib/ipc.ts`
- `packages/shared/src/ipc.ts`

### 已改效果

1. 点击分析后快速拿到 jobId 并进入任务状态，不再用一个长 HTTP 请求等待全局哈希完成，10060 类体验从根上转为任务状态问题。
2. 大任务有持续进度，可以取消；失败或取消状态会写回 job。
3. 几万分组时左侧列表只渲染当前分组页，右侧文件只渲染当前文件页。
4. 完成事件与结果可查询性对齐，减少“已 completed 但查不到结果”的竞态。
5. 执行开始不再占着一个长 HTTP 请求等待文件操作完成；即使 worker 后面运行超过 120 秒，RPC 也已经返回，终态由 SSE/轮询取得。
6. 重复执行计划不会经过渲染层，避免“大结果 JSON 序列化到 UI，再原样发回 sidecar”的双重开销。

### 收益

- 保留全局分析的准确性，同时把等待体验改为可观察、可取消的任务。
- 结果持久化后可回看，刷新或重启后不必因为 UI 生命周期丢失已完成分析。
- 分组、文件、执行计划都从数据库按需取页，前端内存压力下降。
- 执行生命周期与 RPC 生命周期解耦，10060 不再表示“后台一定失败”或“一定成功”，而是通过任务状态给出确定答案。

### 代价与剩余限制

- 全局扫描和哈希的磁盘 IO 时间不会消失，只能被进度和取消管理。
- 当前同一时间只允许一个重复分析任务，避免多个任务同时扫同一库造成 IO 放大。
- 尚未实现 pause/resume；取消后需要重新发起分析。
- 计划执行还没有 `plan.cancel`；`plan.execute.start` 只解决长 RPC 和渲染层大 payload，不等于完整可取消任务。
- worker 内仍会一次性生成完整重复执行计划，超大结果集的内存峰值还没有按批拆分。
- 哈希过程中外部文件变化仍可能导致结果与最终磁盘状态有细微差异，执行前仍需依赖现有安全校验。

### 后续建议

1. 增加 pause/resume 或 checkpoint 级恢复。
2. 对多库任务评估有限并发，但必须避免同一磁盘过度随机 IO。
3. 在真实大库上记录扫描、size 分层、hash、持久化各阶段耗时，确认用户侧瓶颈。

## 3. 合并流程

### 问题与影响

合并已有 workspace、manifest 和 checkpoint 基础，但存在资源与状态风险：

1. 图片合成曾把多个解码 layer 保存在 Buffer 数组，输入多或分辨率高时内存峰值线性增加，可能 OOM。
2. 视频命令的输入数、filter graph 和命令长度随素材线性膨胀，可能在 ffmpeg 或 Windows 限制处失败。
3. 最终发布如果用 rename 覆盖同名目标，外部文件变化时会带来数据覆盖风险。
4. 临时文件清理分散，异常路径可能残留。
5. 中断任务的 `resumeSupported` 标记过于乐观，用户可能尝试恢复后才发现 checkpoint 或 workspace 不完整。

### 已落盘修改方案

1. 图片 layer 继续写入 workspace，但 sharp composite 直接使用文件路径，不再把解码 Buffer 常驻在数组。
2. 图片资源护栏：输入最多 512 个；源图片总像素最多 150,000,000；合成预估内存最多约 1.5 GB。
3. 视频资源护栏：输入最多 256 个；输出帧最多 40,000,000 像素；FFmpeg 命令最多约 30,000 code units，超限明确要求分批。
4. 输出、concat、chapter 等临时文件集中登记，统一 cleanup。
5. 最终发布使用 hard link，目标已存在时明确报错，不覆盖外部文件。
6. `resumeSupported` 只有在 manifest、checkpoint 和 workspace 有效时才为 true；无效时不再承诺可恢复。
7. 成功、失败和取消终态都会清理同进程 session；失败后如果存在有效 checkpoint，可以立即重新 resume。
8. 媒体合并 worker 启动时记录 sidecar 实际传入的 `mediaTools`；任何 plan/execute/duration/timeline/waveform 请求执行前都会重新解析 FFmpeg/FFprobe，缺失时错误会带上 worker 传入路径、环境变量路径和最终解析结果。

关键落点：

- `packages/core/src/media/image-executor.ts`
- `packages/core/src/media/execution-shared.ts`
- `packages/core/src/media/video-command.ts`
- `packages/core/src/media/executor.ts`
- `packages/core/src/media/resume.ts`
- `apps/desktop/runtime/media-merge-worker.ts`
- `apps/desktop/runtime/media-merge-worker-client.ts`

### 已改效果

1. 图片合成内存峰值不再随输入数量线性常驻，大图任务更稳。
2. 超大图片或视频任务会在 plan/execute 边界得到明确错误，而不是在 ffmpeg 或系统层面莫名失败。
3. 正常失败路径的临时文件清理更集中。
4. 输出已存在时拒绝覆盖，用户不会误以为成功发布却覆盖了外部文件。
5. 恢复能力显示更诚实，不完整的 workspace 不再被标记为可恢复。
6. 失败/取消后的任务不会因为残留 session 被误判为仍在运行，同进程立即恢复不会被阻塞。
7. 设置页“测试并应用”成功后会立即更新 sidecar 的 FFmpeg/FFprobe 环境并重置合并 worker；worker 日志和任务错误也会显示路径在哪一层丢失。

### 收益

- 降低 OOM、命令超长、覆盖竞态和恢复误导四类高风险失败。
- 护栏错误带原因和分批建议，用户能理解下一步。
- 保留现有 checkpoint/workspace 设计，没有推翻重做。

### 代价与剩余限制

- 超限任务当前是明确拒绝，尚未自动拆分为 tree merge；用户需要手动分批。
- 图片使用文件路径会增加少量 IO，但相比常驻未压缩 Buffer 是合理代价。
- 进程被强制杀死或断电后的历史 workspace 清理还没有启动扫描闭环，仍需避免误删正在运行任务的文件。
- ffmpeg 子进程在所有异常退出路径下的终止行为仍需专项集成测试。
- “测试并应用”只改变当前运行，不写配置文件；重启后仍按已保存设置或内置路径解析。用户如果希望自定义目录长期生效，仍需要保存设置。

### 后续建议

1. 为超限视频实现分批合并加 tree merge。
2. 为 worker terminate、应用退出、cancel 增加 ffmpeg 进程清理集成测试。
3. 启动时只清理可确认过期且不属于运行任务的 workspace。

## 4. 窗口、任务栏与托盘

### 目标语义

1. 点击普通最小化：窗口隐藏到任务栏，同时托盘存在；任务栏按钮不消失。
2. 点击关闭：设置为退出时退出应用；设置为关闭到托盘时只保留托盘，任务栏按钮消失。
3. 从托盘恢复：重新显示任务栏按钮，恢复窗口并聚焦。

### 静态核对结果

当前代码路径与目标一致：

- `window_minimize` 先恢复 `skip_taskbar=false` 和 Windows `WS_EX_APPWINDOW`，再 minimize，因此最小化后任务栏和托盘都在。
- `hide_main` 设置 `skip_taskbar=true`、移除 `WS_EX_APPWINDOW` 并隐藏窗口，用于关闭到托盘，此时任务栏按钮消失。
- `CloseRequested` 被拦截，由前端根据 `minimizeToTrayOnClose` 调用退出或隐藏到托盘。
- 托盘菜单和左键恢复走 `show_main()`，会恢复任务栏按钮、show、unminimize、focus。

关键落点：

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/app/useAppWorkspace.ts`
- `apps/desktop/src/app/useShellActions.ts`
- `apps/desktop/src-tauri/tauri.conf.json`

### 限制

这部分没有自动化 GUI 测试，且 Windows 扩展样式受平台行为影响。必须用打包版手工验证以下矩阵后才能认定完成：

1. 普通最小化后任务栏和托盘均存在。
2. 关闭设置为退出时，应用退出且托盘消失。
3. 关闭设置为托盘时，任务栏消失、托盘存在。
4. 托盘左键和菜单恢复后，任务栏按钮恢复且窗口可聚焦。
5. 最小化状态下关闭到托盘，再从托盘恢复。
6. 切换设置后立即关闭，以及应用重启后设置仍生效。

## 5. 性能基准与解读

已新增 `packages/core/src/organize/performance.test.ts`，使用 100,000 条内存 SQLite entries、page size 200、20 条整理规则做合成基准。该测试同时断言：

- 整理第一页和第二页均小于 2 秒。
- 改名第一页小于 2 秒。
- 第一页 sourceCount 为 200。
- 第二页首条是 `file-00200.txt`，证明没有第一页预扫描。
- 共享上下文方案不改变重复构建方案的结果。

2 秒阈值是 full-suite 并发噪声下的回归预算，仍能捕获“退化成全量扫描”级别的问题；它不是对真实库首屏时间的承诺。

### 最终基准记录

本轮最终 core 全量测试并发运行：

| 场景 | 耗时 |
| --- | ---: |
| 复杂上下文重复构建 | 10,623.3 ms |
| 复杂上下文共享后 | 3,190.5 ms |
| 上下文构建 | 3,056.4 ms |
| 整理第一页 | 281.6 ms |
| 整理第二页 | 216.6 ms |
| 改名第一页 | 178.1 ms |

不应把单次毫秒数当作承诺。机器负载、GC、SQLite cache 和并发测试都会造成明显波动；结论应以趋势为准：普通规则第一页保持在亚秒级，且共享上下文把复杂规则重复构建的耗时大幅降低。

### 基准限制

1. 这是内存 SQLite 合成库，不等价于真实磁盘库、真实目录深度和真实文件名分布。
2. `filename.match()` 类规则代表常见轻规则；`same_stem`、`children.*`、`peer_dir` 仍需大上下文，性能会明显不同。
3. 当前 benchmark 记录整体耗时，尚未拆出 SQL、rule matching、entries load、planner、React render 的 p95。
4. 真实库首屏可交互时间仍需在用户机器上采样验证。

## 6. 剩余风险与后续改造

### 1. 计划执行还没有取消和跨重启恢复

`plan.execute.start` 已把执行生命周期从 RPC 中拆出：请求立即返回 queued snapshot，前端订阅 SSE，并用 500ms 轮询兜底，因此执行超过 120 秒不再触发 10060。但执行中的计划还没有 `plan.cancel`，sidecar 重启后也只能从 job 结果判断已完成或失败，不能接管一个仍在写盘的旧 worker。

改造方案：给 `requestId/jobId` 增加取消通道，task worker 全链路接入 AbortSignal；执行状态持久化 queued/running/cancel requested，sidecar 重启时对不确定状态做 reconciliation。

效果与代价：好处是长执行可撤销，避免“UI 想停但磁盘继续写”；代价是文件操作的中断点、部分失败重试和 job 状态迁移需要更严格设计。

### 2. 重复执行计划仍在 worker 内一次性全量构建

重复执行计划已不再回传渲染层，RPC payload 和 JSON 序列化压力已移除；但 task worker 仍会调用 `listDuplicateExecutionPlan()` 在内存中生成完整计划，再交给执行器。超大结果集的内存峰值依旧存在。

改造方案：把计划按 jobId 持久化，执行阶段按批从持久化结果生成操作；执行前只校验当前批，不再在内存中持有全量 plan。

效果与代价：好处是内存和 RPC payload 可控；代价是执行进度、部分失败重试和回滚语义需要重新设计，不能简单把现有 plan 拆段。

### 3. 媒体合并 buildPlan 仍是同步 RPC

`mediaMerge.buildPlan` 会顺序读取输入 stat 和 metadata，慢盘或网络盘可能超过 120 秒；执行前还存在一次完整重建，进一步放大耗时。

改造方案：buildPlan 增加 jobId/缓存指纹，输入未变化时复用计划；慢 IO 改任务化并输出进度；执行前只校验关键身份和目标状态，不无条件重建。

效果与代价：好处是减少重复 IO 和超时；代价是缓存失效规则必须覆盖文件 mtime/size/path，否则可能用旧计划执行。

### 4. 重复分析 collecting 阶段仍全量读入

重复分析已经是后台任务，但 collecting 阶段仍先全库 `listEntries()` 再内存过滤。超大库会带来内存峰值和额外耗时。

改造方案：改为数据库 cursor/分批读取，按 library/scope 在 SQL 层收敛候选，再进入 size/hash 分层。

效果与代价：好处是内存稳定、更适合超大库；代价是查询和进度统计要改为增量累计，复杂度高于当前一次性列表。

## 7. 验证状态

### 最终自动验证

| 命令或范围 | 结果 |
| --- | --- |
| `npm.cmd test -w @nestify/core` | 233 tests：232 通过，0 失败，1 个“FFmpeg 不可用时报错”反向用例因本机可用而条件跳过 |
| `npm.cmd run test:media -w @nestify/core` | 57 tests：56 通过，0 失败；3 条真实 FFmpeg 集成路径已执行，仅 1 个反向 unavailable 用例条件跳过 |
| `npm.cmd test -w @nestify/desktop` | 15/15 通过，包含启动式 plan execution、worker 内构建重复计划和 FFmpeg 测试后立即应用三条回归 |
| `npm.cmd test -w @nestify/rules` | 2/2 通过 |
| `node --experimental-strip-types --test packages/core/src/app/runtime.test.ts` | 30/30 通过，含媒体失败后 session 清理与立即 resume |
| `node --experimental-strip-types --test apps/desktop/src/app/plan-state.test.ts` | 4/4 通过 |
| `node --experimental-strip-types --test packages/core/src/organize/performance.test.ts` | 2/2 通过，耗时见上文 |
| `npm.cmd run typecheck -w @nestify/core` | 通过 |
| `npm.cmd run typecheck -w @nestify/desktop` | 通过 |
| `npm.cmd run typecheck -w @nestify/shared` | 通过 |
| `npm.cmd run typecheck -w @nestify/rules` | 通过 |
| `cargo check --offline` | 通过 |
| `git diff --check` | 无 whitespace 错误；仅输出既有 LF/CRLF 提示 |

### 静态核对完成

- 整理和改名第三步的外层筛选、source page、内层规则二次过滤链路。
- 整理和改名按精确目标路径加载 bystander 的冲突上下文。
- 整理确认页 `organizeResultOps -> PlanTable` 的受控分页和 `sourceHasMore` 接线。
- 访问页聚合、operation identity 选择迁移和刷新前状态读取顺序。
- 整理/改名执行选择按聚合 index 处理，取消无 `entryId` 的 `mkdir` 不再执行。
- 重复分析 jobId、进度、取消、完成顺序和结果分页链路。
- `plan.execute.start` 立即返回、task worker 延迟执行、SSE 终态加轮询兜底、重复计划不回传渲染层的链路。
- 合并资源护栏、临时文件登记清理、link 发布、终态 session 清理和 resume 状态判断。
- 媒体合并 worker 的 FFmpeg/FFprobe 传入路径、环境路径和最终解析路径诊断。
- 窗口最小化、关闭到托盘、托盘恢复的任务栏样式调用。

### 待手工验证

1. 真实磁盘大库第三步首屏、翻页、规则刷新和跨页选择。
2. 重复大库任务的进度、取消、重启后结果回看，以及旧 10060 场景复测。
3. 合并超大输入、慢盘、进程强杀、断电式异常和 ffmpeg 清理专项。
4. Windows 打包版窗口/托盘矩阵。

## 8. 审阅结论

当前修复已经覆盖本轮发现的阻塞性问题：第三步二次筛选和懒加载语义、整理确认页真实后端分页、跨页选择和执行索引、重复分析与执行任务化、合并资源与终态清理、FFmpeg 执行诊断。自动测试全部通过，Noether 与 Aquinas 两个真实子代理的复核结论也已并入。

剩余边界同样明确：执行不能取消且 sidecar 重启后不能接管，重复执行计划仍在 worker 内一次性构建，媒体 buildPlan 仍是同步 RPC；真实 GUI 行为和真实磁盘场景没有自动化覆盖。后续应优先补 `plan.cancel`、分批执行计划和媒体 buildPlan 任务化，而不是继续扩大前端分页。
