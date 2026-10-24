# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Link Integrity 能找出筆記中指向不存在檔案、標題或區塊的連結，也能找出沒有連到其他檔案的筆記與附件。它只提供檢查結果，**不會修改連結或刪除檔案**。

## 介面截圖

在精簡的側邊欄中查看無效連結與孤立檔案：

![Link Integrity 無效連結側邊欄](../assets/link-integrity-overview-en.png)

![按資料夾分組的孤立檔案](../assets/link-integrity-isolated-en.png)

在 Obsidian 設定中管理索引、忽略規則、檔案類型與「預期孤立」規則：

![Link Integrity 設定](../assets/link-integrity-settings-en.png)

## 功能特性

- 可選擇在內文以警示色波浪線標示已確認缺失的檔案、標題與區塊。
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
- 支援桌面版與行動版 Obsidian。專案將桌面主機與 Android 模擬器分開驗收；Android 實體裝置及 iOS 不在正式驗收範圍內。
- 只檢查目前的 Vault，不檢查外部網站或遠端資源。

## 安裝

開啟 **設定 → 第三方外掛 → 瀏覽**，搜尋 **Link Integrity** 並安裝。若目前的外掛目錄中尚未顯示，可從[最新 GitHub 版本](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)下載 `link-integrity-<version>.zip`。

手動安裝時，將 `main.js`、`manifest.json` 與 `styles.css` 放入 `Vault/.obsidian/plugins/link-integrity/`，重新載入 Obsidian 並啟用外掛。升級時只替換這三個檔案；除非你明確要重設設定，否則保留 `data.json`。

## 使用

1. 在 **設定 → 第三方外掛** 中啟用 Link Integrity。
2. 從功能區或命令面板開啟 Link Integrity。側邊欄包含 **無效連結** 與 **孤立檔案** 兩個頁籤。
3. 選取結果即可開啟來源。孤立檔案篩選只影響目前畫面，不會修改已儲存的預設設定。
4. 啟動時掃描預設關閉。開啟側邊欄後會在需要時建立索引，也可以在「一般」設定中使用 **建立索引** 或 **重建索引**。首次建立成功後，Vault 中後續的變更會自動更新結果。

在**無效連結**設定中開啟**在內文中提示無效連結**，即可在閱讀和編輯時看到提示。此項預設關閉，不影響連結正常開啟。要查看問題原因並跳轉到來源，請從命令面板執行**診斷目前筆記的無效連結**。尚未更新完成或無法精確定位的連結不會標記，可在側邊欄繼續檢查。

## 設定

**使用指南**與**回報問題**位於**一般 → 說明與支援**。指南使用目前的介面語言。

例如 `A.md` 連到已存在的 `[[B]]`，即使沒有其他檔案連向 `A.md`，它仍不是孤立檔案。相反，只有 `[[Missing]]` 且沒有其他有效連結的檔案仍屬孤立，但應先檢查，不要直接刪除。

- **一般**：語言、啟動時掃描、預設結果畫面，以及建立/重建索引。語言預設為 **跟隨 Obsidian**。
- **無效連結**：選擇要顯示的問題類型，並可建立附帶符合預覽的命名忽略規則。
- **孤立檔案**：設定預設檔案類型、選用的「無入鏈檔案」畫面、預期孤立檔案、忽略規則與預期孤立規則。
- 預期孤立規則可組合檔案類型、單一資料夾或包含子資料夾的範圍、日期格式、glob 與進階正規表示式。週期筆記預設支援日、週、月、季、年命名格式。

**進階忽略規則注意：** 「預期孤立」與一般隱藏結果的規則不會改變檔案間的有效連結；但「從連結分析排除符合條件的連結（進階）」會使相關連結不再計入連結數，原本有連結的檔案也可能顯示為孤立。請先檢查符合預覽。

設定與使用者規則儲存在 `data.json`。計算得到的連結索引只保存在記憶體中，重新啟動後會重新建立。

展開現有忽略規則，或選擇**新增忽略規則**。設定**作用範圍**、**比對方式**和**比對內容**後，按**預覽**，核對符合數量、範例及涉及的檔案和連接數，再按**儲存**。儲存前，修改只保留在草稿中；**取消**會放棄修改。修改規則或索引更新後，需要重新預覽。若沒有可用的最新索引，請先在**一般**中建立索引。停用的規則也能預覽，結果表示啟用後可能影響的範圍。

## 限制

- Link Integrity 不刪除檔案或改寫筆記連結。不確定或閱讀映射有歧義的內文不標色；可用側欄查看更廣泛的診斷。
- 外部 URL 明確不在檢查範圍內，外掛不會透過網路請求它們。
- Bases 動態查詢結果不算直接檔案連線，只有明確寫出的檔案參照才算。
- 預期孤立規則只改變已經屬於孤立檔案的分類，不會隱藏無效連結，也不會移除真實的檔案連線。

## 隱私與安全

索引完全在本機執行。Link Integrity 不上傳 Vault 內容、不需要帳號、不修改筆記內文。派生索引只保留在記憶體。

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
