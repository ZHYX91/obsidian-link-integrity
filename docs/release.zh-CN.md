# Link Integrity 发布合同

## 1. 范围与原则

本文件定义 Link Integrity 从本地源代码到 GitHub Release 的阻断合同。当前仓库只准备和验证本地代码，不授权推送、创建标签、发布 Release 或修改 GitHub 设置。

发布分为三个权限域：

1. CI 验证源码与总门禁。
2. prepare 只读构建并上传当前运行的精确候选。
3. publish 不检出或执行仓库代码，只验证候选、创建或确认不可变 Release，并验证 provenance。

自动化门禁、候选包验证、真实 Obsidian 宿主验收和真实 GitHub Actions 运行是四种不同证据，不能互相替代。

## 2. 身份、版本与运行时

- 仓库包名是 `obsidian-link-integrity`，manifest ID 是 `link-integrity`。
- `manifest.json`、`package.json`、lockfile root、`versions.json` 当前条目和 Release tag 的版本必须一致。
- tag 只接受严格稳定的 `x.y.z`：没有 `v`、前导零、prerelease 或 build metadata。
- `manifest.minAppVersion` 必须与 `versions.json` 中当前版本映射一致。
- 首个 Release 明确允许没有历史 baseline。
- Node `24.18.0` 与 npm `11.16.0` 是本地、CI 和 release 的共同运行时合同；依赖安装必须使用 frozen lockfile。

所有第三方 GitHub Actions 必须固定到完整 commit SHA，不得使用浮动 tag 或 branch。

## 3. 单一总门禁

总门禁按 fail-closed 顺序覆盖：

1. Node/npm 运行时合同；
2. lint 与确定性格式检查；
3. README 11 语言导航以及常驻中英双语文档；
4. strict TypeScript；
5. 完整单元、差分、UI 和发布脚本测试；
6. 生产 bundle；
7. 版本、附件、确定性 ZIP、bundle budget 和 workflow 静态合同。

`main.js` 的阻断 budget 必须来自本地实测 reference，并在源码中记录测量值与预算理由。prepare 从两个 clean 工作目录独立执行构建和归档，要求 `main.js` 与 ZIP 逐字节一致；仅“都能成功构建”不算可复现证据。

## 4. 公共附件与确定性 ZIP

Release 的公共附件集合必须精确为：

- `main.js`
- `manifest.json`
- `styles.css`
- `link-integrity-<version>.zip`

handoff artifact 另外且仅包含 `SHA256SUMS`。它不是公共 Release 附件。

ZIP 精确包含一个 `link-integrity/` 安装目录，其中三个条目的顺序固定为 `main.js`、`manifest.json`、`styles.css`。条目时间、Unix 权限、压缩参数和目录布局固定；ZIP 内三项必须与 loose assets 逐字节相同。`SHA256SUMS` 精确记录四个公共附件的 SHA-256。

候选验证必须拒绝符号链接、目录、设备文件、多余条目、缺失条目、重复 ZIP 名称、不安全路径、身份或版本不符以及任意哈希不一致。

## 5. prepare 与精确 handoff

preflight 和 prepare 全程只读，不创建或修改远端 Release。候选 artifact 名同时绑定 `github.run_id` 和 `github.run_attempt`，禁止 overwrite。

prepare 上传后，从 GitHub API 回读当前运行的 artifact，并向 publish 传递：

- 精确 artifact 名；
- GitHub artifact ID；
- GitHub 返回的服务端 artifact digest；
- 当前 run ID 与 attempt。

publish 必须验证 artifact 所属仓库和 owner、run、attempt、ID、名称以及服务端 digest，然后按 ID 下载。按名称搜索“最新同名 artifact”或容忍多个候选均被禁止。

## 6. publish 权限与代码隔离

publish job 只授予：

- `actions: read`
- `contents: write`
- `attestations: write`
- `id-token: write`

publish 不得 checkout、setup Node/npm、安装依赖、build，或执行任何 checked-out repository script/code。远端 API、身份、附件、ZIP 和 provenance 检查只能使用 workflow 内联且无第三方依赖的逻辑，并在 runner 临时目录执行。发布 job 也不得接受自托管 runner。

新发布显式遵循 GitHub [推荐的 immutable Release 顺序](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)：

