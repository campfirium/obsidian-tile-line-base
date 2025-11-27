# T0201 Thumbnail Accurate Rendering

## 2025-11-27
- 已创建分支 `feat/T0201-thumbnail-accurate-rendering` 与工作区 `trees/feat-T0201-thumbnail-accurate-rendering`，将工作区 `.git` 指向 `gitdir: ../../.git/worktrees/feat-T0201-thumbnail-accurate-rendering`，并复制根目录 `.vscode/tasks.json` 以沿用 Ctrl+Shift+B 任务。
- 主题：幻灯片；类型：体验。问题：缩略图未真实呈现幻灯片内容（文本样式、间距、Markdown 渲染），需要等比例缩放而非替代样式重组。
- 初步思路：逐步调整现有缩略图渲染链路，复用真实内容与样式并控制缩放比例，尽量不破坏现有布局。
