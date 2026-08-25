# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity 是完全本機、唯讀的 Obsidian 診斷外掛，用於 Broken links（無效連結）與 Isolated files（孤立檔案）。

## 介面截圖

在精簡的側邊欄中檢視無效連結與孤立檔案：

![Link Integrity 無效連結側邊欄](../assets/link-integrity-overview-en.png)

在 Obsidian 設定中配置索引、忽略規則、檔案類型與預期孤立模式：

## 功能特性

- 報告 Markdown、嵌入、Frontmatter、Canvas 與 Bases 明確檔案引用中的無效檔案、標題及區塊連結。
- 找出與其他現有 Vault 檔案既無有效入鏈也無有效出鏈的檔案；自我連結與外部 URL 不構成 Vault 連線。
- 含無效出鏈的孤立檔案會標記為低信心，不會顯示為高信心清理候選。
- 週期筆記、範本、封存等有意集合可列入選用的「預期孤立」投影，而不會偽造圖邊。
- 可依 Obsidian 檔案、圖片格式族、音訊、視訊、PDF 與自訂附件副檔名篩選。
- 必要時建立完整基線，之後以 Vault 與 Metadata Cache 增量更新自動維持結果。
- 選取診斷即可開啟來源；所有掃描、比對與索引都在本機完成。

Bases 動態查詢結果不算明確圖邊。若檔案已解析但標題或區塊缺失，檔案層級連線仍有效，並另行回報子路徑錯誤。

## 使用需求與相容性

- Obsidian 1.12.7 或更新版本。
- 支援桌面版與行動版 Obsidian。
- 僅診斷目前 Vault，不檢查外部網站或遠端資源。

## 安裝

開啟 **設定 → 第三方外掛 → 瀏覽**，搜尋 **Link Integrity** 並安裝。若目前目錄尚未顯示，可從[最新 GitHub 版本](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)下載 `link-integrity-<version>.zip`。

手動安裝時，將 `main.js`、`manifest.json` 與 `styles.css` 放入 `Vault/.obsidian/plugins/link-integrity/`，重新載入 Obsidian 並啟用外掛。升級只替換這三個檔案；除非要重設設定，否則保留 `data.json`。

## 使用

1. 在 **設定 → 第三方外掛** 啟用 Link Integrity。
2. 從功能區或命令面板開啟外掛；側邊欄包含 **無效連結** 與 **孤立檔案** 兩個頁籤。
3. 選取診斷以開啟來源；孤立檔案篩選只影響目前檢視，不改變已儲存預設值。
4. 啟動掃描預設關閉。開啟側邊欄會按需建立索引，也可在「一般」設定使用 **建立索引** 或 **重建索引**。基線成功後，增量更新會自動維持最新結果。

## 設定

- **一般**：語言、啟動掃描、結果分組與建立/重建索引。語言預設為 **跟隨 Obsidian**。
- **無效連結**：診斷類別與附帶比對預覽的命名忽略規則。
- **孤立檔案**：預設檔案類型、選用的無入鏈分析、「顯示預期孤立檔案」、忽略規則與命名的預期孤立模式。
- 預期孤立規則可組合檔案類型、精確或遞迴資料夾、日期格式、glob 與進階正規表示式；週期筆記預設支援日、週、月、季、年格式。

設定與使用者規則儲存在 `data.json`，衍生連結圖不會持久化。

## 限制

- 不刪除檔案、不重寫連結，也不自動決定可清理項目。
- 外部 URL 明確不在範圍內，外掛不會透過網路請求。
- Bases 動態查詢結果不算明確連線，只有明確檔案引用才算。
- 預期孤立規則只影響孤立候選投影，不會隱藏無效連結或移除檔案的有效圖貢獻。

## 隱私與安全

所有索引與規則計算都在本機執行。Link Integrity 不上傳 Vault 內容、不要求帳號、不修改筆記，也不持久化衍生圖。除非使用者主動分享，診斷路徑與樣例只存在目前 Obsidian 工作階段。

## 開發

使用 Node.js 24.19.0 與 npm 11.17.0。執行 `npm ci`，再執行 `npm run check`。

常駐規範：

- 產品需求：[English](../product-requirements.en.md) · [简体中文](../product-requirements.zh-CN.md)
- UX 規範：[English](../ux-spec.en.md) · [简体中文](../ux-spec.zh-CN.md)
- 架構：[English](../architecture.en.md) · [简体中文](../architecture.zh-CN.md)
- 測試：[English](../testing-strategy.en.md) · [简体中文](../testing-strategy.zh-CN.md)
- 發佈：[English](../release.en.md) · [简体中文](../release.zh-CN.md)

## 支援

可重現錯誤與明確功能建議請使用 [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues)。不要在公開頁面張貼真實 Vault 路徑、筆記內容、診斷樣例或個人資訊。

## 授權

[MIT](../../LICENSE) © ZhengYX
