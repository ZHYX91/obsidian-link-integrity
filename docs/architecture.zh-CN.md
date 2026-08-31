---
source_language: zh-CN
translation_status: source
---

# Link Integrity — 架构

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

持久化的 occurrence 忽略规则使用带版本的语义身份：规范化来源路径、occurrence 类型、原始文本与链接文本的哈希、重复项序号及重复集合基数。可变的行列位置与全局序号仅作为跳转和迁移元数据，不参与语义规则身份。因而在 occurrence 前插入无关内容或不同链接不会让规则失效，Vault 文件或文件夹重命名事件还会改写已保存身份中的来源部分。对于无法区分的同语义重复项，一旦重复集合基数变化，已有规则会有意匹配零项，直到用户检查设置中的匹配预览，而不会静默绑定到错误的重复项。

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

Markdown 降级解析器在保留 UTF-16 源 offset 的同时屏蔽 fenced/indented code、inline code、Obsidian comment，以及支持 BOM 和 `---`/`...` 边界的 frontmatter 内 YAML comment；frontmatter value 和普通 Markdown 文本中的显式链接继续保留。Canvas text node 使用同一降级路径，因此启动期临时解析和 Canvas 诊断共用同一个 false-positive 边界。

core 的规范化 lookup key 只用于命名空间变化后的保守重验证。它不替代官方 resolver，也不决定最终目标。

## 图与查询不变量

只有内部引用、文件级状态为 resolved、目标当前存在且来源和目标不同，才贡献有效边。标题或块缺失不撤销文件级边。外部 URL、自链接和 Bases 动态结果不贡献连接。

边按来源、目标和 occurrence 类型计数，因此删除一个重复引用不会误删同一对文件之间的其他贡献。孤立投影检查不同文件之间的有效入邻居和出邻居均为零；无入链投影仅检查入邻居为零。

候选、诊断和贡献范围分别应用于查询、可见性和图。普通筛选不触碰图。高级贡献排除由产品层注入独立的 `GraphContributionPolicy`：规则设置变化直接用已存储的文件 registry 与来源快照重新求值边和自链接，不重新读取或解析 Vault；普通来源快照替换只对该来源的旧、新 occurrence 求值并局部维护边。显式集合型排除仍由 `GraphContributionScope` 表达，产品层负责提示高级规则可能产生的风险。

精确预期孤立路径与预期孤立规则都在查询层运行。它们只给已经孤立的候选分类，不写入 `LinkIndex` 边集合，因此不会产生日期邻接伪边。侧栏投影只生成结果和分类计数，规则命中统计仅由设置预览按需计算。精确路径在设置加载时规范化、去重；文件 rename 更新精确路径，文件夹 rename 按路径边界同步其后代精确路径、文件夹规则与周期笔记目录；缺失路径不会被静默删除。

## 事务化全量重建

全量重建先从 adapter 取得当前文件 registry，再在独立 staging `LinkIndex` 中以有限并发构建来源快照。控制器同时按文件数上限和约 8 ms 主线程时间预算主动让步，并支持可注入的让步函数和节流进度回调，避免快速文件或单批解析工作长期占用渲染线程。

当启动扫描、侧栏或手动重建请求 baseline 时，Vault 的 create、modify、delete、rename 事件会在首次宿主级 Metadata Cache 解析完成边界之前注册，并进入有界合并缓冲。新一轮全量 staging 开始前已经积累的事件由即将读取当前 Vault 的 baseline 吸收，不再重复回放；只有 staging 开始后到达的事件才交给协调器在 staging 上重放，追赶到当前 Vault 状态后再原子发布。Metadata Cache 的 change/delete 监听则等到首次解析完成边界（或有界兜底等待）和全量重建结束后再挂载。有界等待超时只放行 baseline，不会把缓存误标为已解析；一次性宿主级 `resolved` 监听会继续保留，若信号稍后到达则合成一次全来源重验证纠正兜底结果。运行时刻意不订阅逐文件 `resolve(file)`：内容和命名空间事件已经会重验证变化来源及其引用者，而重放宿主启动期解析尾流只会重复全量扫描。

只有 staging 完整成功后，`AtomicLinkIndexStore` 才一次性发布新索引。构建失败不会改变当前索引；已有索引继续作为 last-known-good，并由应用状态标记失败或可能过期。

`LinkIndexCoordinator` 在重建期间缓冲来源事件，在 staging 上重放并追赶当前 Vault 状态后再发布。已有 baseline 的重建失败时，剩余事件继续更新 last-known-good 并维持 stale 状态；首次 baseline 失败时则丢弃该批增量，不允许从局部事件制造索引，下一次重建重新读取完整 Vault。同一生命周期的并发重建调用共享同一个 rebuild promise。每轮重建都有独立操作代次和取消信号；停止或重启会让旧 worker 不再领取新来源，并禁止旧 catch/finally、进度或发布触碰新生命周期。宿主读取本身不可抢占，因此取消边界是最多保留当前有限并发内已经在途的读取。

