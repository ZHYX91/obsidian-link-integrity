# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity ist ein lokales, schreibgeschütztes Obsidian-Diagnose-Plugin für Broken links und Isolated files.

## Screenshots

Broken links und isolierte Dateien in einer kompakten Seitenleiste prüfen:

![Link-Integrity-Seitenleiste](../assets/link-integrity-overview-en.png)

Index, Ignorierregeln, Dateitypen und erwartete Isolation in den Obsidian-Einstellungen konfigurieren:

## Funktionen

- Meldet defekte interne Datei-, Überschriften- und Blockverweise aus Markdown, Einbettungen, Frontmatter, Canvas und expliziten Bases-Dateiverweisen.
- Findet Dateien ohne gültige eingehende oder ausgehende Verbindung zu einer anderen vorhandenen Vault-Datei; Selbstlinks und externe URLs erzeugen keine Vault-Verbindung.
- Kennzeichnet isolierte Dateien mit defekten ausgehenden Links als weniger verlässlich.
- Zeigt periodische Notizen, Vorlagen und Archive optional als Expected isolated an, ohne Graphkanten zu erfinden.
- Filtert nach Obsidian-Dateien, Bildformaten, Audio, Video, PDF und konfigurierten Anhangserweiterungen.
- Erstellt bei Bedarf eine vollständige Basis und hält sie danach inkrementell aktuell.
- Öffnet jede Diagnose an ihrer Quelle; Verarbeitung und Indexierung bleiben lokal.

Dynamische Bases-Abfragen sind keine expliziten Kanten. Ein aufgelöstes Dateiziel mit fehlender Überschrift oder fehlendem Block behält seine Dateiverbindung und erhält eine eigene Unterpfad-Diagnose.

## Anforderungen und Kompatibilität

- Obsidian 1.12.7 oder neuer.
- Unterstützt Obsidian auf Desktop- und Mobilgeräten.
- Es wird nur der aktuelle Vault diagnostiziert, nicht das externe Web.

## Installation

Öffnen Sie **Einstellungen → Community-Erweiterungen → Durchsuchen**, suchen Sie nach **Link Integrity** und installieren Sie es. Falls es im Katalog nicht angezeigt wird, laden Sie `link-integrity-<version>.zip` aus dem [neuesten GitHub-Release](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest) herunter.

Bei manueller Installation kommen `main.js`, `manifest.json` und `styles.css` nach `Vault/.obsidian/plugins/link-integrity/`. Beim Aktualisieren werden nur diese drei Dateien ersetzt; `data.json` bleibt erhalten, solange die Einstellungen nicht ausdrücklich zurückgesetzt werden sollen.

## Verwendung

1. Link Integrity unter **Einstellungen → Community-Erweiterungen** aktivieren.
2. Die Seitenleiste über das Menüband oder die Befehlspalette öffnen und zwischen **Broken links** und **Isolated files** wechseln.
3. Eine Diagnose auswählen, um ihre Quelle zu öffnen; Filter ändern nur die aktuelle Ansicht.
4. Wenn der Startscan deaktiviert ist oder die Basis fehlschlug, in den allgemeinen Einstellungen **Index erstellen** oder **Index neu erstellen** verwenden. Danach halten inkrementelle Updates die Ergebnisse aktuell.

## Einstellungen

- **Allgemein**: Sprache, Startscan, Gruppierung und Erstellen/Neuerstellen des Index. Standard ist **Obsidian folgen**.
- **Broken links**: Diagnosekategorien und benannte Ignorierregeln mit Vorschau.
- **Isolated files**: Standarddateitypen, optionale Analyse ohne eingehende Links, Sichtbarkeit erwarteter Isolation und Regeln.
- Regeln für erwartete Isolation können Dateityp, Ordnerbereich, Datumsformat, Glob und reguläre Ausdrücke kombinieren; die Voreinstellung für periodische Notizen unterstützt Tag, Woche, Monat, Quartal und Jahr.

Einstellungen und Regeln stehen in `data.json`; der abgeleitete Graph wird nicht gespeichert.

## Einschränkungen

- Keine Dateien werden gelöscht und keine Links automatisch umgeschrieben.
- Externe URLs werden nicht über das Netzwerk geprüft.
- Dynamische Bases-Abfragen zählen nicht als explizite Verbindungen.
- Regeln für erwartete Isolation beeinflussen nur die Kandidatenansicht und verbergen keine defekten Links.

## Datenschutz und Sicherheit

Alles läuft lokal. Link Integrity lädt keine Vault-Inhalte hoch, benötigt kein Konto, verändert keine Notizen und speichert den abgeleiteten Graphen nicht dauerhaft.

## Entwicklung

Node.js 24.19.0 und npm 11.17.0 verwenden. `npm ci` und danach `npm run check` ausführen.

Dauerhafte Verträge: [Produkt](../product-requirements.en.md), [UX](../ux-spec.en.md), [Architektur](../architecture.en.md), [Tests](../testing-strategy.en.md) und [Release](../release.en.md). Die chinesischen Quellen liegen jeweils im selben Ordner.

## Support

Reproduzierbare Fehler und konkrete Vorschläge gehören in [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues). Keine privaten Vault-Pfade, Notizinhalte oder Diagnosedaten öffentlich posten.

## Lizenz

[MIT](../../LICENSE) © ZhengYX
