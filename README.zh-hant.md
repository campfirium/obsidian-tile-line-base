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

> **Obsidian 的原生純文字資料庫**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

直接在 Markdown 筆記中建立**多維表格**。**不需要 Frontmatter。不需要程式碼。**

## 快速預覽

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_點選上方預覽，即可在 YouTube 觀看更高畫質的影片。_


## 功能

### 強大且智慧的表格

直接在 Markdown 筆記中建立結構化資料表，靈活支援各種使用情境。

#### 彈性視圖：Table、Kanban、Gallery 與 Slides

同一組記錄，四種強大的互動方式：

- **Filtered Table:** 自由組合 **Filter** 與 **Sort** 規則，並儲存為視圖。依專案或狀態切分資料，同時享有完整的**多行文字編輯**支援。

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Kanban Board:** 可將**任何 Select 或 List 欄位**映射為泳道，不只限於 Status。輕鬆依 Priority、Tags 或 Author 重新分組，從不同維度檢視筆記。

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Gallery View:** 將筆記視覺化為可完全自訂的卡片。使用 **Template Engine** 設計自訂版面，並透過 **View Groups** 與**右鍵操作**提升整理效率。

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Slide View:** 將列轉換為聚焦式投影片，非常適合無干擾思考或簡易簡報。可輕鬆**自訂版面**，並內建支援**行內圖片**與**即時預覽**。

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### 階層列

使用 **Parent-Child Row Mode** 將相關記錄維持在兩層階層中，同時仍能自然搭配篩選表格視圖使用。

#### 智慧欄位

基礎**行內公式**（簡單算術）、**智慧日期/時間解析**，以及筆記與引用的**自動連結**，都已無縫整合並持續打磨。

#### 內建 GTD 工作流程

內建**任務狀態欄位**（Todo、In Progress、Done、On Hold、Someday、Canceled），預設提供對應的篩選視圖群組與 Kanban 視圖，讓你可以**立即且輕鬆地管理任務**。

### 原生於文字的資料庫

完全以文字為基礎，不依賴複雜資料格式或額外標記，直覺支援結構化內容。

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### 單篇筆記即資料庫

將所有相關結構化記錄緊密彙整在**單一 `.md` 筆記**中。這能保留**脈絡關聯**、降低管理成本，並有效促進整體回顧與思考。

#### 隱式結構化

不需要 Frontmatter，也不需要程式碼標記。資料結構**隱含於**純文字之中，提供一種**對人與機器都友善**的資料表達方式，讓你能自然地閱讀與書寫。


### 開放的資料互動

支援在各種內部與外部平台之間便利地互動與移動資料，讓資訊組織與運用更加彈性。

#### 文字匯入精靈

快速將文字區塊轉換為有效的 TileLineBase 記錄。定義簡單模式即可將內容映射到欄位，**立即產生所需結構**，不必手動格式化。

#### 與 Obsidian 無縫整合

記錄可以在不同表格筆記之間彈性移動，也可以轉換為**獨立的 Obsidian 筆記**；表格筆記也能在**不同 Vault 之間遷移**，並完整保留所有設定。

#### 輕鬆同步試算表

支援 **CSV 匯入/匯出**，相容主流試算表軟體，方便**批次編輯**與資料整理。

#### 高效與 LLM 溝通

採用**清晰、自包含的純文字格式**，無需額外處理即可與 **Large Language Models (LLM)** 順暢互動。

## 安全與架構

*   **Isolation:** 外掛**只會**處理你切換到 TileLineBase 視圖的那個特定檔案，絕不會掃描其他筆記。
*   **Decoupling:** 你的資料保存在 `.md` 檔案中，視圖設定保存在外掛中。即使解除安裝外掛，你的筆記仍然是標準 Markdown。
*   **Protection:** 內建自動備份會保留檔案快照歷史，協助避免意外資料遺失。

## 安裝

從 [Obsidian Community Plugins page](https://community.obsidian.md/plugins/tile-line-base) 安裝 TileLineBase，或在 Obsidian 中透過 `obsidian://show-plugin?id=tile-line-base` 直接開啟。

TileLineBase 僅支援桌面端。

## 開發

本機開發時，使用 `npm ci` 安裝依賴。

只有在你有意新增、移除或升級依賴，並需要更新 `package-lock.json` 時，才使用 `npm install <package>`。

依賴變更後，請執行 `npm run deps:hardening:check`。

## 提示與微調

- [狀態圖示與列背景自訂](docs/status-snippet-guide.md)

## 回饋與討論

歡迎提供回饋、建議、問題與 bug 回報，也歡迎在你偏好的地方討論。

你可以：

* 加入或發起 [Obsidian Forum thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734) 上的討論。
* 如果希望更正式地追蹤事項，可以在 [GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues) 開 Issue。
* 也可以來我的個人論壇 [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753) 坐坐，這裡也歡迎更寬廣的想法與延伸討論。

請選擇最適合你的交流空間。


## 致謝

TileLineBase 建立在這些優秀的開源成果之上：

- [Obsidian](https://obsidian.md/) 以及 Obsidian plugin API。
- [AG Grid](https://www.ag-grid.com/) 提供核心表格互動模型。
- [Lucide](https://lucide.dev/) 提供 Obsidian 與 TileLineBase 圖示工作流程使用的圖示集。
- [SortableJS](https://sortablejs.github.io/Sortable/) 提供拖放互動能力。
- [monkey-around](https://github.com/pjeby/monkey-around) 為 Obsidian 外掛生態提供執行階段修補支援。

第三方元件與授權說明請參閱 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 授權

TileLineBase 以 MIT License 發布。
