---
source_language: zh-CN
translation_status: source
---

# Link Integrity — 发布流程

## 1. 范围

本文件定义 Link Integrity 从带标签源码到 GitHub Release 的阻断路径。仓库检查、打包候选验证、真实 Obsidian 验收、GitHub 发布和 Obsidian 社区目录审核仍是相互独立的证据边界。

发布 workflow 分离权限：只读 verify job 重建一个摘要绑定的精确 handoff；只有手动
`publish` 派发同时带有通过的 acceptance closure 与独立、精确的单候选授权时，才可启动
写权限任务。创建与推送 tag 是独立动作，不触发发布。workflow 不预检仓库治理设置；标签
ruleset 仍是可选保护，但发布成功要求创建后的 Release 在最终回读中报告 `immutable: true`。

## 2. 身份、版本与来源

- 包名是 `obsidian-link-integrity`，manifest ID 是 `link-integrity`。
- `manifest.json`、`package.json`、lockfile root、`versions.json` 和 Release tag 使用同一版本。
- tag 只接受严格稳定的 `x.y.z`，没有 `v` 前缀、前导零、prerelease 或 build metadata。
- tag 必须精确指向默认分支历史中的提交。
- 使用 Node `24.19.0`、npm `11.17.0` 和 frozen lockfile。
- 第三方 GitHub Actions 固定到完整 commit SHA。

## 3. 阻断门禁

`npm run check` 运行 runtime、lint、格式、文档、TypeScript、覆盖率、production bundle，
并通过 vendored core 校验公共元数据与精确资产集合。`npm run release:check` 额外运行
10,000/50,000 文件性能门禁和 tag-aware 校验。准备候选时允许本地同版本 tag 不存在；若已
存在，则必须精确解析到 `HEAD`，不能复用其他提交上的 tag。

## 4. Release 附件

公共 Release 精确包含：

- `main.js`
- `manifest.json`
- `styles.css`
- `link-integrity-<version>.zip`

workflow handoff 额外包含 `candidate.json` 和 `SHA256SUMS`，二者都不是公共 Release
附件。确定性 ZIP 只包含一个 `link-integrity/` 安装目录，其中三个文件与 loose assets
逐字节相同。

候选验证拒绝缺失或多余文件、符号链接、不安全 ZIP 路径、身份或版本不一致以及 checksum 不一致。

## 5. Handoff 与发布

手动 workflow 默认 `verify`。只读任务校验精确 candidate commit、数值 tag、默认分支祖先、
固定工具链、完整门禁与重建后的 `candidate.json` 摘要，再上传一个以稳定 workspace
release-run ID 命名的 artifact，并记录精确 artifact ID 和服务端 digest。

`publish` 任务只以不持久化凭据的方式 checkout 同一 candidate commit，不安装依赖也不重新
build。它按 ID 下载 artifact，解码原始可移植 closure 与 authorization 字节，校验各自摘要和
绑定，并运行 vendored core publication boundary。任何远端写入前，只读 GitHub 预检只在
Release 不存在时才允许暂存、签发 provenance 和创建；既有 Release 只有字节与 provenance
全部精确通过时才作为零写入安全重跑，任何冲突都在这些写入前失败，且 `publish-github` 会重复
检查。独立 post-verification 任务重新下载同一 artifact，并检查托管后的不可变状态。

既有同 tag Release 只有在稳定、不可变、精确包含四个公共附件、与当前候选逐字节一致，且每项
provenance 都绑定当前 tag 与 commit 时，才作为安全重跑的成功 no-op 接受。任何差异都会失败；
workflow 不覆盖、编辑或追加既有 Release，变更发布内容必须提升版本。

## 6. Provenance 与最终验证

GitHub attestations 覆盖四个公共附件。发布后，workflow 在有限重试中回读 Release，要求其不是 draft 或 prerelease、`immutable` 为 `true`，且附件集合精确；随后下载每个附件，与已验证候选逐字节比较，并验证 repository、workflow signer、source ref、source commit 和非 self-hosted runner provenance。

## 7. 插件市场边界

创建 GitHub Release 不等于进入 Obsidian 社区目录。维护者还必须通过 Obsidian 社区插件提交站点单独提交仓库。社区目录读取默认分支的 `manifest.json`，安装则使用匹配版本的 GitHub Release 附件。

## 8. 证据记录

每次发布保留总门禁日志、精确 runtime、bundle budget 结果、候选 artifact ID 与 digest、四个公共附件 checksum、attestations、最终 Release 回读和 tag 身份。绿色 workflow 只证明发布事务成功，不能替代物理设备或更广泛的正式 Vault 验收。
