# T0001 - AgGrid adapter refactor

## Context
- Spec: `specs/251024 AgGridAdapter 拆分方案.md`
- Trigger: `AgGridAdapter` 现状复杂度与测试性不足，需要拆分落地

## Phase 0 checklist
- [x] 列出 `AgGridAdapter` 对外回调与调用方（`TableView`、`GridController` 等）映射关系（见 `specs/251024 AgGridAdapter 拆分方案.md`“Phase 0 调研输出 / 回调映射与调用方”）
- [x] 整理内部状态字段 -> 功能模块对应表，识别潜在耦合点（同上“状态字段与拟拆分模块对照”）
- [x] 为列宽算法、`cloneColumnState` 等纯函数准备最小验证脚本或单测草案（同上“纯函数验证草案”）
- [x] 盘点现有输入法、剪贴板、快捷键的手工回归脚本，确认保留范围（同上“交互回归脚本基线”）
- [x] 评估拆分过程中需要同步更新的 i18n 字段与文档（同上“i18n 梳理”）

## Phase 1 progress
- [x] 列服务抽离：`src/grid/column/AgGridColumnService.ts` 提供列定义、列宽初始化、列状态与排序管理；`AgGridAdapter` 通过该服务委派 `resizeColumns`、`setSortModel`、`applyColumnState`、`setQuickFilter`。
- [x] 销毁与回调解绑逻辑收敛到列服务，`AgGridAdapter` 不再维护 `columnApi`/`columnLayoutInitialized` 等字段。
- [ ] 回归验证：需在 Windows 原生环境重新执行 `npm run build`（WSL 当前因 `@esbuild/win32-x64` 二进制不匹配失败），并补充列服务最小测试脚本。

## Notes
- 完成 Phase 0 后，再将拆分任务拆解为 Phase 1-5 的子任务条目
- 所有结论与验证记录回填至 `specs/251024 AgGridAdapter 拆分方案.md` 或新增 specs 文档
