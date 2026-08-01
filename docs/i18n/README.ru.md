# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity — локальный диагностический плагин Obsidian только для чтения, находящий Broken links и Isolated files.

## Что он находит

Плагин показывает неверные внутренние ссылки, изолированные файлы, результаты с низкой уверенностью и, по запросу, ожидаемо изолированные файлы. Ссылки на себя, внешние URL и динамические запросы Bases не создают рёбер.

## Установка

Первая публичная версия ещё не выпущена. В изолированном тестовом Vault скопируйте `main.js`, `manifest.json` и `styles.css` в `.obsidian/plugins/link-integrity/`. Обновление сохраняет `data.json`.

## Конфиденциальность и данные

Вся обработка локальна: содержимое Vault не отправляется и не изменяется, внешние URL не проверяются, производный граф не сохраняется.

## Совместимость

Требуется Obsidian 1.12.7 или новее; предусмотрены настольные и мобильные устройства.

## Состояние

Идёт первая локальная реализация; публикации и записи в каталоге пока нет.
