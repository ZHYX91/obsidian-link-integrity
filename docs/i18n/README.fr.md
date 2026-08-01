# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity est un module de diagnostic Obsidian local et en lecture seule pour Broken links et Isolated files.

## Éléments détectés

Il repère les références internes invalides, les fichiers isolés, les résultats à faible confiance et, sur demande, les fichiers dont l’isolement est attendu. Les auto-liens, URL externes et requêtes Bases dynamiques ne créent pas d’arête.

## Installation

La première version publique n’est pas encore publiée. Dans un Vault de développement isolé, copiez `main.js`, `manifest.json` et `styles.css` vers `.obsidian/plugins/link-integrity/`. Une mise à niveau conserve `data.json`.

## Confidentialité et données

Tout s’exécute localement. Le contenu du Vault n’est ni envoyé ni modifié, les URL externes ne sont pas vérifiées et le graphe dérivé n’est pas conservé.

## Compatibilité

Obsidian 1.12.7 ou ultérieur est requis, sur ordinateur et mobile.

## État

La première implémentation locale est en cours, sans publication ni référencement sur le marché.
