# Obsidian 弹窗/UI 使用建议

- 优先用内置骨架：`Modal`、`Setting`（含 `TextComponent/DropdownComponent/ToggleComponent`）、`Notice`。布局尽量沿用 `.modal` / `.modal-content` / `.setting-item`，减少自定义容器。
- 用主题变量而非硬编码：颜色/间距/圆角/阴影用 `--background-*`、`--text-*`、`--size-*`、`--radius-*`、`--shadow-*`，兼容浅/深色主题。
- 少用 `!important`：只在必要处微调，不要整体重置 modal 的 padding/宽度/阴影，避免与核心样式冲突。
- 关闭按钮与 footer：保持默认定位/间距，必要时只做轻量位移；按钮区对齐统一在一处定义，避免各弹窗各写。
- 字段渲染数据驱动：依据 schema/配置决定控件类型，不要靠字段名猜测（如包含 “description” 就用 textarea）。
- 宽度/滚动策略：用 `max-width: min(500px, 90vw)` 之类约束，内容区内边距统一；让 `.modal-content` 填满宽度，减少内层套娃。
