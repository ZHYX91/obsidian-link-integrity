# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity 是完全本機、唯讀的 Obsidian 診斷外掛，用於 Broken links（無效連結）與 Isolated files（孤立檔案）。

## 可以找出什麼

- Markdown、Frontmatter、Canvas 與 Bases 明確引用中的無效檔案、標題和區塊連結。
- 與其他現有 Vault 檔案既無有效入鏈也無有效出鏈的孤立檔案。
- 含無效出鏈的低信心結果，以及可選擇顯示的「預期孤立」檔案。

## 安裝

首個公開版本尚未發佈。僅在隔離開發 Vault 中，把 `dist/` 的三個執行檔複製到 `.obsidian/plugins/link-integrity/`。升級會保留 `data.json`。

## 隱私與資料

所有索引都在本機執行，不傳送 Vault 內容、不檢查外部 URL、不修改筆記，也不保存衍生圖。

## 相容性

需要 Obsidian 1.12.7 或更新版本，支援桌面與行動裝置。

## 狀態

目前正進行首次本機實作，尚未發佈或上架。