1. 首先通过带认证的分页 Release 回读（有 push 权限的 token 可看到 draft）证明候选版本未被任何 Release 占用。若已存在 draft 或任意不一致 Release，则 fail-closed；只有精确一致的既有 immutable Release 可以进入 same-tag no-op。
2. workflow 通过 REST API 创建不带附件的空 draft；其隐藏标记绑定当前 run ID、run attempt 与 source commit，并从已验证的 `201` 响应直接记录数值 Release ID。若写入响应不明确，不重放这一非幂等写入；只能通过有界分页回读恢复带有该标记的唯一且精确空 draft。
3. workflow 通过已捕获的 Release ID 在不 clobber 的前提下精确上传四个公共附件，再按同一个 ID 回读；此时它必须仍是 draft，附件集合、服务端摘要和每个远端字节都必须精确一致。
4. 只有本次捕获的 draft ID 可以切换为 published；最终回读必须达到精确 immutable 合同。

create、upload、publish 是一个受 earlier absence decision 保护的事务。workflow 不得接管、续传、完成、发布或以其他方式修补在该事务开始前已经存在的 Release。

## 7. 发布历史与 notes baseline

dispatch 和 tag 触发都必须验证：

- 仓库和默认分支身份；
- tag 精确指向候选 source commit；
- source commit 位于默认分支历史；
- 候选版本高于所有真实已发布的稳定 Release。

Release notes baseline 选择最高的较低稳定 Release，并验证其 tag commit 是候选 commit 的祖先。没有较低稳定 Release 时使用明确的 first-release 路径，不猜测 baseline。

draft、prerelease、非稳定 tag 和缺少可验证 tag 的条目不参与稳定版本 baseline，但其异常不能被静默当作可覆盖对象。

## 8. same-tag 严格 no-op

若同一 tag 已存在，只允许严格 no-op：

- Release 已 immutable，且不是 draft 或 prerelease；
- tag 仍精确指向候选 source commit；
- 公共附件集合精确一致；
- 每个附件字节与当前候选一致；
- 每个附件的 provenance 通过第 9 节全部检查。

任一条件不符都 fail-closed，并要求提升版本。自动化不得编辑、覆盖、删除、重建或“修复”已有 Release。

## 9. provenance 与最终回读

same-tag no-op 与新发布后的最终回读都必须逐个验证四个公共附件的 attestations：

- exact repository；
- exact release workflow signer；
- exact source ref；
- exact source commit digest；
- runner 环境不是 self-hosted。

创建新 Release 时，在任何 Release 写入前先验证候选 provenance 与 GitHub-hosted runner 边界。发布达到 immutable 后，最终回读再次核对 tag、Release 状态、精确附件集合、远端字节和 attestations；只有全部一致才算发布完成。

## 10. 并发、重试与失败边界

release 使用仓库级 concurrency，`cancel-in-progress: false`。重试是有界的并带退避：

- transport 错误、404、5xx 可重试；
- immutable 或附件传播期间内容未就绪的 200 可重试；
- 具有确定性含义的普通 4xx 立即失败。

自动失败恢复不得删除或重写 Release，也不得回滚 tag。若创建、上传或发布失败，空 draft 或部分上传的 draft 必须原样保留，供人工诊断；后续重跑会把它视为既有 Release，拒绝续传、完成、删除或修补。若已经存在不一致 Release，唯一自动化允许的后续路径是使用更高版本重新发布。

## 11. 发布前人工检查表

真实发布前，维护者必须在 GitHub 网页确认并记录：

- Immutable Releases 已启用；
- 数字版本 tag ruleset 覆盖严格 `x.y.z`；
- ruleset 禁止 tag update 和 deletion；
- ruleset 没有 bypass actor；
- 默认分支和仓库 owner 与 workflow 预期一致；
- 所需 GitHub provenance/attestation 功能可用。

本地脚本只能检查 workflow 和候选合同，不能替代这些外部设置证据。本项目初始化阶段不得由自动化创建或修改它们。

## 12. 证据记录

每个候选应保留：总门禁日志、精确 runtime、两次 clean 构建哈希、两次 ZIP 哈希、bundle reference/budget 结果、四项附件 SHA-256 和候选 manifest 身份。真实发布另需保存 current-run artifact 元数据、Release 回读、每项 provenance 结果以及最终 tag 回读。

本地绿色只证明仓库内合同通过；在真实 GitHub Actions 运行完成前，artifact API 的传播行为、权限最小化、immutable 时序和 provenance signer 仍是未验证项。
