# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity é um plugin local do Obsidian para links inválidos, arquivos isolados e menções potenciais. O diagnóstico é somente leitura por padrão; você pode criar explicitamente um link verificado.

## Capturas de tela

Revise links quebrados e arquivos isolados em uma barra lateral compacta:

![Barra lateral do Link Integrity](../assets/link-integrity-overview-en.png)

![Arquivos isolados agrupados por pasta](../assets/link-integrity-isolated-en.png)

Gerencie índice, regras de exclusão, tipos de arquivo e regras de isolamento esperado nas configurações do Obsidian:

![Configurações do Link Integrity](../assets/link-integrity-settings-en.png)

## Recursos

- Encontra menções de títulos e aliases Markdown, preservando candidatos homônimos, contidos e cruzados. Sugestões nunca contam como conexões do grafo.
- Encontra links internos para arquivos, títulos e blocos ausentes em Markdown, incorporações, Frontmatter, Canvas e referências explícitas de arquivo em Bases.
- Encontra arquivos sem conexão válida de entrada ou saída com outro arquivo existente no Vault. Links para o próprio arquivo e URLs externas não contam como conexões do Vault.
- Avisa quando um arquivo isolado também contém links de saída quebrados, evitando que ele pareça um arquivo obviamente seguro para remover.
- Notas periódicas, modelos, arquivos arquivados e itens semelhantes podem ser marcados como Expected isolated. Isso muda apenas a classificação nos resultados, sem alterar os links reais.
- Filtra arquivos isolados por arquivos do Obsidian, formatos de imagem, áudio, vídeo, PDF e extensões de anexos configuradas.
- Cria um índice completo quando necessário e o mantém atualizado automaticamente conforme o Vault muda.
- Abre cada problema na origem quando há navegação precisa disponível. A análise e a indexação permanecem locais.

Resultados dinâmicos de consultas Bases não são tratados automaticamente como links. Se o arquivo de destino existe, mas falta um título ou bloco, os dois arquivos continuam sendo considerados conectados e o item ausente é informado separadamente.

## Requisitos e compatibilidade

- Obsidian 1.12.7 ou posterior.
- Compatível com Obsidian para desktop e dispositivos móveis.
- Verifica apenas o Vault atual. Sites externos e recursos remotos não são verificados.

## Instalação

Abra **Configurações → Plugins da comunidade → Explorar**, procure **Link Integrity** e instale. Se ainda não aparecer no catálogo, baixe `link-integrity-<version>.zip` da [versão mais recente no GitHub](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest).

Na instalação manual, coloque `main.js`, `manifest.json` e `styles.css` em `Vault/.obsidian/plugins/link-integrity/`. Nas atualizações, substitua apenas esses três arquivos e preserve `data.json`, a menos que queira redefinir as configurações.

## Uso

1. Ative o Link Integrity nos plugins da comunidade.
2. Abra o Link Integrity pela faixa ou paleta de comandos. A barra lateral contém **Broken links** e **Isolated files**.
3. Selecione um resultado para abrir a origem. Os filtros de arquivos isolados alteram apenas a visualização atual, sem mudar os padrões salvos.
4. A varredura na inicialização vem desativada. Ao abrir a barra lateral, o índice é criado quando necessário; também é possível usar **Criar índice** ou **Reconstruir índice** em Geral. Depois da primeira criação bem-sucedida, mudanças no Vault atualizam os resultados automaticamente.

Os comandos consultam a nota atual, o cursor ou fontes que a mencionam; o menu de arquivos isolados também oferece busca inversa. Geral oferece Desativado (padrão), Parágrafo atual e Nota inteira, com tracejado na edição e leitura. Escolha o intervalo da fonte e o destino e crie explicitamente o link. Na leitura ou busca inversa, primeiro abra a fonte e valide o intervalo. A busca mostra progresso, cancelamento e resultados parciais/desatualizados; uma busca incompleta nunca significa zero menções. Após outras edições, use Desfazer do editor.

## Configurações

- **Geral**: idioma, varredura na inicialização, visualizações padrão e ações de criação/reconstrução do índice. O idioma padrão é **Seguir o Obsidian**.
- **Broken links**: quais problemas são mostrados e quais regras nomeadas de exclusão são usadas, com prévia das correspondências.
- **Isolated files**: tipos de arquivo padrão, visualização opcional sem links de entrada, Expected isolated, regras de exclusão e regras de isolamento esperado.
- As regras de isolamento esperado podem combinar tipo de arquivo, uma pasta ou pasta com subpastas, formatos de data, padrões glob e expressões regulares avançadas. A predefinição de notas periódicas cobre dia, semana, mês, trimestre e ano.

Configurações e regras do usuário ficam em `data.json`. O índice de links calculado permanece na memória e é recriado após reiniciar.

## Limitações

- Link Integrity não exclui arquivos nem reescreve links automaticamente. Um link individual exige seleção explícita e validação exata do editor, fonte e destino. Sintaxe protegida ou ambígua pode ocultar dicas; a lista paginada mantém todos os candidatos.
- URLs externas ficam fora do escopo e nunca são consultadas pela rede.
- Resultados dinâmicos de Bases não contam como conexões diretas entre arquivos; apenas referências explícitas contam.
- Regras de isolamento esperado alteram apenas a classificação de arquivos já isolados. Elas não ocultam links quebrados nem removem conexões reais.

## Privacidade e segurança

Indexação e correspondência são locais, sem envio de conteúdo ou conta. As notas mudam somente com sua ação explícita e validada para um link. Sugestões ficam na memória.

## Desenvolvimento

Use Node.js 24.19.0 e npm 11.17.0. Execute `npm ci` e depois `npm run check`.

Documentação para desenvolvimento: [produto](../product-requirements.en.md), [UX](../ux-spec.en.md), [arquitetura](../architecture.en.md), [testes](../testing-strategy.en.md). As fontes chinesas correspondentes ficam na mesma pasta.

## Suporte

- [Q&A](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/q-a): Dúvidas de uso e configuração.
- [Ideas](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/ideas): Ideias de recursos e fluxos de trabalho ainda em discussão.
- [Show and tell](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/show-and-tell): Dicas, fluxos de trabalho e exemplos.

Use [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues/new/choose) para erros reproduzíveis e solicitações concretas. Não publique caminhos privados do Vault, conteúdo de notas, exemplos de diagnóstico ou informações pessoais.

## Licença

[MIT](../../LICENSE) © ZhengYX
