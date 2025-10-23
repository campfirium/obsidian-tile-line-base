# TileLineBase 重构规划

## 背景
- `src/main.ts` 约 880 行，聚合窗口上下文、视图切换、命令注册、配置存储等责任，维护成本高，认知负担大。
- `src/TableView.ts` 超 4500 行，既负责 Markdown 解析与 Schema 构建，又直接驱动 AG Grid、过滤视图、公式引擎和交互回调，耦合度极高。
- 现阶段缺少明确的分层与模块边界，影响可测试性、扩展性和团队协同效率。

## 重构原则
- **分层驱动**：按职责拆分为「插件编排」「数据解析」「视图渲染」「交互控制」等独立层，降低跨模块依赖。
- **渐进迭代**：每次拆分保持功能等价，阶段性跑通 `npm run build` 并在 Obsidian 中做手工回归。
- **可组合的服务**：倾向以类或工厂封装服务，通过依赖注入连接，而非共享全局状态。
- **记录与验证**：关键行为变更在 `specs/` 留存决策，并更新验证用例。

## 现状痛点

### main.ts
- 窗口上下文（`windowContexts`、`captureExistingWindows` 等）与视图协作耦合在一起，难以复用。
- 命令、菜单、事件注册散布在生命周期方法内，可读性差，也妨碍测试。
- `TileLineBaseSettings` 的读写与克隆逻辑插在主流程中，增加噪音。
- 多处工具函数（`describeLeaf`、`describeWindow`、`deepClone` 等）缺乏共享出口。

### TableView.ts
- Markdown 解析、Schema 推导、行数据合并等纯数据逻辑与 UI 操作混杂。
- 过滤视图与排序配置的 UI/状态管理占据大量代码，并且与表格主体共用状态字段。
- 公式编译、错误提示、行数限制散落在生命周期函数中，异常控制困难。
- 网格尺寸监听、聚焦管理、上下文菜单、全局 quick filter 等基础交互彼此耦合。
- 文件列宽偏好、过滤视图状态存储直接访问插件设置对象；缺乏统一接口。

## 目标架构草图

### 插件主流程（`src/main.ts` 拆分）
- `src/plugin/TileLineBasePlugin.ts`：保留官方 `Plugin` 子类，只协调各服务生命周期。
- `src/plugin/WindowContextManager.ts`：负责窗口注册、叶子遍历、上下文缓存，暴露获取/清理 API。
- `src/plugin/ViewSwitchCoordinator.ts`：封装自动切换、查找 Leaf、打开 TableView 的策略逻辑。
- `src/plugin/CommandsRegistrar.ts`、`src/plugin/FileMenuRegistrar.ts`：集中命令与菜单注册，向主插件提供 `register()` 接口。
- `src/plugin/SettingsService.ts`：封装 `TileLineBaseSettings` 读写与迁移，提供列宽、过滤视图等存取方法。
- `src/utils/obsidianDebug.ts`：收纳 `describeLeaf`、`describeWindow` 等调试工具。

### TableView 子系统（建议新增目录 `src/table-view/`）
- `TableViewFrame.ts`：继承 `ItemView`，处理 Obsidian 生命周期，与其余子模块做组合。
- 数据层
  - `MarkdownBlockParser.ts`：负责 H2 块解析、Key-Value 提取。
  - `SchemaBuilder.ts`：解析列配置、生成列元数据。
  - `ColumnLayoutStore.ts`：桥接 `SettingsService`，读写列宽、布局偏好。
- 网格层
  - `GridController.ts`：初始化/销毁 `GridAdapter`，处理单元格编辑、刷新。
  - `FocusManager.ts`：管理行焦点、Enter 新增行逻辑。
  - `SizeObserver.ts`：统一 ResizeObserver、视觉视口监听。
- 过滤与视图
  - `FilterViewBar.ts`：渲染过滤视图 tabs，管理切换。
  - `FilterRuleModal.ts`、`FilterSortModal.ts`：独立对话框逻辑与样式。
  - `FilterStateStore.ts`：封装 `FileFilterViewState` 的持久化与克隆。
- 公式相关
  - `FormulaRegistry.ts`：管理 `compileFormula`、错误缓存、行数限制提醒。
- 共享工具
  - `ContextMenuBuilder.ts`、`GlobalQuickFilterBus.ts`、`TableViewEvents.ts` 等，根据需要拆分。

## 迭代计划
1. **基础设施梳理**
   - 新建 `SettingsService`，迁移设置读写/克隆逻辑；更新主插件与 `TableView` 调用点。
   - 引入 `WindowContextManager`，负责 `registerWindow` 与 `captureExistingWindows`。
2. **视图切换解耦**
   - 实现 `ViewSwitchCoordinator`，迁移 `maybeSwitchToTableView`、`openTableView` 等函数。
   - 配合调整命令、事件注册，使主插件仅注入协调器。
3. **TableView 框架拆分**
   - 抽取 `TableViewFrame` 与 `GridController`，保持现有行为；构造组合注入。
   - 切换列宽读取到 `ColumnLayoutStore`。
4. **过滤视图模块化**
   - 拆出 `FilterStateStore`、`FilterViewBar`、`FilterRuleModal` 等，复用既有 UI 代码。
   - 重写与 `SettingsService` 的互操作。
5. **公式与数据解析**
   - 引入 `FormulaRegistry`，收编公式编译/缓存流程。
   - 拆出 `MarkdownBlockParser`、`SchemaBuilder`，为未来单测做准备。
6. **交互增强与清理**
   - 抽离聚焦、尺寸监听、上下文菜单等工具模块。
   - 统一调试日志前缀和工具函数出口。

> 每个阶段结束前运行 `npm run build`，并在 Obsidian 中完成最小手工回归（表格加载、过滤、编辑、公式算例）。

## 风险与缓解
- **行为回归**：拆分后可能遗漏事件注册或状态同步；通过阶段性回归与日志比对保证等价。
- **设置结构变化**：`SettingsService` 需要兼容旧数据，必要时增加版本号或迁移函数。
- **依赖循环**：模块划分需注意避免 `TableViewFrame` 与子模块互相引用，可通过接口定义与工厂模式解决。
- **构建路径调整**：新增目录后需确认打包路径与 `esbuild` 配置无冲突。

## 后续协同事项
- 和 UI/交互相关改动，提前告知设计/体验方确认主流程无感知变化。
- 若需新增依赖（例如状态管理库），先行评估插件运行环境安全性，并在 `README` 标注。
- 拆分完成后补充 `specs/` 记录的 Markdown 样例与验证手册，便于回归。

## 参考指标
- 单文件行数控制目标：主插件 < 300 行，`TableViewFrame` < 400 行，其余模块保持 < 200 行。
- 拆分完成后，可针对核心纯函数模块（解析、公式）补充单元测试脚手架。

