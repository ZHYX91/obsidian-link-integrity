# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Link Integrity 帮你找出笔记中指向不存在文件、标题或块的链接，也能找出没有与其他文件建立有效连接的笔记和附件。它只显示检查结果，**不会修改链接或删除文件**。

## 界面截图

在一个紧凑的侧栏中查看无效链接和孤立文件：

![Link Integrity 无效链接侧栏](../assets/link-integrity-overview-en.png)

![按文件夹分组的孤立文件](../assets/link-integrity-isolated-en.png)

在 Obsidian 设置中管理索引、忽略规则、文件类型和“预期孤立”规则：

![Link Integrity 设置](../assets/link-integrity-settings-en.png)

## 功能特性

- 可选择在正文中用警示色波浪线标出已确认缺失的文件、标题和块。
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
- 支持桌面版和移动版 Obsidian。项目将桌面主机验收与 Android 模拟器验收分开；Android 实体设备和 iOS 不在正式验收范围内。
- 只检查当前 Vault，不检查外部网站或远程资源。

## 安装

打开 **设置 → 第三方插件 → 浏览**，搜索 **Link Integrity** 并安装。如果当前插件目录中还没有，可从[最新 GitHub 版本](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)下载 `link-integrity-<version>.zip`。

手动安装时，把 `main.js`、`manifest.json` 和 `styles.css` 放入 `Vault/.obsidian/plugins/link-integrity/`，重新加载 Obsidian 并启用插件。升级时只替换这三个文件；除非你明确想重置设置，否则保留 `data.json`。

## 使用

1. 在 **设置 → 第三方插件** 中启用 Link Integrity。
2. 从功能区或命令面板打开 Link Integrity。侧栏包含 **无效链接** 和 **孤立文件** 两个页签。
3. 选择结果即可打开来源。孤立文件筛选只影响当前视图，不会改动已保存的默认设置。
4. 启动时扫描默认关闭。打开侧栏后会在需要时建立索引，也可以在“常规”设置中使用 **建立索引** 或 **重建索引**。首次建立成功后，Vault 中的后续变化会自动更新结果。

在**无效链接**设置中开启**在正文中提示无效链接**，即可在阅读和编辑时看到提示。此项默认关闭，不影响链接的正常打开。要查看问题原因并跳转到来源，请从命令面板运行**诊断当前笔记的无效链接**。尚未更新完成或无法精确定位的链接不会标记，可在侧栏继续检查。

## 设置

**使用指南**和**报告问题**位于**常规 → 帮助与支持**。指南使用当前界面语言。

**孤立文件的判定依据是现有 Vault 文件之间的有效连接：**

- **真正孤立：** `A.md` 不引用任何其他已存在文件，也没有其他文件引用它。指向自身的链接与外部网址都不算有效连接。
- **无入链，但不孤立：** `B.md` 已存在，`A.md` 包含 `[[B]]`。即使没人链接到 `A.md`，它仍通过出链与 `B.md` 相连。可用可选的**无入链文件**高级筛选查看这种情况；默认孤立列表不会把它当成真正孤立。
- **孤立且包含无效链接：** `A.md` 只有 `[[Missing]]`，目标文件不存在，且没有其他文件链接到 `A.md`。由于没有有效连接，它仍属于孤立；但会显示无效链接警告，**请先检查，不要因为它被标为孤立就直接删除**。
- **预期孤立：** 独立的模板或归档可以标记为**预期孤立**；它仍是原来的文件，只是从主要孤立数量中单独分类，插件不会自动删除或修复。

- **常规**：语言、启动时扫描、默认结果视图，以及建立/重建索引。语言默认 **跟随 Obsidian**。
- **无效链接**：选择要显示的问题类型，并可创建带匹配预览的命名忽略规则。
- **孤立文件**：设置默认文件类型、可选的“无入链文件”视图、预期孤立文件、忽略规则和预期孤立规则。
- 预期孤立规则可以组合文件类型、单个文件夹或包含子文件夹的范围、日期格式、glob 和高级正则表达式。周期笔记预设支持日、周、月、季、年命名格式。

**高级忽略规则提醒：** **预期孤立**和普通的结果隐藏规则不改变文件间连接。但**从连接分析中排除匹配链接（高级）**会让这些链接不再参与连接统计，原本有有效连接的文件也可能显示为孤立。启用前请预览匹配范围，确认确实要排除这些连接。

你的设置和规则保存在 `data.json`。扫描结果只保留在本次 Obsidian 运行期间，需要时会重新扫描。

展开现有忽略规则，或选择**添加忽略规则**。设置**作用范围**、**匹配方式**和**匹配内容**后，点击**预览**，核对匹配数量、样例以及涉及的文件和连接数，再点击**保存**。保存前，修改只保留在草稿中；**取消**会放弃修改。修改规则或索引更新后，需要重新预览。若没有可用的最新索引，请先在**常规**中建立索引。停用的规则也能预览，结果表示启用后可能影响的范围。

## 限制

- Link Integrity 不删除文件或改写笔记链接。无法确定位置的链接暂不显示提示；可用侧栏查看更广泛的诊断。
- 外部 URL 明确不在检查范围内，插件不会通过网络请求它们。
- Bases 动态查询结果不算直接文件连接，只有明确写出的文件引用才算。
- 预期孤立规则只改变已经属于孤立文件的分类，不会隐藏无效链接，也不会删除真实的文件连接。

## 隐私与安全

索引完全在本地执行。Link Integrity 不上传 Vault 内容、不需要账户、不修改笔记正文。派生索引只保留在内存。

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
