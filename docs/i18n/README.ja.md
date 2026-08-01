# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity は Broken links と Isolated files を検出する、ローカル専用・読み取り専用の Obsidian 診断プラグインです。

## 検出内容

無効な内部参照、孤立ファイル、信頼度の低い結果、必要に応じて「孤立が想定される」ファイルを表示します。自己リンク、外部 URL、Bases の動的クエリはグラフの辺になりません。

## インストール

最初の公開版は未リリースです。隔離した開発用 Vault で `main.js`、`manifest.json`、`styles.css` を `.obsidian/plugins/link-integrity/` にコピーしてください。更新時も `data.json` は保持されます。

## プライバシーとデータ

処理はすべてローカルです。Vault の内容を送信・変更せず、外部 URL を検査せず、派生グラフを永続化しません。

## 互換性

Obsidian 1.12.7 以降が必要で、デスクトップとモバイルを対象とします。

## 状況

初期ローカル実装中で、公開・タグ付け・マーケット掲載はまだ行われていません。
