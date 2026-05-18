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

> **Obsidian のためのネイティブなプレーンテキストデータベース**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

Markdown ノートの中に、**多次元テーブル**を直接作成できます。**Frontmatter もコードも不要です。**

## クイックプレビュー

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_上のプレビューをクリックすると、YouTube で高画質版を視聴できます。_


## 機能

### パワフルで賢いテーブル

Markdown ノート内に構造化データテーブルを直接作成し、さまざまな用途に柔軟に対応できます。

#### 柔軟なビュー：Table、Kanban、Gallery、Slides

1 つのレコードセットを、4 つの強力な方法で操作できます。

- **Filtered Table:** **Filter** と **Sort** のルールを自由に組み合わせ、保存済みビューとして利用できます。プロジェクトやステータスでデータを切り分けながら、**複数行テキスト編集**にも完全対応します。

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Kanban Board:** Status だけでなく、**任意の Select または List フィールド**をレーンに割り当てられます。Priority、Tags、Author などで簡単に再グループ化し、ノートを別の切り口から把握できます。

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Gallery View:** ノートを自由にカスタマイズできるカードとして表示します。**Template Engine** で独自レイアウトを設計し、**View Groups** と**右クリック操作**で整理を効率化できます。

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Slide View:** 行を集中しやすいスライドに変換します。気を散らさず考えたいときや、簡単なプレゼンテーションに最適です。**レイアウトのカスタマイズ**も簡単で、**インライン画像**と**ライブプレビュー**にも標準対応しています。

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### 階層行

**Parent-Child Row Mode** を使うと、関連するレコードを 2 階層でまとめたまま、フィルター付きテーブルビューでも自然に扱えます。

#### スマートフィールド

基本的な**インライン数式**（簡単な算術）、**賢い日付/時刻解析**、ノートや参照の**自動リンク**をシームレスに統合し、継続的に改善しています。

#### 組み込みの GTD ワークフロー

**タスクステータスフィールド**（Todo、In Progress、Done、On Hold、Someday、Canceled）を内蔵し、対応するフィルター済みビューグループと Kanban ビューを初期状態で提供します。これにより、**すぐに簡単なタスク管理**を始められます。

### テキストにネイティブなデータベース

完全にテキストベースで、複雑なデータ形式や追加のマークアップに縛られず、構造化コンテンツを直感的に扱えます。

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### 1 つのノートをデータベースに

関連する構造化レコードをすべて、**1 つの `.md` ノート**の中に緊密に集約できます。これにより**文脈上のつながり**を保ち、管理の手間を減らし、全体の振り返りと思考を助けます。

#### 暗黙的な構造化

Frontmatter もコード用マークアップも不要です。データ構造はプレーンテキストの中に**暗黙的に含まれ**、**人にも機械にも扱いやすい**データ表現になります。自然な読み書きのまま使えます。


### オープンなデータ連携

内部・外部のさまざまなプラットフォーム間で、データを手軽にやり取りし移動できます。情報の整理と活用がより柔軟になります。

#### テキストインポートウィザード

テキストブロックを有効な TileLineBase レコードへすばやく変換します。シンプルなパターンを定義して内容をフィールドにマッピングするだけで、手作業の整形なしに**必要な構造を即座に生成**できます。

#### Obsidian とのシームレスな統合

レコードは複数のテーブルノート間で柔軟に移動でき、**独立した Obsidian ノート**へ変換することもできます。テーブルノートは、すべての設定を保ったまま**Vault 間で移行**できます。

#### 簡単なスプレッドシート同期

**CSV のインポート/エクスポート**に対応し、主要な表計算ソフトと互換性があります。**一括編集**やデータ整理に便利です。

#### 効率的な LLM 連携

**明確で自己完結したプレーンテキスト形式**を使うため、追加処理なしで **Large Language Models (LLM)** とスムーズにやり取りできます。

## 安全性とアーキテクチャ

*   **Isolation:** このプラグインは、TileLineBase ビューへ切り替えた特定のファイル**だけ**を処理します。他のノートをスキャンすることはありません。
*   **Decoupling:** データは `.md` ファイルに、ビュー設定はプラグインに保存されます。プラグインをアンインストールしても、ノートは標準の Markdown のままです。
*   **Protection:** 内蔵の自動バックアップがファイルスナップショットの履歴を保持し、意図しないデータ損失を防ぎます。

## インストール

[Obsidian Community Plugins page](https://community.obsidian.md/plugins/tile-line-base) から TileLineBase をインストールするか、Obsidian で `obsidian://show-plugin?id=tile-line-base` を開いて直接アクセスできます。

TileLineBase はデスクトップ専用です。

## 開発

ローカル開発では、`npm ci` で依存関係をインストールします。

`npm install <package>` は、依存関係を意図的に追加、削除、アップグレードし、`package-lock.json` を更新する必要がある場合にのみ使用してください。

依存関係を変更した後は、`npm run deps:hardening:check` を実行してください。

## ヒントとカスタマイズ

- [ステータスアイコンと行背景のカスタマイズ](docs/status-snippet-guide.md)

## フィードバックと議論

フィードバック、提案、質問、バグ報告を歓迎します。話しやすい場所で気軽にお寄せください。

利用できる場所：

* [Obsidian Forum thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734) に参加する、または新しく会話を始める。
* より正式に追跡したい内容は、[GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues) で Issue を開く。
* 個人フォーラム [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753) に立ち寄る。より広いアイデアや横道の話題も歓迎しています。

使いやすい場所を選んでください。


## 謝辞

TileLineBase は、優れたオープンソースの成果の上に成り立っています。

- [Obsidian](https://obsidian.md/) と Obsidian plugin API。
- コアとなるテーブル操作モデルを提供する [AG Grid](https://www.ag-grid.com/)。
- Obsidian と TileLineBase のアイコンワークフローで使用するアイコンセットを提供する [Lucide](https://lucide.dev/)。
- ドラッグ＆ドロップ操作を提供する [SortableJS](https://sortablejs.github.io/Sortable/)。
- Obsidian プラグインエコシステムで実行時パッチを支える [monkey-around](https://github.com/pjeby/monkey-around)。

サードパーティコンポーネントとライセンスに関する注記は、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

## ライセンス

TileLineBase は MIT License のもとで公開されています。
