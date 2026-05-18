<p align="center">
  <sub>
    <a href="README.md">English</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.it.md">Italiano</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.nl.md">Nederlands</a> ·
    <a href="README.pl.md">Polski</a> ·
    <a href="README.pt.md">Português</a> ·
    <a href="README.zh-hans.md">简体中文</a> ·
    <a href="README.zh-hant.md">繁體中文</a>
  </sub>
</p>

# TileLineBase

> **La base de données native en texte brut pour Obsidian**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

Créez des **tableaux multidimensionnels** directement dans vos notes Markdown. **Aucun Frontmatter. Aucun code.**

## Aperçu rapide

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_Cliquez sur l’aperçu ci-dessus pour le regarder en meilleure qualité sur YouTube._


## Fonctionnalités

### Un tableau puissant et intelligent

Créez des tableaux de données structurées directement dans vos notes Markdown, avec la flexibilité nécessaire pour couvrir de nombreux cas d’usage.

#### Vues flexibles : tableau, Kanban, galerie et diapositives

Un ensemble d’enregistrements, quatre façons puissantes d’interagir :

- **Tableau filtré :** Combinez librement des règles de **filtre** et de **tri** dans des vues enregistrées. Explorez vos données par projet ou par statut, avec une prise en charge complète de la **modification de texte multiligne**.

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Tableau Kanban :** Associez **n’importe quel champ Select ou List** à des colonnes, pas seulement le statut. Regroupez facilement vos données par priorité, tags ou auteur pour révéler une autre dimension de vos notes.

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Vue galerie :** Visualisez vos notes sous forme de cartes entièrement personnalisables. **Concevez des mises en page sur mesure** avec le **Template Engine**, et simplifiez l’organisation grâce aux **View Groups** et aux **actions par clic droit**.

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Vue diapositives :** Transformez les lignes en diapositives ciblées, idéales pour réfléchir sans distraction ou préparer des présentations simples. **Personnalisez facilement les mises en page**, avec une prise en charge intégrée des **images inline** et des **aperçus en direct**.

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### Lignes hiérarchiques

Utilisez le **Parent-Child Row Mode** pour garder les enregistrements liés regroupés dans une hiérarchie à deux niveaux, tout en continuant à travailler naturellement avec des vues de tableau filtrées.

#### Champs intelligents

Des **formules inline** de base (arithmétique simple), une **interprétation intelligente des dates et heures** et des **liens automatiques** vers les notes et références, le tout intégré de façon fluide et amélioré en continu.

#### Workflow GTD intégré

Inclut des **champs de statut de tâche intégrés** (Todo, In Progress, Done, On Hold, Someday, Canceled), avec des View Groups filtrés et des vues Kanban correspondantes par défaut, pour une **gestion des tâches immédiate et simple**.

### Une base de données native du texte

Entièrement basée sur le texte, sans formats de données complexes ni balisage supplémentaire, avec une prise en charge intuitive du contenu structuré.

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### Une seule note comme base de données

Regroupez tous les enregistrements structurés associés dans **une seule note `.md`**. Cela préserve les **liens contextuels**, réduit la charge de gestion et facilite efficacement la revue globale et la réflexion.

#### Structuration implicite

Pas de Frontmatter, pas de balisage de code. La structure des données est **contenue implicitement** dans le texte brut, offrant une représentation **lisible par les humains comme par les machines** qui permet de lire et d’écrire naturellement.


### Interaction ouverte avec les données

Facilite l’interaction et le déplacement des données entre différentes plateformes internes et externes, pour organiser et exploiter l’information avec plus de flexibilité.

#### Assistant d’importation de texte

Transformez rapidement des blocs de texte en enregistrements TileLineBase valides. Définissez des motifs simples pour associer le contenu aux champs et **générer instantanément la structure nécessaire**, sans mise en forme manuelle.

#### Intégration fluide avec Obsidian

Les enregistrements peuvent être déplacés librement entre différentes notes de tableau ou convertis en **notes Obsidian autonomes** ; les notes de tableau peuvent aussi être **migrées entre Vaults** en conservant toute leur configuration.

#### Synchronisation simple avec les tableurs

Prend en charge **l’import et l’export CSV**, compatible avec les principaux logiciels de tableur, pour permettre la **modification par lots** et l’organisation des données.

#### Communication efficace avec les LLMs

Utilise un **format clair, autonome et en texte brut** qui peut interagir sans traitement supplémentaire avec les **Large Language Models (LLM)**.

## Sécurité et architecture

*   **Isolation :** Le plugin traite **uniquement** le fichier précis dans lequel vous passez à la vue TileLineBase. Il ne parcourt jamais vos autres notes.
*   **Découplage :** Vos données restent dans le fichier `.md`. Les réglages de vue restent dans le plugin. Vos notes restent du Markdown standard, même si vous désinstallez le plugin.
*   **Protection :** La sauvegarde automatique intégrée conserve un historique d’instantanés de fichiers afin d’éviter les pertes de données accidentelles.

## Installation

Installez TileLineBase depuis la [Obsidian Community Plugins page](https://community.obsidian.md/plugins/tile-line-base) ou ouvrez-le directement dans Obsidian avec `obsidian://show-plugin?id=tile-line-base`.

TileLineBase est disponible uniquement sur ordinateur.

## Développement

Pour le développement local, installez les dépendances avec `npm ci`.

Utilisez `npm install <package>` uniquement lorsque vous ajoutez, supprimez ou mettez à jour volontairement une dépendance et que vous devez actualiser `package-lock.json`.

Après toute modification des dépendances, exécutez `npm run deps:hardening:check`.

## Astuces et ajustements

- [Status Icon and Row Background Customization](docs/status-snippet-guide.md)

## Retours et discussion

Les retours, suggestions, questions et rapports de bugs sont les bienvenus, dans l’espace de discussion qui vous convient le mieux.

Vous pouvez :

* Rejoindre ou lancer une conversation sur le [Obsidian Forum thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734).
* Ouvrir une Issue sur [GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues) si vous souhaitez suivre un sujet de manière plus formelle.
* Ou passer sur mon forum personnel, [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753), où les idées plus larges et les discussions parallèles sont également les bienvenues.

Choisissez simplement l’espace qui vous convient le mieux.


## Remerciements

TileLineBase s’appuie sur d’excellents projets open source :

- [Obsidian](https://obsidian.md/) et la Obsidian plugin API.
- [AG Grid](https://www.ag-grid.com/) pour le modèle principal d’interaction avec les tableaux.
- [Lucide](https://lucide.dev/) pour le jeu d’icônes utilisé par Obsidian et les workflows d’icônes de TileLineBase.
- [SortableJS](https://sortablejs.github.io/Sortable/) pour les interactions par glisser-déposer.
- [monkey-around](https://github.com/pjeby/monkey-around) pour la prise en charge des correctifs runtime dans l’écosystème des plugins Obsidian.

Consultez [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) pour les notes relatives aux composants tiers et aux licences.

## Licence

TileLineBase est publié sous la MIT License.
