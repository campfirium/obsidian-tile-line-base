<p align="center">
  <sub>
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.md">English</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.de.md">Deutsch</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.es.md">Español</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.fr.md">Français</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.it.md">Italiano</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.ja.md">日本語</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.ko.md">한국어</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.nl.md">Nederlands</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.pl.md">Polski</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.pt.md">Português</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.zh-hans.md">简体中文</a> ·
    <a href="https://github.com/campfirium/obsidian-tile-line-base/blob/main/README.zh-hant.md">繁體中文</a>
  </sub>
</p>

# TileLineBase

> **Il database nativo in testo semplice per Obsidian**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

Crea **tabelle multidimensionali** direttamente nelle tue note Markdown. **Zero Frontmatter. Zero codice.**

## Anteprima rapida

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_Fai clic sull’anteprima qui sopra per guardarla in qualità più alta su YouTube._


## Funzionalità

### Una tabella potente e intelligente

Crea tabelle di dati strutturati direttamente nelle tue note Markdown, con la flessibilità necessaria per molti scenari diversi.

#### Viste flessibili: tabella, Kanban, galleria e slide

Un solo insieme di record, quattro modi potenti per interagire:

- **Tabella filtrata:** Combina liberamente regole di **filtro** e **ordinamento** in viste salvate. Analizza i dati per progetto o stato e sfrutta il supporto completo alla **modifica di testo multilinea**.

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Bacheca Kanban:** Associa **qualsiasi campo Select o List** alle corsie, non solo lo stato. Riorganizza facilmente i dati per priorità, tag o autore per osservare un’altra dimensione delle tue note.

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Vista galleria:** Visualizza le note come schede completamente personalizzabili. **Progetta layout personalizzati** con il **Template Engine** e semplifica l’organizzazione tramite **View Groups** e **azioni con clic destro**.

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Vista slide:** Trasforma le righe in slide focalizzate, perfette per pensare senza distrazioni o per presentazioni semplici. **Personalizza facilmente i layout**, con supporto integrato per **immagini inline** e **anteprime live**.

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### Righe gerarchiche

Usa il **Parent-Child Row Mode** per mantenere i record correlati raggruppati in una gerarchia a due livelli, continuando comunque a lavorare in modo naturale con le viste tabellari filtrate.

#### Campi intelligenti

**Formule inline** di base (aritmetica semplice), **interpretazione intelligente di date e orari** e **collegamento automatico** di note e riferimenti, tutto integrato in modo fluido e migliorato continuamente.

#### Workflow GTD integrato

Include **campi di stato attività integrati** (Todo, In Progress, Done, On Hold, Someday, Canceled), con View Groups filtrati e viste Kanban corrispondenti già disponibili, per una **gestione delle attività immediata e semplice**.

### Un database nativo del testo

Completamente basato su testo, libero da formati dati complessi e markup aggiuntivo, con supporto intuitivo ai contenuti strutturati.

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### Una singola nota come database

Raccogli tutti i record strutturati correlati all’interno di **una sola nota `.md`**. Questo conserva le **associazioni contestuali**, riduce il lavoro di gestione e facilita in modo efficace revisione e ragionamento complessivi.

#### Strutturazione implicita

Niente Frontmatter, niente markup di codice. La struttura dei dati è **contenuta implicitamente** nel testo semplice, offrendo una rappresentazione **adatta sia alle persone sia alle macchine** che permette di leggere e scrivere in modo naturale.


### Interazione aperta con i dati

Supporta l’interazione e lo spostamento dei dati tra diverse piattaforme interne ed esterne, permettendo un’organizzazione e un utilizzo delle informazioni più flessibili.

#### Procedura guidata di importazione del testo

Trasforma rapidamente blocchi di testo in record TileLineBase validi. Definisci schemi semplici per mappare il contenuto sui campi e **generare subito la struttura necessaria** senza formattazione manuale.

#### Integrazione fluida con Obsidian

I record possono spostarsi in modo flessibile tra diverse note tabellari o essere convertiti in **note Obsidian autonome**; le note tabellari possono anche essere **migrate tra Vaults** mantenendo intatte tutte le configurazioni.

#### Sincronizzazione semplice con fogli di calcolo

Supporta **importazione ed esportazione CSV**, compatibile con i principali software per fogli di calcolo, consentendo **modifiche in blocco** e organizzazione dei dati.

#### Comunicazione efficiente con gli LLM

Usa un **formato in testo semplice chiaro e autocontenuto** che può interagire senza passaggi aggiuntivi con i **Large Language Models (LLM)**.

## Sicurezza e architettura

*   **Isolamento:** Il plugin elabora **solo** il file specifico in cui passi alla vista TileLineBase. Non scansiona mai le altre tue note.
*   **Disaccoppiamento:** I tuoi dati restano nel file `.md`. Le impostazioni di vista restano nel plugin. Le tue note rimangono Markdown standard, anche se disinstalli il plugin.
*   **Protezione:** Il backup automatico integrato mantiene una cronologia di istantanee dei file, aiutando a prevenire perdite accidentali di dati.

## Installazione

Installa TileLineBase dalla [Obsidian Community Plugins page](https://community.obsidian.md/plugins/tile-line-base) oppure aprilo direttamente in Obsidian con `obsidian://show-plugin?id=tile-line-base`.

TileLineBase è disponibile solo su desktop.

## Sviluppo

Per lo sviluppo locale, installa le dipendenze con `npm ci`.

Usa `npm install <package>` solo quando intendi aggiungere, rimuovere o aggiornare una dipendenza e devi aggiornare `package-lock.json`.

Dopo modifiche alle dipendenze, esegui `npm run deps:hardening:check`.

## Suggerimenti e personalizzazioni

- [Status Icon and Row Background Customization](docs/status-snippet-guide.md)

## Feedback e discussione

Feedback, suggerimenti, domande e segnalazioni di bug sono benvenuti nello spazio che preferisci.

Puoi:

* Partecipare o avviare una conversazione nel [Obsidian Forum thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734).
* Aprire una Issue su [GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues) se vuoi seguire qualcosa in modo più formale.
* Oppure passare dal mio forum personale, [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753), dove sono benvenute anche idee più ampie e discussioni laterali.

Scegli pure lo spazio più comodo per te.


## Ringraziamenti

TileLineBase si basa su eccellenti progetti open source:

- [Obsidian](https://obsidian.md/) e la Obsidian plugin API.
- [AG Grid](https://www.ag-grid.com/) per il modello principale di interazione con la tabella.
- [Lucide](https://lucide.dev/) per il set di icone usato da Obsidian e dai workflow di icone di TileLineBase.
- [SortableJS](https://sortablejs.github.io/Sortable/) per le interazioni drag-and-drop.
- [monkey-around](https://github.com/pjeby/monkey-around) per il supporto al runtime patching nell’ecosistema dei plugin Obsidian.

Consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) per le note sui componenti di terze parti e sulle licenze.

## Licenza

TileLineBase è rilasciato sotto la MIT License.
