<details>
<summary>Read this README in another language</summary>

[English](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [日本語](README.ja.md)<br>
[한국어](README.ko.md) · [Nederlands](README.nl.md) · [Polski](README.pl.md) · [Português](README.pt.md) · [简体中文](README.zh-hans.md) · [繁體中文](README.zh-hant.md)

</details>

# TileLineBase

> **De native platte-tekstdatabase voor Obsidian**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

Bouw **multidimensionale tabellen** rechtstreeks in je Markdown-notities. **Geen Frontmatter. Geen code.**

## Snelle preview

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_Klik op de preview hierboven om de video in hogere kwaliteit op YouTube te bekijken._


## Functies

### Een krachtige en intelligente tabel

Maak gestructureerde datatabellen direct in je Markdown-notities, met flexibele ondersteuning voor uiteenlopende werkscenario's.

#### Flexibele weergaven: tabel, Kanban, galerij en slides

Een set records, vier krachtige manieren om ermee te werken:

- **Gefilterde tabel:** Combineer **Filter**- en **Sort**-regels vrij in opgeslagen weergaven. Snijd je data uit per project of status en profiteer van volledige ondersteuning voor **meerregelige tekstbewerking**.

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Kanban-bord:** Koppel **elk Select- of List-veld** aan banen, niet alleen Status. Groepeer je data eenvoudig opnieuw op Priority, Tags of Author om een andere dimensie van je notities te zien.

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Galerijweergave:** Visualiseer notities als volledig aanpasbare kaarten. **Ontwerp eigen lay-outs** met de **Template Engine** en houd je organisatie soepel met **View Groups** en **rechtsklikacties**.

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Slide-weergave:** Zet rijen om in gerichte slides, ideaal voor geconcentreerd denken of eenvoudige presentaties. Pas **lay-outs** eenvoudig aan, met ingebouwde ondersteuning voor **inline-afbeeldingen** en **live previews**.

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### Hiërarchische rijen

Gebruik **Parent-Child Row Mode** om verwante records gegroepeerd te houden in een hiërarchie met twee niveaus, terwijl je nog steeds natuurlijk werkt met gefilterde tabelweergaven.

#### Slimme velden

Eenvoudige **inline formules** (simpele rekenbewerkingen), **intelligente datum- en tijdherkenning** en **automatisch koppelen** van notities en referenties, allemaal naadloos geïntegreerd en voortdurend verfijnd.

#### Ingebouwde GTD-workflow

Wordt geleverd met **ingebouwde taakstatusvelden** (Todo, In Progress, Done, On Hold, Someday, Canceled), inclusief bijbehorende gefilterde weergavegroepen en Kanban-weergaven als standaard, zodat je **direct en eenvoudig taakbeheer** kunt gebruiken.

### Een database die native in tekst leeft

Volledig tekstgebaseerd, zonder complexe dataformaten of extra markup, met intuïtieve ondersteuning voor gestructureerde inhoud.

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### Een enkele notitie als database

Bundel alle verwante gestructureerde records compact binnen **een enkele `.md`-notitie**. Zo blijven **contextuele verbanden** behouden, daalt de beheerslast en wordt overkoepelend terugblikken en nadenken effectiever.

#### Impliciete structurering

Geen Frontmatter, geen code-markup. De datastructuur zit **impliciet besloten** in platte tekst en biedt een **mens- en machinevriendelijke** datarepresentatie waarmee je natuurlijk kunt lezen en schrijven.


### Open data-interactie

Ondersteunt gemakkelijke data-interactie en verplaatsing tussen verschillende interne en externe platforms, zodat je informatie flexibeler kunt organiseren en benutten.

#### Wizard voor tekstimport

Zet tekstblokken snel om naar geldige TileLineBase-records. Definieer eenvoudige patronen om inhoud aan velden te koppelen en **genereer direct de vereiste structuur** zonder handmatige opmaak.

#### Naadloze Obsidian-integratie

Records kunnen flexibel tussen verschillende tabelnotities worden verplaatst of worden omgezet naar **zelfstandige Obsidian-notities**; tabelnotities kunnen ook **tussen Vaults worden gemigreerd** met behoud van alle configuratie.

#### Eenvoudige spreadsheetsynchronisatie

Ondersteunt **CSV import/export**, compatibel met gangbare spreadsheetsoftware, voor **batchbewerking** en dataorganisatie.

#### Efficiënt communiceren met LLM's

Gebruikt een **helder, op zichzelf staand platte-tekstformaat** dat zonder extra verwerking naadloos kan samenwerken met **Large Language Models (LLM)**.

## Veiligheid en architectuur

*   **Isolatie:** De plugin verwerkt **alleen** het specifieke bestand waarin je overschakelt naar de TileLineBase-weergave. Hij scant nooit je andere notities.
*   **Ontkoppeling:** Je data blijft in het `.md`-bestand. Weergave-instellingen blijven in de plugin. Je notities blijven standaard Markdown, zelfs als je de plugin verwijdert.
*   **Bescherming:** Ingebouwde automatische back-ups bewaren een geschiedenis van bestandssnapshots en helpen onbedoeld dataverlies voorkomen.

## Installatie

Installeer TileLineBase via de [Obsidian Community Plugins-pagina](https://community.obsidian.md/plugins/tile-line-base) of open de plugin rechtstreeks in Obsidian met `obsidian://show-plugin?id=tile-line-base`.

TileLineBase is alleen beschikbaar voor desktop.

## Ontwikkeling

Installeer voor lokale ontwikkeling de afhankelijkheden met `npm ci`.

Gebruik `npm install <package>` alleen wanneer je bewust een dependency toevoegt, verwijdert of bijwerkt en `package-lock.json` moet vernieuwen.

Voer na dependency-wijzigingen `npm run deps:hardening:check` uit.

## Tips en aanpassingen

- [Status Icon and Row Background Customization](docs/status-snippet-guide.md)

## Feedback en discussie

Feedback, suggesties, vragen en bugmeldingen zijn welkom, op de plek waar jij het liefst praat.

Je kunt:

* Deelnemen aan of een gesprek starten in de [Obsidian Forum-thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734).
* Een Issue openen op [GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues) als je iets formeler wilt bijhouden.
* Of langskomen op mijn persoonlijke forum, [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753), waar bredere ideeën en zijgesprekken ook welkom zijn.

Gebruik gerust de plek die voor jou het beste werkt.


## Dankbetuigingen

TileLineBase is gebouwd op uitstekend open-sourcewerk:

- [Obsidian](https://obsidian.md/) en de Obsidian plugin API.
- [AG Grid](https://www.ag-grid.com/) voor het kernmodel van tabelinteractie.
- [Lucide](https://lucide.dev/) voor de iconenset die wordt gebruikt door Obsidian en TileLineBase-iconworkflows.
- [SortableJS](https://sortablejs.github.io/Sortable/) voor drag-and-drop-interacties.
- [monkey-around](https://github.com/pjeby/monkey-around) voor runtime patching-ondersteuning binnen het Obsidian plugin-ecosysteem.

Zie [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) voor informatie over componenten van derden en licenties.

## Licentie

TileLineBase wordt uitgebracht onder de MIT License.
