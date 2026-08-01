# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity ist ein lokales, schreibgeschütztes Obsidian-Diagnose-Plugin für Broken links und Isolated files.

## Erkennung

Es findet ungültige interne Verweise, isolierte Dateien, Ergebnisse mit geringer Sicherheit und optional erwartungsgemäß isolierte Dateien. Selbstlinks, externe URLs und dynamische Bases-Abfragen erzeugen keine Graphkante.

## Installation

Die erste öffentliche Version ist noch nicht veröffentlicht. In einem isolierten Entwicklungs-Vault werden `main.js`, `manifest.json` und `styles.css` nach `.obsidian/plugins/link-integrity/` kopiert. Bei Aktualisierungen bleibt `data.json` erhalten.

## Datenschutz und Daten

Alles läuft lokal. Vault-Inhalte werden weder gesendet noch verändert; externe URLs werden nicht geprüft und der abgeleitete Graph wird nicht gespeichert.

## Kompatibilität

Erfordert Obsidian 1.12.7 oder neuer und ist für Desktop und Mobilgeräte vorgesehen.

## Status

Die erste lokale Implementierung ist in Arbeit; es gibt noch keine Veröffentlichung oder Marketplace-Liste.