## 增量更新

与宿主无关的增量控制器接受 create、modify、delete、rename 和合成 metadata-resolved 事件；Obsidian 运行时向其提供 Vault 事件及 Metadata Cache change/delete 事件。重复运行时事件先进入 100 ms 尾随安静窗，并由 500 ms 最大等待兜底，再于快照工作前合并；快照构建使用有限并发。

一致性保护包括：

- lifecycle epoch：停止或重启后，旧生命周期结果不能发布；
- operation generation 与取消信号：旧重建不能清理新控制器、领取更多来源或发布完成诊断；
- path revision：每个受影响来源具有单调 revision，旧异步快照不能覆盖新 revision；
- 有界安静窗 coalescing：同一路径重复出现的 Vault 与 Metadata Cache 回调只触发一次构建，同时连续事件流也不能无限推迟更新；
- lookup 和 target 反向索引：命名空间或目标元数据变化时，同时重验证直接来源、解析到该目标的来源以及可能按 lookup key 重新定向的来源。

create、delete 和 rename 会重新取得文件 registry，并比较新旧 lookup keys。删除来源时，其完整快照通过同一替换 reducer 移除。Vault modify 与 Metadata Cache changed 回调经过有界安静窗后重验证来源及其引用者。宿主级 `resolved` 通常只作为初始就绪边界；只有首次等待已超时放行 baseline 时，随后到达的第一个 `resolved` 才转换为一次全来源纠偏，之后的普通信号仍被忽略。快照和贡献范围替换会先做语义 no-op 检查；普通快照替换沿当前贡献 policy 局部更新，只有 policy 或显式贡献范围变化才重新求值整张图。全量 staging 继承协调器当前的 policy，并在发布前再次同步规则变化。

无效链接与孤立文件使用相互独立的惰性结果投影，只在索引、设置或图语义改变时失效。只有当前活动页签会计算对应投影并构建排序后的分组或目录树；非活动页签显示上次已知徽标，首次查询前显示未知标记。无效链接的来源文件夹树从当前固定页的来源路径构建，计数来自完整可见投影；只有展开分支才创建后代结果 DOM，展开路径作为界面偏好持久化。进度和普通状态更新复用两类缓存，高级无入链投影未启用时不计算。渲染采用固定 100 条分页，单个视图不会把整个 Vault 实体化为 DOM。

## 持久化与恢复

插件不持久化 `LinkIndex`、边或诊断投影。`data.json` 只保存经 schema、迁移和归一化处理的设置、规则和界面偏好。这样避免把跨重启的旧命名空间结果误当作权威事实。

协调器另行维护一个只读的运行时诊断快照。文件、来源和 occurrence 数量直接读取索引内部容器大小；完整重建与成功增量批次只在完成边界记录聚合数量、完成时间、耗时和待处理事件数。设置 UI 订阅该小型快照，不遍历 Vault、不调用规范化状态导出，也不持久化诊断数据。staging 回放不会冒充已发布索引的增量诊断。

“启动时扫描”默认关闭。保持关闭且尚未打开侧栏时，协调器、Vault 监听和 Metadata Cache 监听均不启动。恢复或首次打开侧栏、工作区就绪后启用启动扫描，或手动重建，才会启动运行时并建立完整 baseline；局部事件不会被用于制造不完整 baseline。baseline 成功后，增量控制器在当前会话持续同步，因此日常变化不需要手动刷新。若将来性能证据要求跨重启缓存，也只能把它视为可验证缓存，不能绕过当前 Vault 的重新解析。

## 当前实现边界

自动测试已经覆盖核心图不变量、快照替换、regraph 与干净物化结果的规范化差分等价、同步 reducer batch 预验证、同名目标重验证、随机事件差分、late Metadata Cache 纠偏、last-known-good、事件重放、worker 取消、操作代次隔离和查询语义。专项 10k/50k benchmark 还约束普通单来源更新只求值该来源的旧、新 occurrence。实际解析准确性最终仍依赖运行中的 Obsidian API 和真实文件缓存。

当前没有派生图持久化、外部 URL 网络检查、自动删除或批量修复。架构测试不能证明所需的 Obsidian 1.12.7/当前 1.13.x 桌面宿主矩阵、实时事件路径或 Android 模拟器行为；桌面宿主始终需要独立验收，`isDesktopOnly: false` 的候选还需要当前 Android 模拟器证据。Android 真机和 iOS 不在验收范围内；历史真机证据仅作补充，不构成发布门槛。
