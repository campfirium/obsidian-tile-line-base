# T0191 Fullscreen Layout

## 2025-11-23
- 已创建分支 `feat/T0191-fullscreen-layout` 与工作区 `trees/feat-T0191-fullscreen-layout`，将工作区 `.git` 指向 `gitdir: ../../.git/worktrees/feat-T0191-fullscreen-layout`，并复制根目录 `.vscode/tasks.json` 以沿用 Ctrl+Shift+B 任务。
- 主题：幻灯片；类型：基础。问题：全屏状态布局与卡片状态不一致，应保持布局等比例放大。
- 初步思路：复用卡片态样式并通过等比缩放适配全屏，避免单独的全屏样式带来字号与边距偏差。
