# T0185 Row Drag Sorting

## 2025-11-21
- 已创建分支 `feat/T0185-row-drag-sorting` 与工作区 `trees/feat-T0185-row-drag-sorting`，将工作区 `.git` 指向 `gitdir: ../../.git/worktrees/feat-T0185-row-drag-sorting`，并复制根目录 `.vscode/tasks.json` 以沿用 Ctrl+Shift+B 任务。
- 主题：表格交互；类型：体验。目标：评估是否采用类似列拖拽排序的行拖拽方案。
- 现状：行对应 Markdown H2 区块，排序意味着修改块顺序而非仅 UI 置换；列拖拽当前属于视图层伪操作。
- 可行性初步判断：AG Grid Community 提供 rowDrag API（需确认当前版本对 rowDragManaged 的支持），可在网格内重排数据源；多行需在拖拽结束事件中按选择集批量重排，否则仅移动首行。
- 评估要点：1) 单行拖拽是否需要写回 Markdown 块顺序；2) 多行拖拽的选中顺序与插入位置策略；3) 大体量时的性能与撤销策略；4) 与键盘/触控交互的可替代方案。
