# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity は Broken links と Isolated files を検出する、ローカル専用・読み取り専用の Obsidian 診断プラグインです。

## スクリーンショット

コンパクトなサイドバーで壊れたリンクと孤立ファイルを確認できます。

![Link Integrity サイドバー](../assets/link-integrity-overview-en.png)

Obsidian の設定でインデックス、除外ルール、ファイル形式、想定された孤立を構成できます。

![Link Integrity 設定](../assets/link-integrity-settings-en.png)

## 機能

- Markdown、埋め込み、Frontmatter、Canvas、Bases の明示的ファイル参照にある壊れたファイル・見出し・ブロックリンクを報告します。
- 別の既存 Vault ファイルとの有効な入出力接続がないファイルを検出します。自己リンクと外部 URL は接続になりません。
- 壊れた出力リンクを含む孤立ファイルは、信頼度の低い候補として表示します。
- 定期ノート、テンプレート、アーカイブを、架空のグラフ辺を作らずに Expected isolated として任意表示します。
- Obsidian ファイル、画像形式、音声、動画、PDF、設定した添付拡張子で絞り込めます。
- 必要に応じて完全な基準を構築し、その後は増分更新で結果を維持します。
- 各診断からソースを開けます。解析と索引はすべてローカルです。

Bases の動的クエリ結果は明示的な辺ではありません。ファイルは解決して見出しやブロックだけが欠ける場合、ファイル接続は維持され、サブパス診断が別に表示されます。

## 要件と互換性

- Obsidian 1.12.7 以降。
- デスクトップとモバイル向けです。実際のホストや端末はそれぞれ独立した受け入れ境界です。
- 現在の Vault だけを診断し、外部 Web は検査しません。

## インストール

コミュニティディレクトリで承認された後は、**設定 → コミュニティプラグイン → 閲覧** からインストールできます。[最新の GitHub リリース](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)から `link-integrity-<version>.zip` をダウンロードすることもできます。

手動では `main.js`、`manifest.json`、`styles.css` を `Vault/.obsidian/plugins/link-integrity/` に配置します。更新時はこの 3 ファイルだけを置き換え、設定をリセットしない限り `data.json` を保持してください。

## 使い方

1. コミュニティプラグインで Link Integrity を有効にします。
2. リボンまたはコマンドパレットからサイドバーを開き、**Broken links** と **Isolated files** を切り替えます。
3. 診断を選ぶとソースが開きます。フィルターは現在の表示だけを変更します。
4. 起動時スキャンが無効、または基準構築が失敗した場合は、一般設定の **インデックスを構築** または **再構築** を使用します。その後は増分更新で自動的に最新状態を保ちます。

## 設定

- **一般**：言語、起動時スキャン、グループ化、インデックス構築操作。既定言語は **Obsidian に従う** です。
- **Broken links**：診断カテゴリと、プレビュー付きの名前付き除外ルール。
- **Isolated files**：既定ファイル形式、任意の入リンクなし分析、Expected isolated の表示、各種ルール。
- 想定された孤立ルールは、形式、完全一致または再帰フォルダー、日付形式、glob、正規表現を組み合わせられます。定期ノートプリセットは日・週・月・四半期・年に対応します。

設定とルールは `data.json` に保存されます。派生リンクグラフは永続化されません。

## 制限

- ファイル削除やリンクの自動書き換えは行いません。
- 外部 URL をネットワーク経由で検査しません。
- Bases の動的クエリは明示的接続として数えません。
- Expected isolated ルールは候補表示だけに影響し、壊れたリンクを隠しません。
- 自動テストは実際の Obsidian バージョンや端末での確認を置き換えません。

## プライバシーとセキュリティ

処理はすべてローカルです。Link Integrity は Vault 内容をアップロードせず、アカウントを要求せず、ノートを変更せず、派生グラフを保存しません。

## 開発

Node.js 24.18.0 と npm 11.16.0 を使用し、`npm ci` の後に `npm run check` を実行します。

安定した契約：[製品](../product.en.md)、[UX](../ux.en.md)、[アーキテクチャ](../architecture.en.md)、[テスト](../testing-strategy.en.md)、[リリース](../release.en.md)。対応する中国語ソースは同じフォルダーにあります。

## サポート

再現可能な不具合や具体的な提案は [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues) へ報告してください。非公開の Vault パス、ノート内容、診断例は投稿しないでください。

## ライセンス

[MIT](../../LICENSE) © ZhengYX
