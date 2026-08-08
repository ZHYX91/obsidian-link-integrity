# Link Integrity 发布合同

## 1. 范围

本文件定义 Link Integrity 从带标签源码到 GitHub Release 的阻断路径。仓库检查、打包候选验证、真实 Obsidian 验收、GitHub 发布和 Obsidian 社区目录审核仍是相互独立的证据边界。

发布 workflow 与同目录 Obsidian 插件采用相同结构：只读 verify job 生成一个精确 handoff，具有写权限的 publish job 只消费该 handoff。Immutable Releases、标签 ruleset 等仓库治理设置属于可选保护，不是发布前置条件。

## 2. 身份、版本与来源

- 包名是 `obsidian-link-integrity`，manifest ID 是 `link-integrity`。
- `manifest.json`、`package.json`、lockfile root、`versions.json` 和 Release tag 使用同一版本。
- tag 只接受严格稳定的 `x.y.z`，没有 `v` 前缀、前导零、prerelease 或 build metadata。
- tag 必须精确指向默认分支历史中的提交。
- 使用 Node `24.18.0`、npm `11.16.0` 和 frozen lockfile。
- 第三方 GitHub Actions 固定到完整 commit SHA。

## 3. 阻断门禁

发布前运行 `npm run release:check`，覆盖 runtime、lint、格式、文档、TypeScript、测试、覆盖率、生产 bundle、发布合同以及 10,000/50,000 文件性能门禁。

## 4. Release 附件

公共 Release 精确包含：

- `main.js`
- `manifest.json`
- `styles.css`
- `link-integrity-<version>.zip`

workflow handoff 额外包含 `SHA256SUMS`，但它不是公共 Release 附件。确定性 ZIP 只包含一个 `link-integrity/` 安装目录，其中三个文件与 loose assets 逐字节相同。

候选验证拒绝缺失或多余文件、符号链接、不安全 ZIP 路径、身份或版本不一致以及 checksum 不一致。

## 5. Handoff 与发布

verify job 上传一个名称绑定当前 run ID 与 attempt 的 artifact，并记录精确 artifact ID 和服务端 digest。publish job 不 checkout 仓库、不安装依赖、不 build，也不执行仓库脚本；它按 ID 下载 artifact，验证身份、digest、文件集合、checksum 和 manifest 版本，然后为既有 tag 创建带自动生成说明的 Release。

workflow 不覆盖已有同 tag Release；如需改变发布内容，必须提升版本。

## 6. Provenance 与最终验证

GitHub attestations 覆盖四个公共附件。发布后，workflow 回读 Release，要求其不是 draft 或 prerelease，且附件集合精确；随后下载每个附件，与已验证候选逐字节比较，并验证 repository、workflow signer、source ref、source commit 和非 self-hosted runner provenance。

## 7. 插件市场边界

创建 GitHub Release 不等于进入 Obsidian 社区目录。维护者还必须通过 Obsidian 社区插件提交站点单独提交仓库。社区目录读取默认分支的 `manifest.json`，安装则使用匹配版本的 GitHub Release 附件。

## 8. 证据记录

每次发布保留总门禁日志、精确 runtime、bundle budget 结果、候选 artifact ID 与 digest、四个公共附件 checksum、attestations、最终 Release 回读和 tag 身份。绿色 workflow 只证明发布事务成功，不能替代物理设备或更广泛的正式 Vault 验收。
