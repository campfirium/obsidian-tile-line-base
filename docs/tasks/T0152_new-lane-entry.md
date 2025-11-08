# T0152 New Lane Entry

## 2025-11-08
- 已创建 `feat/T0152-new-lane-entry` 分支与 `trees/feat-T0152-new-lane-entry` 工作区，将工作区 `.git` 指向 `gitdir: ../../.git/worktrees/feat-T0152-new-lane-entry`，并复制根目录 `.vscode/tasks.json` 以延续 Ctrl+Shift+B 默认任务。
- 主题：看板；类型：基础。目标是在 Kanban 视图中提供可见的“新建泳道”入口，让尚未存在于 Markdown 数据中的泳道值也能提前建好并支持拖拽填充。
- 方案比较：
  - 右上设置菜单新增“新建泳道”：沿用 `KanbanToolbar` 的 Menu 触发 `KanbanLanePresetModal`，由 `KanbanBoardController` 将新泳道写入 `lanePresets: string[]` 并 `persist()`；`KanbanViewController.buildState()` 把 `lanePresets` 并入 `expectedLaneNames`（与 `resolveExpectedStatusLanes` 去重）。优点是入口清晰、键盘/读屏可操作，风险仅在于需扩展 `KanbanBoardDefinition`、`KanbanBoardModal` 与 i18n。
  - 拖拽条目越出面板创建泳道：依赖 SortableJS `onEnd` 检测越界后弹出命名面板并写回记录。虽还原实体看板体验，但鼠标/触控限定、与多选拖拽冲突，且缺少显式提示，容易误触。
- 结论：优先实现菜单入口，保障可访问性并减少拖拽副作用；后续若要补充拖拽手势，可以在实现稳定后增设 `KanbanLaneDropZone` 组件，以图形化提示避免隐藏交互。实施步骤：
  1. 扩展 `KanbanBoardDefinition`、`KanbanBoardStore`、`KanbanBoardModal` 以持久化和编辑 `lanePresets`（去重、排序、同步 i18n）。
  2. 新建 `KanbanLanePresetModal`（或在 `KanbanFieldModal` 上加名称输入）负责创建/重命名，并在 `KanbanToolbar` 设置按钮中挂载入口。
  3. `KanbanViewController.buildState()` 将 `board.lanePresets` 传入 `expectedLaneNames`，并在渲染无卡片泳道时显示拖拽提示，保证拖动卡片后复用现有 `updateRowLane()` 逻辑。

### 实施记录
- 类型与存储：`KanbanBoardDefinition` 新增 `lanePresets` 字段，`KanbanBoardStore` 统一负责去重与序列化，`TableView` 缓存当前看板的 presets，切换或重置时一并清理。
- 入口与交互：在 `renderKanbanToolbar` 的设置菜单追加“新建泳道”项，触发 `KanbanLanePresetModal` 录入唯一名称，`KanbanBoardController.addLanePreset` 将结果写入 state 并调用 `persist()`，成功后使用 i18n Notice 提示。
- 渲染与占位：`KanbanViewController` 将 `lanePresets` 与 `resolveExpectedStatusLanes` 的结果合并交给 `buildKanbanBoardState`，即使尚无任何卡片也会渲染空泳道并沿用 `emptyLanePlaceholder` 作为拖拽提示。
- 状态列防护：因状态字段已经内置 Todo/In Progress/Done 等泳道，不允许再创建自定义占位；当当前看板列为状态列时，菜单项会被禁用并在 `KanbanBoardController.addLanePreset` 中提示用户直接调整状态值。
