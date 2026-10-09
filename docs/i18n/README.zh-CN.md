# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity 是完全本地、只读的 Obsidian 插件，用来查找 Broken links（无效链接）和 Isolated files（孤立文件）。

## 界面截图

在一个紧凑的侧栏中查看无效链接和孤立文件：

![Link Integrity 无效链接侧栏](../assets/link-integrity-overview-en.png)

![按文件夹分组的孤立文件](../assets/link-integrity-isolated-en.png)

在 Obsidian 设置中管理索引、忽略规则、文件类型和“预期孤立”规则：

![Link Integrity 设置](../assets/link-integrity-settings-en.png)

## 功能特性

- 查找 Markdown、嵌入、Frontmatter、Canvas 和 Bases 显式文件引用中指向不存在文件、标题或块的内部链接。
- 找出与其他现有 Vault 文件没有有效入链、也没有有效出链的文件。自链接和外部 URL 不算 Vault 内部连接。
- 如果孤立文件本身还包含无效出链，会额外提醒，避免把它误当成明显可以清理的文件。
- 可以把周期笔记、模板、归档等本来就可能独立存在的文件标记为“预期孤立”。这只改变结果中的分类，不会改变文件之间真实的链接关系。
- 可按 Obsidian 文件、图片格式、音频、视频、PDF 和自定义附件扩展名筛选孤立文件。
- 需要时建立完整索引，之后随着 Vault 变化自动更新，日常使用不需要手动刷新。
- 选择结果即可打开来源；能精确定位时会跳到对应位置。扫描、匹配和索引都只在本地进行。

Bases 动态查询得到的文件不会自动算作链接。如果目标文件存在、但标题或块不存在，Link Integrity 仍会认为两个文件之间存在连接，并另外报告缺失的标题或块。

## 使用要求与兼容性

- Obsidian 1.12.7 或更高版本。
- 支持桌面版和移动版 Obsidian。
- 只检查当前 Vault，不检查外部网站或远程资源。

## 安装

打开 **设置 → 第三方插件 → 浏览**，搜索 **Link Integrity** 并安装。如果当前插件目录中还没有，可从[最新 GitHub 版本](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)下载 `link-integrity-<version>.zip`。

手动安装时，把 `main.js`、`manifest.json` 和 `styles.css` 放入 `Vault/.obsidian/plugins/link-integrity/`，重新加载 Obsidian 并启用插件。升级时只替换这三个文件；除非你明确想重置设置，否则保留 `data.json`。

## 使用

1. 在 **设置 → 第三方插件** 中启用 Link Integrity。
2. 从功能区或命令面板打开 Link Integrity。侧栏包含 **无效链接** 和 **孤立文件** 两个页签。
3. 选择结果即可打开来源。孤立文件筛选只影响当前视图，不会改动已保存的默认设置。
4. 启动时扫描默认关闭。打开侧栏后会在需要时建立索引，也可以在“常规”设置中使用 **建立索引** 或 **重建索引**。首次建立成功后，Vault 中的后续变化会自动更新结果。

## 设置

**如何判断“孤立”？** 这里统计的是与 Vault 中**真实存在文件之间的有效连接**，不能只看有没有入链：

- **真正孤立：** `A.md` 不引用任何其他已存在文件，也没有其他文件引用它。指向自身的链接与外部网址都不算有效连接。
- **无入链，但不孤立：** `B.md` 已存在，`A.md` 包含 `[[B]]`。即使没人链接到 `A.md`，它仍通过出链与 `B.md` 相连。可用可选的**无入链文件**高级筛选查看这种情况；默认孤立列表不会把它当成真正孤立。
- **孤立且包含无效链接：** `A.md` 只有 `[[Missing]]`，目标文件不存在，且没有其他文件链接到 `A.md`。由于没有有效连接，它仍属于孤立；但会显示无效链接警告，**不能**因此认为可以安全删除。
- **预期孤立：** 独立的模板或归档可以标记为**预期孤立**；它仍是原来的文件，只是从主要孤立数量中单独分类，插件不会自动删除或修复。

- **常规**：语言、启动时扫描、默认结果视图，以及建立/重建索引。语言默认 **跟随 Obsidian**。
- **无效链接**：选择要显示的问题类型，并可创建带匹配预览的命名忽略规则。
- **孤立文件**：设置默认文件类型、可选的“无入链文件”视图、预期孤立文件、忽略规则和预期孤立规则。
- 预期孤立规则可以组合文件类型、单个文件夹或包含子文件夹的范围、日期格式、glob 和高级正则表达式。周期笔记预设支持日、周、月、季、年命名格式。

设置和用户规则保存在 `data.json`。计算得到的链接索引只保存在内存中，重启后会重新建立。

## 限制

- 不删除文件、不改写链接，也不会自动判断哪些文件应该删除。
- 外部 URL 明确不在检查范围内，插件不会通过网络请求它们。
- Bases 动态查询结果不算直接文件连接，只有明确写出的文件引用才算。
- 预期孤立规则只改变已经属于孤立文件的分类，不会隐藏无效链接，也不会删除真实的文件连接。

## 隐私与安全

所有索引和规则计算都在本地完成。Link Integrity 不上传 Vault 内容、不要求账号，也不修改笔记。除非你主动分享，诊断路径和样例只存在于当前 Obsidian 会话中。

## 开发

使用 Node.js 24.19.0 和 npm 11.17.0。运行 `npm ci`，然后运行 `npm run check`。

开发文档：

- 产品需求：[English](../product-requirements.en.md) · [简体中文](../product-requirements.zh-CN.md)
- UX 规范：[English](../ux-spec.en.md) · [简体中文](../ux-spec.zh-CN.md)
- 架构：[English](../architecture.en.md) · [简体中文](../architecture.zh-CN.md)
- 测试：[English](../testing-strategy.en.md) · [简体中文](../testing-strategy.zh-CN.md)

## 支持

- [Q&A](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/q-a)：使用和配置问题。
- [Ideas](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/ideas)：还在讨论阶段的功能和工作流想法。
- [Show and tell](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/show-and-tell)：使用技巧、工作流和参考示例。

可复现的缺陷和明确的功能建议请使用 [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues/new/choose)。不要在公开页面发布真实 Vault 路径、笔记内容、诊断样例或个人信息。

## 许可证

[MIT](../../LICENSE) © ZhengYX
