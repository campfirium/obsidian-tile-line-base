<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/English-59636e?style=flat-square"></a>
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/Deutsch-59636e?style=flat-square"></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/Espa%C3%B1ol-59636e?style=flat-square"></a>
  <a href="README.fr.md"><img alt="Français" src="https://img.shields.io/badge/Fran%C3%A7ais-59636e?style=flat-square"></a>
  <a href="README.it.md"><img alt="Italiano" src="https://img.shields.io/badge/Italiano-59636e?style=flat-square"></a>
  <a href="README.ja.md"><img alt="日本語" src="https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-59636e?style=flat-square"></a>
  <a href="README.ko.md"><img alt="한국어" src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-59636e?style=flat-square"></a>
  <a href="README.nl.md"><img alt="Nederlands" src="https://img.shields.io/badge/Nederlands-59636e?style=flat-square"></a>
  <a href="README.pl.md"><img alt="Polski" src="https://img.shields.io/badge/Polski-59636e?style=flat-square"></a>
  <a href="README.pt.md"><img alt="Português" src="https://img.shields.io/badge/Portugu%C3%AAs-59636e?style=flat-square"></a>
  <a href="README.zh-hans.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-59636e?style=flat-square"></a>
  <a href="README.zh-hant.md"><img alt="繁體中文" src="https://img.shields.io/badge/%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-59636e?style=flat-square"></a>
</p>

# TileLineBase

> **La base de datos nativa en texto plano para Obsidian**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

Crea **tablas multidimensionales** directamente dentro de tus notas Markdown. **Sin Frontmatter. Sin código.**

## Vista previa rápida

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_Haz clic en la vista previa de arriba para verla con mayor calidad en YouTube._


## Funciones

### Una tabla potente e inteligente

Crea tablas de datos estructurados directamente en tus notas Markdown, con flexibilidad para muchos escenarios.

#### Vistas flexibles: tabla, Kanban, galería y diapositivas

Un conjunto de registros, cuatro formas potentes de interactuar:

- **Tabla filtrada:** Combina libremente reglas de **filtro** y **ordenación** en vistas guardadas. Segmenta tus datos por proyecto o estado y disfruta de soporte completo para **edición de texto multilínea**.

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Tablero Kanban:** Asigna **cualquier campo Select o List** a carriles, no solo el estado. Reagrupa tus datos fácilmente por prioridad, etiquetas o autor para ver otra dimensión de tus notas.

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Vista de galería:** Visualiza notas como tarjetas totalmente personalizables. **Diseña layouts personalizados** con el **Template Engine** y agiliza la organización mediante **View Groups** y **acciones con clic derecho**.

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Vista de diapositivas:** Convierte filas en diapositivas enfocadas, perfectas para pensar sin distracciones o para presentaciones sencillas. **Personaliza layouts** con facilidad, con soporte integrado para **imágenes inline** y **vistas previas en vivo**.

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### Filas jerárquicas

Usa el **Parent-Child Row Mode** para mantener registros relacionados agrupados en una jerarquía de dos niveles, sin dejar de trabajar de forma natural con vistas de tabla filtradas.

#### Campos inteligentes

**Fórmulas inline** básicas (aritmética simple), **interpretación inteligente de fecha y hora** y **enlaces automáticos** a notas y referencias, todo integrado de forma fluida y en mejora continua.

#### Flujo GTD integrado

Incluye **campos de estado de tarea integrados** (Todo, In Progress, Done, On Hold, Someday, Canceled), junto con View Groups filtrados y vistas Kanban correspondientes por defecto, para una **gestión de tareas inmediata y sencilla**.

### Una base de datos nativa del texto

Completamente basada en texto, sin formatos de datos complejos ni marcado adicional, con soporte intuitivo para contenido estructurado.

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### Una sola nota como base de datos

