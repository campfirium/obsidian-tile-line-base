<details>
<summary>Read this README in another language</summary>

| Language | README |
| --- | --- |
| English | [README.md](README.md) |
| Deutsch | [README.de.md](README.de.md) |
| Español | [README.es.md](README.es.md) |
| Français | [README.fr.md](README.fr.md) |
| Italiano | [README.it.md](README.it.md) |
| 日本語 | [README.ja.md](README.ja.md) |
| 한국어 | [README.ko.md](README.ko.md) |
| Nederlands | [README.nl.md](README.nl.md) |
| Polski | [README.pl.md](README.pl.md) |
| Português | [README.pt.md](README.pt.md) |
| 简体中文 | [README.zh-hans.md](README.zh-hans.md) |
| 繁體中文 | [README.zh-hant.md](README.zh-hant.md) |

</details>

# TileLineBase

> **Obsidian 的原生纯文本数据库**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

直接在 Markdown 笔记中构建**多维表格**。**无需 Frontmatter。无需代码。**

## 快速预览

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_点击上方预览，可在 YouTube 观看更高清的视频。_


## 功能

### 强大而智能的表格

直接在 Markdown 笔记中创建结构化数据表，灵活支持多种使用场景。

#### 灵活视图：Table、Kanban、Gallery 与 Slides

一组记录，四种强大的交互方式：

- **Filtered Table:** 自由组合 **Filter** 与 **Sort** 规则，并保存为视图。按项目或状态切分数据，同时享受完整的**多行文本编辑**支持。

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Kanban Board:** 可将**任意 Select 或 List 字段**映射为泳道，而不局限于 Status。轻松按 Priority、Tags 或 Author 重新分组，从不同维度查看笔记。

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Gallery View:** 将笔记呈现为可完全自定义的卡片。使用 **Template Engine** 设计自定义布局，并通过 **View Groups** 与**右键操作**高效整理内容。

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Slide View:** 将行转换为聚焦式幻灯片，非常适合无干扰思考或简单演示。可轻松**自定义布局**，并内置支持**内联图片**与**实时预览**。

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### 层级行

使用 **Parent-Child Row Mode** 将相关记录组织为两级层级，同时仍能自然地配合筛选表格视图使用。

#### 智能字段

基础**内联公式**（简单算术）、**智能日期/时间解析**，以及笔记和引用的**自动链接**，都已无缝集成并持续改进。

#### 内置 GTD 工作流

内置**任务状态字段**（Todo、In Progress、Done、On Hold、Someday、Canceled），默认提供对应的筛选视图组和 Kanban 视图，让你可以**立即、轻松地管理任务**。

### 原生于文本的数据库

完全基于文本，不依赖复杂数据格式或额外标记，直观支持结构化内容。

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### 单篇笔记即数据库

将所有相关结构化记录紧密汇总在**单个 `.md` 笔记**中。这样可以保留**上下文关联**，减少管理成本，并有效促进整体回顾与思考。

#### 隐式结构化

不需要 Frontmatter，也不需要代码标记。数据结构**隐含于**纯文本之中，形成一种**对人和机器都友好**的数据表达方式，让你可以自然地阅读与书写。


### 开放的数据交互

支持在各种内部与外部平台之间便捷地交互和迁移数据，让信息组织与利用更加灵活。

#### 文本导入向导

快速将文本块转换为有效的 TileLineBase 记录。定义简单模式即可把内容映射到字段，**即时生成所需结构**，无需手动排版。

#### 与 Obsidian 无缝集成

记录可以在不同表格笔记之间灵活移动，也可以转换为**独立的 Obsidian 笔记**；表格笔记还可以在**不同 Vault 之间迁移**，并完整保留所有配置。

#### 轻松同步电子表格

支持 **CSV 导入/导出**，兼容主流电子表格软件，便于**批量编辑**与数据整理。

#### 高效与 LLM 沟通

采用**清晰、自包含的纯文本格式**，无需额外处理即可与 **Large Language Models (LLM)** 顺畅交互。

## 安全与架构

*   **Isolation:** 插件**只会**处理你切换到 TileLineBase 视图的那个特定文件，绝不会扫描其他笔记。
*   **Decoupling:** 你的数据保存在 `.md` 文件中，视图设置保存在插件中。即使卸载插件，你的笔记仍然是标准 Markdown。
*   **Protection:** 内置自动备份会保留文件快照历史，帮助避免意外数据丢失。

## 安装

从 [Obsidian Community Plugins page](https://community.obsidian.md/plugins/tile-line-base) 安装 TileLineBase，或在 Obsidian 中通过 `obsidian://show-plugin?id=tile-line-base` 直接打开。

TileLineBase 仅支持桌面端。

## 开发

本地开发时，使用 `npm ci` 安装依赖。

只有在你有意新增、删除或升级依赖，并需要刷新 `package-lock.json` 时，才使用 `npm install <package>`。

依赖变更后，请运行 `npm run deps:hardening:check`。

## 提示与微调

- [状态图标与行背景自定义](docs/status-snippet-guide.md)

## 反馈与讨论

欢迎反馈、建议、问题和 bug 报告，也欢迎在你偏好的地方展开讨论。

你可以：

* 加入或发起 [Obsidian Forum thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734) 上的讨论。
* 如果希望更正式地跟踪问题，可以在 [GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues) 提交 Issue。
* 也可以来我的个人论坛 [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753) 坐坐，那里也欢迎更发散的想法和延伸讨论。

请选择最适合你的交流空间。


## 致谢

TileLineBase 构建在这些优秀的开源项目之上：

- [Obsidian](https://obsidian.md/) 以及 Obsidian plugin API。
- [AG Grid](https://www.ag-grid.com/) 提供核心表格交互模型。
- [Lucide](https://lucide.dev/) 提供 Obsidian 与 TileLineBase 图标工作流中使用的图标集。
- [SortableJS](https://sortablejs.github.io/Sortable/) 提供拖放交互能力。
- [monkey-around](https://github.com/pjeby/monkey-around) 为 Obsidian 插件生态提供运行时补丁支持。

第三方组件与许可证说明请参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证

TileLineBase 基于 MIT License 发布。
