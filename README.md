# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity is a local, read-only Obsidian diagnostic plugin for Broken links and Isolated files.

## What it finds

- Broken internal file, heading, and block references from Markdown, frontmatter, Canvas, and explicit Bases references.
- Isolated files with no valid incoming or outgoing connection to another existing Vault file.
- Low-confidence isolated files that contain broken outgoing links.
- Expected isolated files, such as periodic notes or templates, in a separate optional projection without inventing graph edges.

Self-links and external URLs do not connect files. Dynamic Bases query results are not explicit edges. A resolved file with a missing heading or block still contributes a file-level edge and receives a separate subpath diagnostic.

## Install

The first public release has not been published yet. For an isolated development Vault, copy `main.js`, `manifest.json`, and `styles.css` from `dist/` into `.obsidian/plugins/link-integrity/`, then enable Link Integrity. Upgrades replace only those three files and preserve `data.json`.

## Privacy and data

All indexing and rules run locally. Link Integrity does not send Vault content anywhere, check external URLs, modify notes, or persist the derived graph. `data.json` contains normalized settings, UI preferences, and user-defined rules only.

## Compatibility

Obsidian 1.12.7 or later is required. The plugin is designed for desktop and mobile. Automated checks, an isolated desktop Vault, an Android emulator, and a physical device are separate acceptance boundaries.

## Status

This repository is under initial local implementation. It is not yet published, tagged, or listed in the community plugin market.

## Development

Use Node.js 24.18.0 and npm 11.16.0. Run `npm ci`, then `npm run check`.

Stable contracts:

- Product: [English](docs/product.en.md) · [简体中文](docs/product.zh-CN.md)
- UX: [English](docs/ux.en.md) · [简体中文](docs/ux.zh-CN.md)
- Architecture: [English](docs/architecture.en.md) · [简体中文](docs/architecture.zh-CN.md)
- Testing: [English](docs/testing-strategy.en.md) · [简体中文](docs/testing-strategy.zh-CN.md)
- Release: [English](docs/release.en.md) · [简体中文](docs/release.zh-CN.md)
