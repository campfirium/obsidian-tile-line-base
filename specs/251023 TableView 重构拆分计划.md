# TableView 剩余职责与拆分计划

## 残留职责梳理
- **生命周期与持久化**：`render`、`onOpen`、`loadConfig`、`saveConfigBlock`、`saveToFile` 协调 Markdown 解析、Schema 同步与配置写回。
- **布局与尺寸响应**：`setupResizeObserver`、`scheduleColumnResize`、`startSizePolling`、`updateTableContainerSize` 等处理容器、窗口、workspace 的尺寸变化以及列宽刷新。
- **行焦点管理**：`focusRow`、`scheduleFocusAttempt`、`attemptFocusOnPendingRow`、`handleFocusRetry`、`clearPendingFocus`、`handleGridModelUpdated` 维护新增/复制后的聚焦与重试。
- **表格数据刷新与筛选**：`refreshGridData`、`applyActiveFilterView`、`applyData`、`applySortModelToGrid`、`evaluateCondition` 负责 RowData 生成、过滤视图应用与 ag-grid 同步。
- **过滤视图与全局搜索**：`renderFilterViewControls`、`renderGlobalQuickFilter`、`onGlobalQuickFilterInput`、`cleanupGlobalQuickFilter` 等维持筛选 UI 与状态。
- **网格交互**：上下文菜单、快捷键、H2 复制（`setupContextMenu`、`showContextMenu`、`hideContextMenu`、`setupKeyboardShortcuts`、`copyH2Section`、`resolveBlockIndexesForCopy`）仍直接驻留在 TableView。
- **保存调度**：`scheduleSave`、`persistFilterViews`、`persistColumnStructureChange` 与 `saveConfigBlock` 之间的触发链尚未统一托管。

## 拆分路线
1. **GridInteractionController 收口**
   - 将 `setupContextMenu`、`showContextMenu`、`hideContextMenu`、`setupKeyboardShortcuts`、`copyH2Section`、`resolveBlockIndexesForCopy` 全量迁移。
   - TableView 保留薄封装（如 `addRow`/`deleteRow` 转发至 RowInteractionController）。

2. **布局/尺寸控制抽离**
   - 新建 `GridLayoutController`（命名待定），承载 `setupResizeObserver`、`scheduleColumnResize`、`startSizePolling`、`updateTableContainerSize`，并统一清理定时器与监听。
   - TableView 渲染时 `layoutController.attach(container)`，关闭时 `detach()`。

3. **FocusManager 管理聚焦重试**
   - 将 `focusRow` 及一系列 `scheduleFocusAttempt`、`attemptFocusOnPendingRow`、`handleFocusRetry`、`clearPendingFocus`、`handleGridModelUpdated` 迁入新模块，RowInteractionController 通过 FocusManager 完成焦点控制。

4. **过滤与全局搜索拆分**
   - 建立 `FilterViewOrchestrator` 整合 `refreshGridData`、`applyActiveFilterView`、`applyData`、`applySortModelToGrid`、`evaluateCondition`、`persistFilterViews` 等逻辑。
   - 建立 `GlobalQuickFilterController` 承载 `renderGlobalQuickFilter`、`onGlobalQuickFilterInput`、`applyGlobalQuickFilter`、`cleanupGlobalQuickFilter`、`reapplyGlobalQuickFilter` 等生命周期。

5. **持久化服务统一调度**
   - 新建 `TablePersistenceService` 封装 `loadConfig`、`saveConfigBlock`、`saveToFile`、`scheduleSave`、`persistColumnStructureChange` 与配置写回；由各控制器触发保存，而 TableView 仅协调服务输出。

6. **TableView 瘦身收尾**
   - 完成以上模块后，TableView 主要职责：生命周期调度、状态组合、与 FilterViewController/各控制器沟通。
   - 清理冗余字段与方法，确保核心逻辑由各控制器托管。

7. **验证与文档**
   - 每阶段保持 `npm run build` 通过，并在最终阶段进行完整的交互回归（上下文菜单、快捷键、过滤器、尺寸响应、保存流程）。
   - 更新必要的模块结构说明或在 `specs/` 补充后续变更记录；同时遵循 `AGENTS.md` 中的模块拆分与注释约束。
