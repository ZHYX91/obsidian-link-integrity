---
source_language: zh-CN
translation_status: source
---

# Link Integrity — 发布流程

本文定义 Link Integrity 的可重复发布流程。源码、Candidate Bundle、真实 Obsidian 验收、GitHub
发布与 Community Plugins 状态是独立证据边界。

## 边界

普通 tag push 不触发发布。commit、push、tag、workflow dispatch、GitHub Release 与正式 Vault
部署分别授权；Community Plugins 的收录也不是 GitHub Release 的隐含结果。

## 版本与源码

`manifest.json`、`package.json`、`package-lock.json` 与 `versions.json` 必须绑定同一规范版本和精确
commit/tree。干净工作树必须通过 `npm run release:check`，包括 index quick/large guardrail 与
tag identity 门禁。

## Candidate Bundle v3

vendored release-core `2.0.0` 与薄 adapter 创建唯一 Candidate Bundle v3，包含 `main.js`、
`manifest.json`、`styles.css`、`link-integrity-x.y.z.zip`、`SHA256SUMS` 与
`candidate-bundle.json`。Bundle 绑定工具链、core/config/workflow、产品 payload、场景合同及
fixture 哈希，不存在并行 receipt、envelope 或手工恢复目录。

## 产品验收

同一 Bundle 必须通过桌面与 Android 模拟器验收，覆盖 broken-link 与 isolated-file 分类、预期
周期隔离、Markdown/embed/frontmatter/Canvas/Bases 边、导航和增量更新与全量重建等价。Android
真机和 iOS 不在范围内。

## 独立工作流

生成并签入的 standalone workflow 只接受显式 `workflow_dispatch`。只读 verify job 在精确
commit 上执行一次独立安装与一次完整 `release:check`，重建并 source-verify Bundle；publish
job 下载固定 artifact 后只做 transport verification，不恢复或信任 `dist`。

## 发布与核验

acceptance closure 不授权发布；单独 authorization 绑定同一 Bundle 与 closure。首次 mutation
前 workflow 深度验证记录、标签和只读 preflight。公共 Release 恰好包含三个 loose assets 与
版本 ZIP；`SHA256SUMS` 与 `candidate-bundle.json` 只属于私有 Bundle。发布后回读托管字节与
provenance。

## 失败、回退与部署

既有同 tag Release 只有完全一致时才是零写 no-op；任何差异都失败且不得覆盖，修复使用新版本。
正式 Vault 部署需单独授权并保留 `data.json`。GitHub Release、Community Plugins 审核与部署
结果必须分别报告。
