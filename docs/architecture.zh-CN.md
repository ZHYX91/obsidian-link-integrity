# Link Integrity 架构

本文说明 Link Integrity 当前实现的模块边界、索引不变量和一致性策略。

## 模块边界

代码按职责分层：

- `src/core/`：纯 TypeScript 文件分类、链接模型、图、范围和预期孤立规则，不导入 Obsidian；
- `src/features/index/`：全量重建、原子发布、增量事件协调和生命周期控制；
- `src/features/queries/`：无效链接、孤立文件、无入链和预期孤立投影；
- `src/adapters/`：Vault、Metadata Cache、链接解析、Canvas、Bases 和导航等宿主边界；
- `src/ui/`：侧栏、设置和无障碍交互；
- `src/app/`：插件生命周期、依赖组合和状态协调；
- `src/shared/`：设置、i18n、保存队列和通用规则服务。

`LinkIndex` 是派生诊断的单一事实源。视图和设置预览通过查询层读取索引，不应自行扫描 Vault。

## 核心数据模型

每个 `LinkOccurrence` 保存稳定 ID、来源路径、原始文本、linkpath、subpath、类型、位置、lookup key、目标路径以及文件级和子路径级状态。文件级状态与标题或块状态分离，因此“文件存在但标题缺失”可以同时形成有效文件边和无效子路径诊断。

每个来源文件对应一个完整 `SourceSnapshot`。更新来源时，索引通过同一个 reducer 整体替换快照；旧 occurrence、lookup 引用和边贡献同步移除，新内容同步加入，不做字段级拼补。

索引维护：

- 当前 `FileRecord` registry；
- 按来源保存的完整快照；
- 所有 occurrence，包括当前有效链接的 lookup-key 反向索引；
- 按已解析目标路径的反向索引；
- 按引用类型计数的正反向有效边；
- 自链接计数和文件元数据。

保留所有 lookup 引用很重要：新建、删除或重命名同名文件可能使一个原本有效或无效的链接重新定向。

## 解析适配器

Obsidian 语义只在 adapter 中解析。当前 adapter 使用官方 `parseLinktext`、`MetadataCache.getFirstLinkpathDest` 和 `resolveSubpath`，而不是在 core 中复制路径、别名、标题或块规范化算法。

adapter 为每个可作为显式来源的文件构建完整快照：Markdown 和 Frontmatter 使用 Metadata Cache 并在必要时从文本降级提取；Canvas 读取显式文件节点、背景文件和文本内部链接；Bases 只提取显式文件引用。动态 Bases 查询结果不会传入图模型。无效 Canvas JSON 采用 fail-closed：当前批次不替换文件元数据或快照，已有 last-known-good 索引以过期状态继续可见，而不会把该 Canvas 错报为高置信孤立文件。

core 的规范化 lookup key 只用于命名空间变化后的保守重验证。它不替代官方 resolver，也不决定最终目标。

## 图与查询不变量

只有内部引用、文件级状态为 resolved、目标当前存在且来源和目标不同，才贡献有效边。标题或块缺失不撤销文件级边。外部 URL、自链接和 Bases 动态结果不贡献连接。

边按来源、目标和 occurrence 类型计数，因此删除一个重复引用不会误删同一对文件之间的其他贡献。孤立投影检查不同文件之间的有效入邻居和出邻居均为零；无入链投影仅检查入邻居为零。

候选、诊断和贡献范围分别应用于查询、可见性和图。普通筛选不触碰图。高级贡献排除通过单独的 `GraphContributionScope` 重建图状态，并由产品层负责风险警告。

预期孤立规则在查询层运行。它们只给已经孤立的候选分类，不写入 `LinkIndex` 边集合，因此不会产生日期邻接伪边。

## 事务化全量重建

全量重建先从 adapter 取得当前文件 registry，再在独立 staging `LinkIndex` 中以有限并发构建来源快照。控制器支持可注入的时间片让步和节流进度回调，避免大量快速完成的工作长期占用同一任务。

只有 staging 完整成功后，`AtomicLinkIndexStore` 才一次性发布新索引。构建失败不会改变当前索引；已有索引继续作为 last-known-good，并由应用状态标记失败或可能过期。

`LinkIndexCoordinator` 在重建期间缓冲来源事件，在 staging 上重放并追赶当前 Vault 状态后再发布。并发刷新调用共享同一个 rebuild promise。插件生命周期改变时，旧重建会被取消发布，避免卸载后的异步结果覆盖状态。

## 增量更新

增量控制器接受 create、modify、delete、rename 和 metadata-resolved 事件。重复事件先合并；快照构建使用有限并发。

一致性保护包括：

- lifecycle epoch：停止或重启后，旧生命周期结果不能发布；
- path revision：每个受影响来源具有单调 revision，旧异步快照不能覆盖新 revision；
- 同批 coalescing：同一路径的重复事件只触发一次当前批构建；
- lookup 和 target 反向索引：命名空间或目标元数据变化时，同时重验证直接来源、解析到该目标的来源以及可能按 lookup key 重新定向的来源。

create、delete 和 rename 会重新取得文件 registry，并比较新旧 lookup keys。删除来源时，其完整快照通过同一替换 reducer 移除。全局 metadata-resolved 事件可以保守地重建所有来源。

## 持久化与恢复

初始版本不持久化 `LinkIndex`、边或诊断投影。`data.json` 只保存经 schema、迁移和归一化处理的设置、规则和界面偏好。这样避免把跨重启的旧命名空间结果误当作权威事实。

插件按“启动时扫描”设置决定是否在启动后执行全量重建。禁用时，状态明确保持“尚未扫描”，来源事件不能建立局部 baseline；首次手动刷新必须先完成全量重建。只有 baseline 成功后，增量控制器才在当前会话持续同步。若将来性能证据要求跨重启缓存，也只能把它视为可验证缓存，不能绕过当前 Vault 的重新解析。

## 当前实现边界

自动测试已经覆盖核心图不变量、快照替换、同名目标重验证、随机事件差分、last-known-good、事件重放、生命周期取消和查询语义。实际解析准确性最终仍依赖运行中的 Obsidian API 和真实文件缓存。

当前没有派生图持久化、外部 URL 网络检查、自动删除或批量修复。真实 Obsidian 1.12.7/当前 1.13.x、Android 模拟器和物理设备行为尚不能由架构测试推断，必须分别验收。
