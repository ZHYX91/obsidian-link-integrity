# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity は、Broken links と Isolated files を見つけるための、ローカルで動作する読み取り専用の Obsidian プラグインです。

## スクリーンショット

壊れたリンクと孤立ファイルを、コンパクトなサイドバーで確認できます。

![Link Integrity サイドバー](../assets/link-integrity-overview-en.png)

![フォルダー別の孤立ファイル](../assets/link-integrity-isolated-en.png)

Obsidian の設定から、インデックス、除外ルール、ファイル形式、「想定内の孤立」ルールを管理できます。

![Link Integrity の設定](../assets/link-integrity-settings-en.png)

## 機能

- Markdown、埋め込み、Frontmatter、Canvas、Bases の明示的なファイル参照から、存在しないファイル・見出し・ブロックへの内部リンクを検出します。
- ほかの既存 Vault ファイルとの有効な入出力リンクがないファイルを見つけます。自己リンクと外部 URL は Vault 内の接続として数えません。
- 孤立ファイルに壊れた外向きリンクが含まれている場合は別途知らせるため、「明らかに削除してよいファイル」と誤解しにくくなります。
- 定期ノート、テンプレート、アーカイブなど、意図的に単独で存在するファイルを Expected isolated として扱えます。変わるのは結果上の分類だけで、実際のリンク関係は変わりません。
- Obsidian ファイル、画像形式、音声、動画、PDF、設定した添付ファイル拡張子で孤立ファイルを絞り込めます。
- 必要なときに完全なインデックスを作成し、その後は Vault の変更に合わせて自動更新します。
- 正確な位置が分かる場合は、結果から該当箇所を開けます。スキャン、照合、インデックス作成はすべてローカルで行われます。

Bases の動的クエリ結果は、自動的にリンクとして扱いません。対象ファイルが存在していて見出しやブロックだけがない場合は、ファイル同士の接続は保ったまま、不足している見出しやブロックを別の問題として表示します。

## 要件と互換性

- Obsidian 1.12.7 以降。
- デスクトップ版とモバイル版の Obsidian に対応します。
- 現在の Vault だけを確認します。外部 Web サイトやリモートリソースは検査しません。

## インストール

**設定 → コミュニティプラグイン → 閲覧** を開き、**Link Integrity** を検索してインストールします。カタログにまだ表示されない場合は、[最新の GitHub リリース](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)から `link-integrity-<version>.zip` をダウンロードしてください。

手動では `main.js`、`manifest.json`、`styles.css` を `Vault/.obsidian/plugins/link-integrity/` に配置します。更新時はこの 3 ファイルだけを置き換え、設定をリセットする場合を除いて `data.json` は残してください。

## 使い方

1. コミュニティプラグインで Link Integrity を有効にします。
2. リボンまたはコマンドパレットから Link Integrity を開きます。サイドバーには **Broken links** と **Isolated files** があります。
3. 結果を選ぶと元のファイルを開けます。孤立ファイルのフィルターは現在の表示だけに作用し、保存済みの既定値は変更しません。
4. 起動時スキャンは既定で無効です。サイドバーを開くと必要に応じてインデックスを作成します。一般設定の **インデックスを構築** または **再構築** も使用できます。最初の構築に成功した後は、Vault の変更に合わせて結果が自動更新されます。

## 設定

- **一般**：言語、起動時スキャン、既定の表示、インデックスの作成・再構築。既定言語は **Obsidian に従う** です。
- **Broken links**：表示する問題の種類と、該当件数を確認できる名前付き除外ルール。
- **Isolated files**：既定のファイル形式、任意の「入リンクなし」表示、Expected isolated、除外ルール、想定内の孤立ルール。
- 想定内の孤立ルールでは、ファイル形式、単一フォルダーまたはサブフォルダーを含む範囲、日付形式、glob、上級者向け正規表現を組み合わせられます。定期ノートのプリセットは日・週・月・四半期・年に対応します。

設定とユーザー定義ルールは `data.json` に保存されます。計算したリンクインデックスはメモリ上だけに保持し、再起動後に作り直します。

## 制限

- Link Integrity はファイルを削除せず、リンクを書き換えず、削除すべきファイルを自動判断しません。
- 外部 URL は意図的に対象外で、ネットワーク経由の確認は行いません。
- Bases の動的クエリ結果は直接のファイル接続として数えません。明示的なファイル参照だけを数えます。
- 想定内の孤立ルールは、すでに孤立しているファイルの分類だけを変えます。壊れたリンクを隠したり、実際のファイル接続を消したりはしません。

## プライバシーとセキュリティ

インデックス作成とルール判定はすべてローカルで行われます。Link Integrity は Vault の内容をアップロードせず、アカウントを要求せず、ノートも変更しません。診断のパスや例は、ユーザー自身が共有しない限り現在の Obsidian セッション内に留まります。

## 開発

Node.js 24.19.0 と npm 11.17.0 を使用し、`npm ci` の後に `npm run check` を実行します。

開発者向け資料：[製品](../product-requirements.en.md)、[UX](../ux-spec.en.md)、[アーキテクチャ](../architecture.en.md)、[テスト](../testing-strategy.en.md)。対応する中国語の原文は同じフォルダーにあります。

## サポート

- [Q&A](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/q-a)：使用方法や設定に関する質問。
- [Ideas](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/ideas)：検討中の機能やワークフローのアイデア。
- [Show and tell](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/show-and-tell)：使い方のヒント、ワークフロー、参考例。

再現可能な不具合や具体的な提案は [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues/new/choose) へ報告してください。非公開の Vault パス、ノート内容、診断例、個人情報は投稿しないでください。

## ライセンス

[MIT](../../LICENSE) © ZhengYX
