# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity 是完全本機、唯讀的 Obsidian 外掛，用來找出 Broken links（無效連結）和 Isolated files（孤立檔案）。

## 介面截圖

在精簡的側邊欄中查看無效連結與孤立檔案：

![Link Integrity 無效連結側邊欄](../assets/link-integrity-overview-en.png)

![按資料夾分組的孤立檔案](../assets/link-integrity-isolated-en.png)

在 Obsidian 設定中管理索引、忽略規則、檔案類型與「預期孤立」規則：

![Link Integrity 設定](../assets/link-integrity-settings-en.png)

## 功能特性

- 找出 Markdown、嵌入、Frontmatter、Canvas 與 Bases 明確檔案參照中，指向不存在檔案、標題或區塊的內部連結。
- 找出與其他現有 Vault 檔案沒有有效連入、也沒有有效連出的檔案。自我連結與外部 URL 不算 Vault 內部連線。
- 如果孤立檔案本身還含有無效連結，會另外提示，避免把它誤認為明顯可以清理的檔案。
- 可將週期筆記、範本、封存等本來就可能獨立存在的檔案標記為「預期孤立」。這只會改變結果中的分類，不會改變檔案之間真正的連結關係。
- 可依 Obsidian 檔案、圖片格式、音訊、視訊、PDF 與自訂附件副檔名篩選孤立檔案。
- 需要時建立完整索引，之後會隨 Vault 變更自動更新，日常使用不需要手動重新整理。
- 選取結果即可開啟來源；能精確定位時會跳到對應位置。掃描、比對與索引都只在本機進行。

Bases 動態查詢得到的檔案不會自動算成連結。如果目標檔案存在，但標題或區塊不存在，Link Integrity 仍會把兩個檔案視為有連線，並另外回報缺少的標題或區塊。

## 使用需求與相容性

- Obsidian 1.12.7 或更新版本。
- 支援桌面版與行動版 Obsidian。
- 只檢查目前的 Vault，不檢查外部網站或遠端資源。

## 安裝

開啟 **設定 → 第三方外掛 → 瀏覽**，搜尋 **Link Integrity** 並安裝。若目前的外掛目錄中尚未顯示，可從[最新 GitHub 版本](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)下載 `link-integrity-<version>.zip`。

手動安裝時，將 `main.js`、`manifest.json` 與 `styles.css` 放入 `Vault/.obsidian/plugins/link-integrity/`，重新載入 Obsidian 並啟用外掛。升級時只替換這三個檔案；除非你明確要重設設定，否則保留 `data.json`。

## 使用

1. 在 **設定 → 第三方外掛** 中啟用 Link Integrity。
2. 從功能區或命令面板開啟 Link Integrity。側邊欄包含 **無效連結** 與 **孤立檔案** 兩個頁籤。
3. 選取結果即可開啟來源。孤立檔案篩選只影響目前畫面，不會修改已儲存的預設設定。
4. 啟動時掃描預設關閉。開啟側邊欄後會在需要時建立索引，也可以在「一般」設定中使用 **建立索引** 或 **重建索引**。首次建立成功後，Vault 中後續的變更會自動更新結果。

## 設定

- **一般**：語言、啟動時掃描、預設結果畫面，以及建立/重建索引。語言預設為 **跟隨 Obsidian**。
- **無效連結**：選擇要顯示的問題類型，並可建立附帶符合預覽的命名忽略規則。
- **孤立檔案**：設定預設檔案類型、選用的「無入鏈檔案」畫面、預期孤立檔案、忽略規則與預期孤立規則。
- 預期孤立規則可組合檔案類型、單一資料夾或包含子資料夾的範圍、日期格式、glob 與進階正規表示式。週期筆記預設支援日、週、月、季、年命名格式。

設定與使用者規則儲存在 `data.json`。計算得到的連結索引只保存在記憶體中，重新啟動後會重新建立。

## 限制

- 不刪除檔案、不重寫連結，也不會自動判斷哪些檔案應該刪除。
- 外部 URL 明確不在檢查範圍內，外掛不會透過網路請求它們。
- Bases 動態查詢結果不算直接檔案連線，只有明確寫出的檔案參照才算。
- 預期孤立規則只改變已經屬於孤立檔案的分類，不會隱藏無效連結，也不會移除真實的檔案連線。

## 隱私與安全

所有索引與規則計算都在本機完成。Link Integrity 不上傳 Vault 內容、不要求帳號，也不修改筆記。除非你主動分享，診斷路徑與範例只存在目前的 Obsidian 工作階段。

## 開發

使用 Node.js 24.19.0 與 npm 11.17.0。執行 `npm ci`，再執行 `npm run check`。

開發文件：

- 產品需求：[English](../product-requirements.en.md) · [简体中文](../product-requirements.zh-CN.md)
- UX 規範：[English](../ux-spec.en.md) · [简体中文](../ux-spec.zh-CN.md)
- 架構：[English](../architecture.en.md) · [简体中文](../architecture.zh-CN.md)
- 測試：[English](../testing-strategy.en.md) · [简体中文](../testing-strategy.zh-CN.md)

## 支援

- [Q&A](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/q-a)：使用與設定問題。
- [Ideas](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/ideas)：仍在討論階段的功能與工作流程想法。
- [Show and tell](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/show-and-tell)：使用技巧、工作流程與參考範例。

可重現的錯誤與明確功能建議請使用 [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues/new/choose)。不要在公開頁面張貼真實 Vault 路徑、筆記內容、診斷範例或個人資訊。

## 授權

[MIT](../../LICENSE) © ZhengYX
