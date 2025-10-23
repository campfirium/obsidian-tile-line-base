# TileLineBase Task Record

- **Task ID**: T0060
- **Title**: Keyboard & a11y minimum for status/modal flows
- **Reporter**: Codex (per user discussion)
- **Date**: 2025-10-23
- **Related Specs**: `specs/251023 质量维度差距评估.md` (键盘路径补充草案)

## Background
- `StatusCellRenderer`、`ColumnEditorModal`、`FilterViewModals` 目前主要依赖鼠标操作，键盘路径与读屏支持不足。
- 在 specs 中新增了键盘路径表格及 a11y 验证计划，需要落地最小可行实现，避免阻断后续上线。
- 用户希望优先覆盖“最低限度”行为，不影响现有鼠标交互，同时为后续深入验证留出空间。

## Scope (Minimum Viable Implementation)
- `StatusCellRenderer`
  - 聚焦单元格后监听 `Space` / `Enter`，复用现有状态切换逻辑；更新 `aria-label` 同步状态文案。
  - 监听 `Shift+F10` / ContextMenu 键触发现有菜单显示流程，并在渲染后 `focus()` 第一项，支持 `Up/Down` 导航、`Enter` 选择、`Esc` 关闭。
- `ColumnEditorModal`
  - Modal 打开时设置明确的初始焦点（第一个 Setting 控件）并为关闭按钮或触发按钮记录返回焦点。
  - 监听 `Esc` 关闭 Modal，并确保关闭后焦点回到触发入口（按钮或菜单项）。
- `FilterViewModals`
  - 当前阶段仅复核 Tab 顺序；若无明显问题，记录 TODO，后续迭代中处理读屏标签与焦点约束。

## Out-Of-Scope / Follow-ups
- NVDA / VoiceOver 等屏幕阅读器实测：在最小实现完成并稳定后再安排。
- 可视化高亮、对比度增强、ARIA 结构优化：另起子任务跟踪。
- FilterViewModals 的详尽键盘路径（Tab 包含拖拽、菜单、弹出层等情况）暂不展开，实现后补充到 specs。

## Validation Plan
1. 手动键盘冒烟：复现表格中列出的 6 条场景，记录步骤/预期/结果。
2. 回填 `specs/251023 质量维度差距评估.md` 中的状态列，标注已验证日期。
3. 如果存在未覆盖或存疑的交互，在本任务文档追加“阻塞/风险”条目。

## Notes
- 实现中注意避免破坏现有鼠标事件：键盘监听应复用现有回调。
- 焦点管理建议封装辅助函数，必要时可通过配置开关禁用，方便调试。
- 完成后视情况触发 `npm run build` 及最小 lint 以确保无回归。

## Progress 2025-10-23
- StatusCellRenderer：补充 `Space / Enter` 键切换、`Shift+F10`/菜单键展开、菜单焦点导航与 `aria` 属性同步；新增样式用于键盘高亮。
- ColumnEditorModal：初始化时记录触发焦点、自动聚焦名称输入，绑定 `Esc` 关闭并在关闭时归还焦点。
- FilterViewModals：复核 Tab 顺序，暂未发现阻塞问题；读屏标签与焦点约束保留为后续 TODO。
- 国际化：新增 `statusCell.menuLabel` 用于菜单 `aria-label`，已同步 en/zh 文案。

## Pending Validation
- 需执行 6 条键盘冒烟用例并在 `specs/251023 质量维度差距评估.md` 回填验证日期。
- NVDA/VoiceOver 实测与读屏标签补充仍待后续迭代安排。
