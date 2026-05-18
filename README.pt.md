<p align="center">
  <a href="README.md"><kbd>EN</kbd></a>
  <a href="README.de.md"><kbd>DE</kbd></a>
  <a href="README.es.md"><kbd>ES</kbd></a>
  <a href="README.fr.md"><kbd>FR</kbd></a>
  <a href="README.it.md"><kbd>IT</kbd></a>
  <a href="README.ja.md"><kbd>JA</kbd></a>
  <a href="README.ko.md"><kbd>KO</kbd></a>
  <a href="README.nl.md"><kbd>NL</kbd></a>
  <a href="README.pl.md"><kbd>PL</kbd></a>
  <a href="README.pt.md"><kbd>PT</kbd></a>
  <a href="README.zh-hans.md"><kbd>简中</kbd></a>
  <a href="README.zh-hant.md"><kbd>繁中</kbd></a>
</p>

# TileLineBase

> **O banco de dados nativo em texto puro para Obsidian**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

Crie **tabelas multidimensionais** diretamente nas suas notas Markdown. **Sem Frontmatter. Sem código.**

## Prévia rápida

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_Clique na prévia acima para assistir em maior qualidade no YouTube._


## Recursos

### Uma tabela poderosa e inteligente

Crie tabelas de dados estruturados diretamente nas suas notas Markdown, com flexibilidade para vários cenários.

#### Visualizações flexíveis: tabela, Kanban, galeria e slides

Um conjunto de registros, quatro formas poderosas de interagir:

- **Tabela filtrada:** Combine livremente regras de **filtro** e **ordenação** em visualizações salvas. Recorte seus dados por projeto ou status e aproveite suporte completo à **edição de texto em múltiplas linhas**.

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Quadro Kanban:** Mapeie **qualquer campo Select ou List** para raias, não apenas Status. Reagrupe seus dados facilmente por prioridade, tags ou autor para enxergar outra dimensão das suas notas.

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Visualização em galeria:** Visualize notas como cartões totalmente personalizáveis. **Crie layouts personalizados** com o **Template Engine** e simplifique a organização com **View Groups** e **ações de clique direito**.

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Visualização em slides:** Transforme linhas em slides focados, perfeitos para pensar sem distrações ou fazer apresentações simples. **Personalize layouts** com facilidade, com suporte integrado a **imagens inline** e **pré-visualizações ao vivo**.

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### Linhas hierárquicas

Use o **Parent-Child Row Mode** para manter registros relacionados agrupados em uma hierarquia de dois níveis, sem deixar de trabalhar naturalmente com visualizações de tabela filtradas.

#### Campos inteligentes

**Fórmulas inline** básicas (aritmética simples), **interpretação inteligente de data e hora** e **vinculação automática** de notas e referências, tudo integrado de forma fluida e refinado continuamente.

#### Fluxo GTD integrado

Inclui **campos de status de tarefas integrados** (Todo, In Progress, Done, On Hold, Someday, Canceled), com View Groups filtrados e visualizações Kanban correspondentes por padrão, permitindo **gerenciamento de tarefas imediato e simples**.

### Um banco de dados nativo do texto

Totalmente baseado em texto, sem formatos de dados complexos nem marcação extra, com suporte intuitivo a conteúdo estruturado.

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### Uma única nota como banco de dados

Agregue todos os registros estruturados relacionados dentro de **uma única nota `.md`**. Isso preserva **associações contextuais**, reduz o esforço de gerenciamento e facilita a revisão e o pensamento de conjunto.

#### Estruturação implícita

Sem Frontmatter, sem marcação de código. A estrutura dos dados fica **contida implicitamente** no texto puro, oferecendo uma representação **amigável para pessoas e máquinas** que permite ler e escrever com naturalidade.


### Interação aberta com dados

Oferece interação e movimentação convenientes de dados entre várias plataformas internas e externas, permitindo organizar e usar informações com mais flexibilidade.

#### Assistente de importação de texto

Transforme rapidamente blocos de texto em registros TileLineBase válidos. Defina padrões simples para mapear conteúdo para campos e **gere instantaneamente a estrutura necessária** sem formatação manual.

#### Integração fluida com Obsidian

Os registros podem se mover com flexibilidade entre diferentes notas de tabela ou ser convertidos em **notas Obsidian independentes**; notas de tabela também podem ser **migradas entre Vaults** com todas as configurações preservadas.

#### Sincronização simples com planilhas

Oferece suporte a **importação e exportação CSV**, compatível com os principais softwares de planilha, permitindo **edição em lote** e organização de dados.

#### Comunicação eficiente com LLMs

Usa um **formato em texto puro claro e autocontido** que pode interagir sem processamento adicional com **Large Language Models (LLM)**.

## Segurança e arquitetura

*   **Isolamento:** O plugin processa **apenas** o arquivo específico em que você alterna para a visualização TileLineBase. Ele nunca escaneia suas outras notas.
*   **Desacoplamento:** Seus dados permanecem no arquivo `.md`. As configurações de visualização ficam no plugin. Suas notas continuam sendo Markdown padrão, mesmo se você desinstalar o plugin.
*   **Proteção:** O backup automático integrado mantém um histórico de instantâneos de arquivos, ajudando a evitar perda acidental de dados.

## Instalação

Instale o TileLineBase pela [Obsidian Community Plugins page](https://community.obsidian.md/plugins/tile-line-base) ou abra-o diretamente no Obsidian com `obsidian://show-plugin?id=tile-line-base`.

TileLineBase está disponível apenas para desktop.

## Desenvolvimento

Para desenvolvimento local, instale as dependências com `npm ci`.

Use `npm install <package>` apenas quando estiver adicionando, removendo ou atualizando uma dependência intencionalmente e precisar atualizar `package-lock.json`.

Depois de alterações em dependências, execute `npm run deps:hardening:check`.

## Dicas e ajustes

- [Status Icon and Row Background Customization](docs/status-snippet-guide.md)

## Feedback e discussão

Feedback, sugestões, perguntas e relatórios de bugs são bem-vindos no espaço em que você preferir conversar.

Você pode:

* Participar ou iniciar uma conversa no [Obsidian Forum thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734).
* Abrir uma Issue no [GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues) se quiser acompanhar algo de forma mais formal.
* Ou aparecer no meu fórum pessoal, [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753), onde ideias mais amplas e conversas paralelas também são bem-vindas.

Fique à vontade para usar o espaço que funcionar melhor para você.


## Agradecimentos

TileLineBase é construído sobre excelentes projetos open source:

- [Obsidian](https://obsidian.md/) e a Obsidian plugin API.
- [AG Grid](https://www.ag-grid.com/) para o modelo central de interação com tabelas.
- [Lucide](https://lucide.dev/) para o conjunto de ícones usado pelo Obsidian e pelos fluxos de ícones do TileLineBase.
- [SortableJS](https://sortablejs.github.io/Sortable/) para interações de arrastar e soltar.
- [monkey-around](https://github.com/pjeby/monkey-around) para suporte a patches em runtime no ecossistema de plugins do Obsidian.

Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para notas sobre componentes de terceiros e licenças.

## Licença

TileLineBase é lançado sob a MIT License.
