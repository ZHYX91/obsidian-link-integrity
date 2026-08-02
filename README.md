# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity is a local, read-only Obsidian diagnostic plugin for Broken links and Isolated files.

## Screenshots

Review broken links and isolated files from one compact sidebar:

![Link Integrity sidebar with broken-link diagnostics](https://raw.githubusercontent.com/ZHYX91/obsidian-link-integrity/main/docs/assets/link-integrity-overview-en.png)

Configure indexing, ignore rules, file types, and expected-isolation patterns in Obsidian settings:

![Link Integrity isolated-file settings](https://raw.githubusercontent.com/ZHYX91/obsidian-link-integrity/main/docs/assets/link-integrity-settings-en.png)

## Features

- Reports broken internal file, heading, and block references from Markdown, embeds, frontmatter, Canvas, and explicit Bases file references.
- Finds files with no valid incoming or outgoing connection to another existing Vault file. Self-links and external URLs do not create Vault connections.
- Marks an isolated file that contains broken outgoing links as lower confidence instead of presenting it as a high-confidence cleanup candidate.
- Keeps periodic notes, templates, archives, and other intentional collections in an optional Expected isolated projection without inventing graph edges.
- Filters isolated candidates by Obsidian files, images and format families, audio, video, PDF, and configured attachment extensions.
- Rebuilds a complete baseline when needed, then applies incremental Vault and Metadata Cache updates without a routine manual refresh.
- Opens every diagnostic at its source and keeps all scanning, matching, and indexing local.

Dynamic Bases query results are not explicit edges. A resolved file with a missing heading or block still contributes a file-level edge and receives a separate subpath diagnostic.

## Requirements and compatibility

- Obsidian 1.12.7 or later.
- Designed for desktop and mobile; host-specific behavior still requires separate desktop, emulator, and physical-device acceptance.
- The plugin diagnoses the current Vault only. It does not check external websites or remote resources.

## Installation

The initial public release is awaiting final acceptance. Once published, install Link Integrity from **Settings → Community plugins → Browse** or download `link-integrity-<version>.zip` from the [latest release](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest).

For a manual installation, place `main.js`, `manifest.json`, and `styles.css` in `Vault/.obsidian/plugins/link-integrity/`, reload Obsidian, and enable Link Integrity. During upgrades, replace only those three files and preserve `data.json` unless you explicitly want to reset the plugin settings.

## Usage

1. Enable Link Integrity under **Settings → Community plugins**.
2. Open Link Integrity from the ribbon or the command palette. The sidebar starts with **Broken links** and **Isolated files** tabs.
3. Select a diagnostic to open its source. Use the isolated-file filters to narrow the current view without changing saved defaults.
4. If startup scanning is disabled or the baseline failed, use **Build index** or **Rebuild index** in General settings. After a successful baseline, incremental updates keep results current automatically.

## Settings

- **General** controls language, startup scanning, result grouping, and the explicit Build/Rebuild index action. **Follow Obsidian** is the default language choice.
- **Broken links** controls diagnostic categories and named ignore rules with match previews.
- **Isolated files** controls default file types, optional no-incoming analysis, visibility of Expected isolated files, ignore rules, and named expected-isolation patterns.
- Expected-isolation rules can combine file type, exact or recursive folder scope, date format, glob, and advanced regular expressions. The periodic-notes preset supports configurable daily, weekly, monthly, quarterly, and yearly naming patterns.

Settings and user-defined rules are stored in `data.json`. The derived link graph is not persisted.

## Limitations

- Link Integrity does not delete files, rewrite links, or make automatic cleanup decisions.
- External URLs are deliberately out of scope and are not requested over the network.
- Dynamic Bases query results do not count as explicit connections; only explicit file references do.
- Expected-isolation rules affect the isolated-candidate projection only. They never hide broken links or remove a file's valid graph contribution.
- Real Obsidian versions and devices remain distinct acceptance boundaries even when automated tests pass.

## Privacy and security

All indexing and rule evaluation runs locally. Link Integrity does not upload Vault content, require an account, modify notes, or persist the derived graph. Diagnostic paths and samples stay inside the running Obsidian session unless the user chooses to share them.

## Development

Use Node.js 24.18.0 and npm 11.16.0. Run `npm ci`, then `npm run check`.

Stable contracts:

- Product: [English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/product.en.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/product.zh-CN.md)
- UX: [English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/ux.en.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/ux.zh-CN.md)
- Architecture: [English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/architecture.en.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/architecture.zh-CN.md)
- Testing: [English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/testing-strategy.en.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/testing-strategy.zh-CN.md)
- Release: [English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/release.en.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/release.zh-CN.md)

## Support

Use [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues) for reproducible bugs and concrete feature requests. Never post private Vault paths, note content, diagnostic samples, or personal information publicly.

## License

[MIT](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/LICENSE) © ZhengYX
