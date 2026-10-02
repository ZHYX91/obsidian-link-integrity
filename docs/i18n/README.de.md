# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity ist ein lokales Obsidian-Diagnose-Plugin, das nur liest und dabei Broken links und Isolated files findet.

## Screenshots

Defekte Links und isolierte Dateien lassen sich in einer kompakten Seitenleiste prüfen:

![Link-Integrity-Seitenleiste](../assets/link-integrity-overview-en.png)

![Isolierte Dateien nach Ordner gruppiert](../assets/link-integrity-isolated-en.png)

Index, Ignorierregeln, Dateitypen und Regeln für erwartete Isolation werden in den Obsidian-Einstellungen verwaltet:

![Link-Integrity-Einstellungen](../assets/link-integrity-settings-en.png)

## Funktionen

- Findet interne Verweise auf fehlende Dateien, Überschriften und Blöcke in Markdown, Einbettungen, Frontmatter, Canvas und ausdrücklich angegebenen Bases-Dateiverweisen.
- Findet Dateien ohne gültige eingehende oder ausgehende Verbindung zu einer anderen vorhandenen Vault-Datei. Selbstlinks und externe URLs zählen nicht als Vault-Verbindungen.
- Weist darauf hin, wenn eine isolierte Datei zusätzlich defekte ausgehende Links enthält, damit sie nicht vorschnell als offensichtlich entbehrlich gilt.
- Periodische Notizen, Vorlagen, Archive und ähnliche Dateien können als Expected isolated markiert werden. Das ändert nur ihre Einordnung in den Ergebnissen, nicht ihre tatsächlichen Links.
- Filtert isolierte Dateien nach Obsidian-Dateien, Bildformaten, Audio, Video, PDF und konfigurierten Anhangserweiterungen.
- Erstellt bei Bedarf einen vollständigen Index und hält ihn bei Änderungen im Vault automatisch aktuell.
- Öffnet gemeldete Probleme an ihrer Quelle, wenn eine genaue Navigation möglich ist. Scannen, Zuordnen und Indexieren bleiben lokal.

Dynamische Ergebnisse von Bases-Abfragen werden nicht automatisch als Links gewertet. Existiert die Zieldatei, aber eine Überschrift oder ein Block fehlt, gelten die Dateien weiterhin als verbunden und die fehlende Stelle wird separat gemeldet.

## Anforderungen und Kompatibilität

- Obsidian 1.12.7 oder neuer.
- Unterstützt Obsidian auf Desktop- und Mobilgeräten.
- Geprüft wird nur der aktuelle Vault. Externe Websites und entfernte Ressourcen werden nicht überprüft.

## Installation

Öffnen Sie **Einstellungen → Community-Erweiterungen → Durchsuchen**, suchen Sie nach **Link Integrity** und installieren Sie es. Falls es im Katalog nicht angezeigt wird, laden Sie `link-integrity-<version>.zip` aus dem [neuesten GitHub-Release](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest) herunter.

Bei manueller Installation kommen `main.js`, `manifest.json` und `styles.css` nach `Vault/.obsidian/plugins/link-integrity/`. Beim Aktualisieren werden nur diese drei Dateien ersetzt; `data.json` bleibt erhalten, sofern die Einstellungen nicht ausdrücklich zurückgesetzt werden sollen.

## Verwendung

1. Link Integrity unter **Einstellungen → Community-Erweiterungen** aktivieren.
2. Link Integrity über das Menüband oder die Befehlspalette öffnen. Die Seitenleiste enthält **Broken links** und **Isolated files**.
3. Einen Eintrag auswählen, um seine Quelle zu öffnen. Filter für isolierte Dateien ändern nur die aktuelle Ansicht und nicht die gespeicherten Standardwerte.
4. Der Startscan ist standardmäßig aus. Beim Öffnen der Seitenleiste wird der Index bei Bedarf erstellt; alternativ stehen **Index erstellen** und **Index neu erstellen** in den allgemeinen Einstellungen bereit. Nach dem ersten erfolgreichen Aufbau werden Änderungen im Vault automatisch übernommen.

## Einstellungen

- **Allgemein**: Sprache, Startscan, Standardansichten und Aktionen zum Erstellen oder Neuerstellen des Index. Standard ist **Obsidian folgen**.
- **Broken links**: Welche Probleme angezeigt werden und welche benannten Ignorierregeln mit Treffer-Vorschau gelten.
- **Isolated files**: Standard-Dateitypen, die optionale Ansicht ohne eingehende Links, Expected isolated, Ignorierregeln und Regeln für erwartete Isolation.
- Regeln für erwartete Isolation können Dateityp, einen einzelnen Ordner oder einen Ordner mit Unterordnern, Datumsformate, Glob-Muster und erweiterte reguläre Ausdrücke kombinieren. Die Voreinstellung für periodische Notizen unterstützt Tag, Woche, Monat, Quartal und Jahr.

Einstellungen und benutzerdefinierte Regeln stehen in `data.json`. Der berechnete Link-Index bleibt im Arbeitsspeicher und wird nach einem Neustart neu erstellt.

## Einschränkungen

- Link Integrity löscht keine Dateien, schreibt keine Links um und entscheidet nicht automatisch, welche Dateien entfernt werden sollten.
- Externe URLs sind bewusst nicht Teil der Prüfung und werden nicht über das Netzwerk abgefragt.
- Dynamische Bases-Abfragen zählen nicht als direkte Dateiverbindungen; nur ausdrücklich angegebene Dateiverweise zählen.
- Regeln für erwartete Isolation ändern nur die Einordnung bereits isolierter Dateien. Sie verbergen keine defekten Links und entfernen keine echten Dateiverbindungen.

## Datenschutz und Sicherheit

Alle Index- und Regelprüfungen laufen lokal. Link Integrity lädt keine Vault-Inhalte hoch, benötigt kein Konto und verändert keine Notizen. Diagnosepfade und Beispiele bleiben in der laufenden Obsidian-Sitzung, sofern Sie sie nicht selbst teilen.

## Entwicklung

Node.js 24.19.0 und npm 11.17.0 verwenden. `npm ci` und danach `npm run check` ausführen.

Entwicklerdokumentation: [Produkt](../product-requirements.en.md), [UX](../ux-spec.en.md), [Architektur](../architecture.en.md), [Tests](../testing-strategy.en.md). Die chinesischen Quelldokumente liegen im selben Ordner.

## Support

- [Q&A](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/q-a): Fragen zur Nutzung und Konfiguration.
- [Ideas](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/ideas): Noch offene Ideen zu Funktionen und Arbeitsabläufen.
- [Show and tell](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/show-and-tell): Tipps, Arbeitsabläufe und Beispiele.

Reproduzierbare Fehler und konkrete Vorschläge gehören in [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues/new/choose). Keine privaten Vault-Pfade, Notizinhalte, Diagnosedaten oder persönlichen Informationen öffentlich posten.

## Lizenz

[MIT](../../LICENSE) © ZhengYX
