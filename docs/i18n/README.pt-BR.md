# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity é um plugin de diagnóstico local e somente leitura para Obsidian, voltado a Broken links e Isolated files.

## Capturas de tela

Revise links quebrados e arquivos isolados em uma barra lateral compacta:

![Barra lateral do Link Integrity](../assets/link-integrity-overview-en.png)

Configure índice, regras de ignorar, tipos de arquivo e isolamento esperado nas configurações do Obsidian:

![Configurações do Link Integrity](../assets/link-integrity-settings-en.png)

## Recursos

- Relata referências internas quebradas para arquivos, títulos e blocos em Markdown, incorporações, Frontmatter, Canvas e referências explícitas de arquivo em Bases.
- Encontra arquivos sem conexão válida de entrada ou saída com outro arquivo existente no Vault; autolinks e URLs externas não criam conexões.
- Marca com menor confiança arquivos isolados que contêm links de saída quebrados.
- Exibe opcionalmente notas periódicas, modelos e arquivos como Expected isolated sem inventar arestas.
- Filtra arquivos do Obsidian, famílias de imagens, áudio, vídeo, PDF e extensões de anexos configuradas.
- Cria uma base completa quando necessário e depois aplica atualizações incrementais.
- Abre cada diagnóstico na origem; toda análise e indexação permanecem locais.

Resultados dinâmicos de Bases não são arestas explícitas. Se o arquivo for resolvido mas faltar o título ou bloco, a conexão de arquivo continua válida e o subcaminho é relatado separadamente.

## Requisitos e compatibilidade

- Obsidian 1.12.7 ou posterior.
- Projetado para desktop e dispositivos móveis; cada host e dispositivo real permanece uma fronteira de aceitação distinta.
- Diagnostica apenas o Vault atual e não verifica a Web externa.

## Instalação

Após a aprovação no diretório da comunidade, instale pelo **Configurações → Plugins da comunidade → Explorar**. Você também pode baixar `link-integrity-<version>.zip` da [versão mais recente no GitHub](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest).

Na instalação manual, coloque `main.js`, `manifest.json` e `styles.css` em `Vault/.obsidian/plugins/link-integrity/`. Em atualizações, substitua apenas esses três arquivos e preserve `data.json`, salvo se quiser redefinir as configurações.

## Uso

1. Ative o Link Integrity nos plugins da comunidade.
2. Abra a barra lateral pela faixa ou paleta de comandos e alterne entre **Broken links** e **Isolated files**.
3. Selecione um diagnóstico para abrir a origem; os filtros mudam somente a visualização atual.
4. Se a varredura inicial estiver desativada ou a base falhar, use **Criar índice** ou **Reconstruir índice** em Geral. Depois, atualizações incrementais mantêm os resultados atuais.

## Configurações

- **Geral**: idioma, varredura inicial, agrupamento e ações de índice. O idioma padrão é **Seguir o Obsidian**.
- **Broken links**: categorias e regras nomeadas para ignorar, com visualização.
- **Isolated files**: tipos padrão, análise opcional sem links de entrada, visibilidade Expected isolated e regras.
- Regras de isolamento esperado combinam tipo, pasta exata ou recursiva, formato de data, glob e expressão regular; a predefinição periódica cobre dia, semana, mês, trimestre e ano.

Configurações e regras ficam em `data.json`; o grafo derivado não é persistido.

## Limitações

- Não exclui arquivos nem reescreve links automaticamente.
- URLs externas não são consultadas pela rede.
- Consultas dinâmicas do Bases não contam como conexões explícitas.
- Regras Expected isolated afetam apenas a projeção de candidatos e nunca ocultam links quebrados.
- Testes automatizados não substituem a aceitação em versões e dispositivos reais do Obsidian.

## Privacidade e segurança

Tudo é processado localmente. Link Integrity não envia conteúdo do Vault, não exige conta, não modifica notas e não persiste o grafo derivado.

## Desenvolvimento

Use Node.js 24.18.0 e npm 11.16.0. Execute `npm ci` e depois `npm run check`.

Contratos estáveis: [produto](../product.en.md), [UX](../ux.en.md), [arquitetura](../architecture.en.md), [testes](../testing-strategy.en.md) e [lançamento](../release.en.md). As fontes chinesas correspondentes ficam na mesma pasta.

## Suporte

Use [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues) para erros reproduzíveis e solicitações concretas. Não publique caminhos do Vault, conteúdo de notas ou amostras privadas.

## Licença

[MIT](../../LICENSE) © ZhengYX
