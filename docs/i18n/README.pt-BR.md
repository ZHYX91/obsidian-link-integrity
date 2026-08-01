# Link Integrity

[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-CN.md) · [繁體中文](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.zh-TW.md) · [Deutsch](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.de.md) · [Français](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.fr.md) · [Русский](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ru.md) · [Português (Brasil)](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.pt-BR.md) · [日本語](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ja.md) · [한국어](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.ko.md) · [Español](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.es.md) · [Tiếng Việt](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/docs/i18n/README.vi.md)

Link Integrity é um plugin de diagnóstico local e somente leitura para Obsidian, voltado a Broken links e Isolated files.

## O que encontra

Ele identifica referências internas inválidas, arquivos isolados, resultados de baixa confiança e, opcionalmente, arquivos cujo isolamento é esperado. Auto-links, URLs externas e consultas dinâmicas do Bases não criam arestas.

## Instalação

A primeira versão pública ainda não foi lançada. Em um Vault de desenvolvimento isolado, copie `main.js`, `manifest.json` e `styles.css` para `.obsidian/plugins/link-integrity/`. A atualização preserva `data.json`.

## Privacidade e dados

Tudo é processado localmente. O conteúdo do Vault não é enviado nem alterado; URLs externas não são verificadas e o grafo derivado não é persistido.

## Compatibilidade

Requer Obsidian 1.12.7 ou posterior, em desktop e dispositivos móveis.

## Status

A implementação local inicial está em andamento; ainda não há publicação nem listagem no marketplace.