Agrupa todos los registros estructurados relacionados dentro de **una única nota `.md`**. Esto conserva las **asociaciones contextuales**, reduce el esfuerzo de gestión y facilita la revisión y el pensamiento global.

#### Estructuración implícita

Sin Frontmatter ni marcado de código. La estructura de datos está **contenida implícitamente** en texto plano, ofreciendo una representación **amigable para personas y máquinas** que permite leer y escribir con naturalidad.


### Interacción abierta con datos

Permite interactuar con datos y moverlos cómodamente entre distintas plataformas internas y externas, para organizar y aprovechar la información con mayor flexibilidad.

#### Asistente de importación de texto

Transforma rápidamente bloques de texto en registros válidos de TileLineBase. Define patrones simples para asignar contenido a campos y **generar al instante la estructura necesaria** sin formateo manual.

#### Integración fluida con Obsidian

Los registros pueden moverse con flexibilidad entre distintas notas de tabla o convertirse en **notas independientes de Obsidian**; las notas de tabla también pueden **migrarse entre Vaults** conservando intacta toda la configuración.

#### Sincronización sencilla con hojas de cálculo

Admite **importación y exportación CSV**, compatible con el software de hojas de cálculo más común, lo que permite **edición por lotes** y organización de datos.

#### Comunicación eficiente con LLMs

Utiliza un **formato claro, autocontenido y en texto plano** que puede interactuar sin fricción con **Large Language Models (LLM)** sin procesamiento adicional.

## Seguridad y arquitectura

*   **Aislamiento:** El plugin **solo** procesa el archivo específico en el que cambias a la vista TileLineBase. Nunca escanea tus otras notas.
*   **Desacoplamiento:** Tus datos permanecen en el archivo `.md`. Los ajustes de vista permanecen en el plugin. Tus notas siguen siendo Markdown estándar, incluso si desinstalas el plugin.
*   **Protección:** La copia de seguridad automática integrada conserva un historial de instantáneas de archivos y ayuda a evitar pérdidas accidentales de datos.

## Instalación

Instala TileLineBase desde la [Obsidian Community Plugins page](https://community.obsidian.md/plugins/tile-line-base) o ábrelo directamente en Obsidian con `obsidian://show-plugin?id=tile-line-base`.

TileLineBase solo está disponible para escritorio.

## Desarrollo

Para el desarrollo local, instala las dependencias con `npm ci`.

Usa `npm install <package>` solo cuando vayas a añadir, eliminar o actualizar una dependencia de forma intencionada y necesites actualizar `package-lock.json`.

Después de cambiar dependencias, ejecuta `npm run deps:hardening:check`.

## Consejos y ajustes

- [Status Icon and Row Background Customization](docs/status-snippet-guide.md)

## Comentarios y discusión

Agradecemos comentarios, sugerencias, preguntas e informes de errores en el espacio que prefieras.

Puedes:

* Unirte o iniciar una conversación en el [Obsidian Forum thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734).
* Abrir un Issue en [GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues) si quieres hacer seguimiento de algo de forma más formal.
* O pasar por mi foro personal, [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753), donde también son bienvenidas las ideas más amplias y las conversaciones paralelas.

Usa el espacio que te resulte más cómodo.


## Agradecimientos

TileLineBase se basa en excelentes proyectos de código abierto:

- [Obsidian](https://obsidian.md/) y la Obsidian plugin API.
- [AG Grid](https://www.ag-grid.com/) para el modelo principal de interacción con tablas.
- [Lucide](https://lucide.dev/) para el conjunto de iconos usado por Obsidian y los flujos de iconos de TileLineBase.
- [SortableJS](https://sortablejs.github.io/Sortable/) para interacciones de arrastrar y soltar.
- [monkey-around](https://github.com/pjeby/monkey-around) para soporte de parcheo en tiempo de ejecución dentro del ecosistema de plugins de Obsidian.

Consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para ver notas sobre componentes de terceros y licencias.

## Licencia

TileLineBase se publica bajo la MIT License.
