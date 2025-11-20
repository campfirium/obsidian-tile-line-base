# T0178 Kanban Name Mismatch

## 2025-11-19
- 已创建分支 `feat/T0178-kanban-name-mismatch` 以及工作区 `trees/feat-T0178-kanban-name-mismatch`，并将工作区 `.git` 指向 `gitdir: ../../.git/worktrees/feat-T0178-kanban-name-mismatch`；复制根目录 `.vscode/tasks.json` 以沿用 Ctrl+Shift+B 任务。
- 主题：看板；类型：缺陷。现象：没有 `status` 列的笔记在首次进入看板视图时仍会自动生成“默认状态看板”，名称暗示状态列但 laneField 实际指向不存在的字段，导致界面直接报错“缺少列”。
- 排查：`createDefaultStatusBoard()` 始终返回 `'status'`，即使 Schema 中没有匹配列，后续也不会回退到手动建板流程。
- 修复方向：`resolveStatusLaneField()` 仅在 Schema 或 lane 候选集中存在标准 `status` 列时才返回字段名称，否则返回 `null`，从而让自动建板流程跳过默认状态看板并改为弹出手动配置对话框。
- 待验证：重新加载含/不含 `status` 列的笔记，确认前者能生成默认状态看板且 laneField 正确，后者直接弹出建板面板，避免名称与字段不符。（完成修复后在同一条目更新验证记录。）
- 附加修复：为状态列的泳道值增加规范化（去掉空格、兼容大小写），`Todo` / `todo` / `to do`、`In Progress` / `inprogress` 等会合并为同一泳道并显示标准标签，避免看板上出现大小写/空格差异的重复泳道。需在含多种写法的示例笔记中确认拖拽、切换过滤视图后泳道仍保持去重。
