# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity 是完全本地、只读的 Obsidian 诊断插件，用于查找 Broken links（无效链接）和 Isolated files（孤立文件）。

## 可以发现什么

- Markdown、Frontmatter、Canvas 与 Bases 显式引用中的无效文件、标题和块链接。
- 与其他现有 Vault 文件既无有效入链也无有效出链的孤立文件。
- 含无效出链的低置信度孤立文件，以及可按需显示的“预期孤立”文件。

自链接、外部 URL 和 Bases 动态查询结果不构成显式图边；周期笔记规则也不会伪造日期邻接边。

## 安装

首个公开版本尚未发布。仅在隔离开发 Vault 中，将 `dist/` 的 `main.js`、`manifest.json`、`styles.css` 复制到 `.obsidian/plugins/link-integrity/` 并启用插件。升级只替换这三项并保留 `data.json`。

## 隐私与数据

所有索引和规则均在本地运行。插件不发送 Vault 内容、不检查外部 URL、不修改笔记，也不持久化派生图；`data.json` 仅保存规范化设置、界面偏好和用户规则。

## 兼容性

要求 Obsidian 1.12.7 或更高版本，面向桌面端与移动端。自动门禁、隔离桌面 Vault、Android 模拟器和物理设备属于不同验收边界。

## 状态

仓库正在进行首次本地实现，尚未发布、打标签或提交社区插件市场。
