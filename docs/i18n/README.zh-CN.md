# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity 是完全本地、只读的 Obsidian 诊断插件，用于查找 Broken links（无效链接）和 Isolated files（孤立文件）。

## 界面截图

在紧凑的侧栏中查看无效链接和孤立文件：

![Link Integrity 无效链接侧栏](../assets/link-integrity-overview-en.png)

在 Obsidian 设置中配置索引、忽略规则、文件类型和预期孤立模式：

## 功能特性

- 报告 Markdown 正文、嵌入、Frontmatter、Canvas 和 Bases 显式文件引用中的无效文件、标题与块链接。
- 查找与其他现有 Vault 文件既无有效入链也无有效出链的文件；自链接和外部 URL 不构成 Vault 连接。
- 含无效出链的孤立文件会标记为低置信度，不会伪装成高置信度清理候选。
- 周期笔记、模板、归档等有意形成的集合可进入可选的“预期孤立”投影，不会伪造图边。
- 可按 Obsidian 文件、图片及格式族、音频、视频、PDF 和自定义附件扩展名筛选。
- 必要时建立完整基线，之后通过 Vault 与 Metadata Cache 增量更新保持结果实时，无需日常手动刷新。
- 选择诊断即可打开来源；所有扫描、匹配与索引都在本地完成。

Bases 动态查询结果不算显式边。文件目标已解析但标题或块缺失时，文件级连接仍然有效，同时单独报告子路径错误。

## 使用要求与兼容性

- Obsidian 1.12.7 或更高版本。
- 面向桌面端和移动端；桌面、模拟器和物理设备仍是彼此独立的真实宿主验收边界。
- 只诊断当前 Vault，不检查外部网站或远程资源。

## 安装

社区目录审核通过后，可从 **设置 → 第三方插件 → 浏览** 安装。也可以从[最新 GitHub 版本](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)下载 `link-integrity-<version>.zip`。

手动安装时，把 `main.js`、`manifest.json` 和 `styles.css` 放入 `Vault/.obsidian/plugins/link-integrity/`，重新加载 Obsidian 并启用插件。升级只替换这三个文件；除非明确重置设置，否则保留 `data.json`。

## 使用

1. 在 **设置 → 第三方插件** 中启用 Link Integrity。
2. 从功能区或命令面板打开插件；侧栏包含 **无效链接** 和 **孤立文件** 两个页签。
3. 选择诊断以打开来源；孤立文件筛选只改变当前视图，不改写保存的默认值。
4. 启动扫描默认关闭。打开侧栏会按需建立索引，也可在“常规”设置中使用 **建立索引** 或 **重建索引**。基线成功后，增量更新会自动保持结果最新。

## 设置

- **常规**：语言、启动扫描、结果分组和明确的建立/重建索引操作。语言默认选择 **跟随 Obsidian**。
- **无效链接**：诊断类别，以及带匹配预览的命名忽略规则。
- **孤立文件**：默认文件类型、可选的无入链分析、“显示预期孤立文件”、忽略规则和命名的预期孤立模式。
- 预期孤立规则可组合文件类型、精确或递归文件夹、日期格式、glob 和高级正则表达式；周期笔记预设支持可配置的日、周、月、季、年格式。

设置与用户规则保存在 `data.json`，派生链接图不会持久化。

## 限制

- 不删除文件、不改写链接，也不自动决定哪些文件可以清理。
- 外部 URL 明确不在范围内，插件不会通过网络请求它们。
- Bases 动态查询结果不算显式连接，只有显式文件引用才算。
- 预期孤立规则只影响孤立候选投影，不会隐藏无效链接，也不会移除文件对有效图的贡献。
- 自动测试通过不能替代真实 Obsidian 版本与设备验收。

## 隐私与安全

所有索引和规则计算都在本地运行。Link Integrity 不上传 Vault 内容、不要求账号、不修改笔记，也不持久化派生图。除非用户主动分享，诊断路径与样例只存在于当前 Obsidian 会话。

## 开发

使用 Node.js 24.19.0 和 npm 11.17.0。运行 `npm ci`，然后运行 `npm run check`。

常驻规范：

- 产品需求：[English](../product-requirements.en.md) · [简体中文](../product-requirements.zh-CN.md)
- UX 规范：[English](../ux-spec.en.md) · [简体中文](../ux-spec.zh-CN.md)
- 架构：[English](../architecture.en.md) · [简体中文](../architecture.zh-CN.md)
- 测试：[English](../testing-strategy.en.md) · [简体中文](../testing-strategy.zh-CN.md)
- 发布：[English](../release.en.md) · [简体中文](../release.zh-CN.md)

## 支持

可复现缺陷和明确的功能建议请使用 [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues)。不要在公开页面发布真实 Vault 路径、笔记内容、诊断样例或个人信息。

## 许可证

[MIT](../../LICENSE) © ZhengYX
