# 251024 AgGridAdapter 拆分方案

## 背景
- 依据《251023 质量维度差距评估.md》，`AgGridAdapter` 体量超 1.6k 行，耦合列定义、事件桥接、编辑代理、列宽策略等多职责，已成为复杂度与可测试性瓶颈。
- 适配层是 `GridAdapter` 抽象的默认实现，后续仍需兼容 Obsidian Node 环境、10k 行数据压力、键盘/读屏可访问性等要求，拆分时必须保持对现有交互（回调、快捷键、输入法代理）的零回归。

## 现状诊断
- **职责糅杂**：生命周期管理、API 缓存、事件注册、列宽调整、输入法代理全部集中在同一类中，局部逻辑（如组合输入的 `CompositionProxy`）难以复用或单测。
- **隐式状态过多**：多个私有字段（`readyCallbacks`、`pendingEnterAtLastRow`、`proxyByDoc` 等）散落在类内，互相穿插调用，缺少模块化边界。
- **维护成本高**：任何事件流调整都会波及 clipboard、focus、column sizing 等不相干模块，PR 审查困难。
- **阻断替换策略**：`GridAdapter` 想要落地其他实现（如轻量虚拟表格）时，没有清晰的子模块接口可复用。

## 拆分原则
- **接口稳定**：对外继续暴露 `GridAdapter` 约定的方法签名与回调时机，拆分仅发生在 `src/grid/` 内部。
- **单一职责**：每个新模块聚焦一类行为（生命周期/列配置/事件桥接/交互代理），隐藏内部状态，暴露显式方法。
- **可替换性**：子模块命名遵循可扩展约定（例如 `AgGridColumnService`），方便未来衍生 TanStack 等实现时复用思路。
- **测试友好**：优先把纯逻辑（列定义、状态克隆、宽度算法）抽离到无 DOM 依赖的函数或类，为后续脚本测试留接口。
- **渐进落地**：拆分过程中保持构建与手工回归可执行，避免一次性大手术导致回退。

## 目标架构概览
| 模块 | 责任范围 | 关键对外接口 | 主要依赖 |
| --- | --- | --- | --- |
| `AgGridAdapter`（瘦身后） | 组合各子模块、实现 `GridAdapter` 接口 | `mount/updateData/...` | 下列 4 个子模块 |
| `AgGridLifecycleManager` | grid 初始化、销毁、API 缓存、`runWhenReady` 队列 | `mountGrid(container, options)`、`destroy()`、`onReady(cb)` | `ag-grid-community` |
| `AgGridColumnService` | 列定义生成、列状态持久化、列宽策略 | `buildColumnDefs(schema)`、`applyColumnState(state)`、`getColumnState()` | schema builder、`ColumnState` |
| `AgGridEventBridge` | 绑定/解绑 AG Grid 事件，统一上报 `GridAdapter` 回调 | `bindCallbacks(callbacks)`、`dispose()` | `GridApi`、`GridController` |
| `AgGridInteractionController` | 聚焦/选择、输入法代理、键盘/剪贴板、Enter/删除行为 | `enableInteractions()`、`disable()`、`handleSelection()` | DOM、`CompositionProxy` |
| （后续可选）`AgGridFilterAndSortService` | 快速过滤、排序模型同步 | `setQuickFilter(value)`、`setSortModel(model)` | `GridApi` |

> 说明：命名暂定，落地时可根据现有文件命名约定调整，重点是职责划分。

## 模块职责细化
- **AgGridLifecycleManager**
  - 负责 gridOptions 与容器的初始化、`gridApi/columnApi` 安全缓存、注销顺序。
  - 暴露 `withApi(cb)` 帮助其他模块安全访问 API，避免字段散落。
  - 集中处理 `ready`、`firstDataRendered` 等一次性事件。
- **AgGridColumnService**
  - 接收 `SchemaBuilder` 输出的列模型，生成 AG Grid `ColDef[]`，负责 i18n 文案注入。
  - 提供列宽策略（宽度克隆、稀疏分配、最小/最大宽度限定）为纯函数，方便单测。
  - 挂钩列顺序/宽度事件，触发外部回调（例如 `columnResizeCallback`）。
- **AgGridEventBridge**
  - 统一订阅 `cellEditingStopped`、`columnMoved`、`bodyScroll` 等事件，将数据结构转换成 `GridAdapter` 约定的事件对象。
  - 维护 `onModelUpdated`、`onEnterAtLastRow` 等回调注册；内部使用 `LifecycleManager` 提供的 API 访问能力。
- **AgGridInteractionController**
  - 管理 `CompositionProxy`、剪贴板、键盘导航、虚拟焦点（`focusedRowIndex/focusedColId`）。
  - 将现有的 `handleProxyKeyDown`、`handleCopyShortcut`、`handleDeleteKey` 等方法迁移到该类，提供最小可见 API（例如 `attach(container)` / `detach()`）。
  - 收拢 DOM 监听（viewport、window resize），与 Adapter 主类通过事件或方法通信。
- **AgGridFilterAndSortService（可选阶段）**
  - 抽离 `setQuickFilter`/`getFilterModel`/`setSortModel` 逻辑，避免在 Adapter 中直接操作 API。

## 渐进式落地计划
1. **Phase 0：基线准备**
   - 梳理现有回调使用点（`TableView`、`GridController`），列出不可回归的行为清单。
   - 为列宽算法、`cloneColumnState` 等纯函数补充快速单元测试或临时脚本，作为 guard。
2. **Phase 1：列定义与列状态拆分**
   - 新建 `src/grid/column/AgGridColumnService.ts`（或同级文件），迁移列构建、宽度克隆、状态应用逻辑。
   - `AgGridAdapter` 改为调用新服务，确保 `onColumnResize` / `columnOrderChangeCallback` 正常工作。
   - 验证：`npm run build`，手工检查列宽同步、列重排。
3. **Phase 2：生命周期管理抽离**
   - 引入 `AgGridLifecycleManager`，负责 `mount` 时创建 grid、缓存 `gridApi`、处理 `ready`。
   - Adapter 中的销毁、`runWhenReady`、`markLayoutDirty` 等改由新模块提供。
   - 验证：多次 mount/destroy（例如切换视图）不泄露事件。
4. **Phase 3：事件桥接模块化**
   - 将 `onCellEdit`、`onHeaderEdit`、`onModelUpdated`、`onEnterAtLastRow` 的事件订阅迁移至 `AgGridEventBridge`。
   - 统一事件解绑流程，减少 Adapter 内部的 `callback?()` 判断。
   - 验证：单元格编辑、表头重命名、Enter 自动增行。
5. **Phase 4：交互控制器抽离**
   - 把输入法代理、键盘导航、剪贴板逻辑移入 `AgGridInteractionController`。
   - Adapter 对外仅暴露配置入口（比如 `interactionController.attach(containerEl)`），其余内部通过桥接事件更新状态。
   - 验证：中文输入、复制粘贴、Delete 清除、焦点移动。
6. **Phase 5（可选）：过滤/排序服务**
   - 若前述阶段顺利，再独立 `FilterAndSortService`。若工作量较大，可放入后续任务。

> 每个 Phase 完成后均需更新 `docs/tasks/` 对应任务条目，并在 PR 中说明影响范围与回归项。

## 风险与对策
- **隐式依赖遗漏**：部分方法之间通过共享字段通信（如 `pendingEnterAtLastRow`），拆分时易遗漏。建议在迁移前画状态图或列出字段->方法映射。
- **输入法代理敏感**：`CompositionProxy` 与 DOM 强耦合，拆分时需保留当前捕获时序；可先编写迷你 demo/脚本确认输入场景。
- **Obsidian 环境差异**：桌面端 Node 环境下，AG Grid 交互与浏览器略有差异，拆分后要在 Obsidian 内回归（`npm run deploy`）。
- **回调顺序变更**：事件桥接模块化可能改变回调触发时机，需在 PR 中列出旧/新顺序对比，并通知使用方。

## 验证清单
- 指令：`npm run build`（lint 通过后再执行，保持零 warning）。
- 手工回归：视图切换、列宽调整、列拖拽、最后一行 Enter、Delete 清除、复制/粘贴、中文输入。
- 性能采样：10k 行 Markdown 数据场景，观察 `mount` 与连续编辑是否卡顿（可在 console 中添加临时 `console.time` 记录）。
- 可选：为列宽算法、状态克隆编写最小单元测试脚本，以便在 Phase 1/2 验证。

## 后续任务 & 资源
- 在 `tasks/` 下建立对应任务条目（如 `T0012_aggrid_refactor`），记录每个 Phase 的进展。
- 若拆分过程中发现硬编码字符串或日志，需要同步补全 `src/locales/` 与日志前缀规范。
- 拆分后的模块若复用率高，可考虑在 docs 中追加开发者说明，帮助后续替换网格实现。

## Phase 0 调研输出（2025-10-25）

### 回调映射与调用方
**Grid context 回调**

| 回调标识 | 触发位置 / 条件 | 注册链路 | 终端处理 | 备注 |
| --- | --- | --- | --- | --- |
| `context.onStatusChange` | `StatusCellRenderer.changeStatus` 成功切换状态时调用 | `TableViewRenderer` → `GridMountCoordinator` → `GridController.mount` → `AgGridAdapter.mount` | `TableViewInteractions.handleStatusChange` 更新数据并刷新视图 | 依赖 `gridContext` 透传，拆分后建议由事件桥接模块托管 |
| `context.onColumnResize` | `AgGridAdapter.handleColumnResized` 在受限列上触发，宽度归一化后调用 | 同上 | `TableViewInteractions.handleColumnResize`，同步列配置与持久化 | 与列宽策略解耦后应由 `AgGridColumnService` 统一触发 |
| `context.onCopyH2Section` | `handleCopyShortcut` 在 `#` 列 `Ctrl+C` 或 `onCellDoubleClicked` 时触发 | 同上 | `GridInteractionController.copySection`，执行整段复制 | 事件依赖 blockIndex 推导，拆分时需保留序号列语义 |
| `context.onColumnOrderChange` | `handleColumnMoved` 成功移动列且校验通过后触发 | 同上 | `TableViewInteractions.handleColumnOrderChange`，刷新列配置 | 与列状态持久化强耦合，建议由列服务集中管理 |

**GridAdapter 事件注册**

| 事件接口 | 触发入口 | 注册链路 | 终端处理 | 备注 |
| --- | --- | --- | --- | --- |
| `onCellEdit` | `handleCellEdit`（挂载 `onCellEditingStopped`） | `TableViewRenderer` → `GridMountCoordinator` → `GridController` | `TableViewInteractions.handleCellEdit` 更新数据、公式回填 | 现为核心回调，拆分后需保持事件顺序不变 |
| `onHeaderEdit` | 暂未触发（接口占位） | 同上，按需注册 | `TableViewInteractions.handleHeaderEditEvent`（预留） | 若未来启用须由事件桥接模块统一接管 |
| `onColumnHeaderContextMenu` | `gridOptions.onColumnHeaderContextMenu` | 同上 | `ColumnInteractionController.handleColumnHeaderContextMenu` | 依赖 `domEvent` 透传，拆分时注意事件解绑 |
| `onEnterAtLastRow` | `handleEnterAtLastRow` / `handleProxyEnter` 检测最后一行 `Enter` | 同上 | `RowInteractionController.addRow` 自动增行并聚焦 | 状态位 `pendingEnterAtLastRow` 同时被键盘代理使用，需协调交互模块 |
| `onModelUpdated` | `emitModelUpdated`（绑定 `onModelUpdated` & `onRowDataUpdated`） | 同上 | `FocusManager.handleGridModelUpdated` 调整焦点 | 生命周期模块需暴露统一的模型事件流 |
| `runWhenReady` | `gridOptions.onGridReady` 触发时 flush 队列 | 当前未在 TableView 中直接调用 | （保留） | 未来供延迟初始化使用，拆分时由生命周期模块维护 |

### 状态字段与拟拆分模块对照

| 字段 / 集合 | 当前职责 | 建议归属模块 | 耦合点 / 拆分注意 |
| --- | --- | --- | --- |
| `gridApi`, `columnApi`, `containerEl`, `ready`, `readyCallbacks`, `modelUpdatedCallbacks` | 缓存 AG Grid API、容器引用，管理 ready 队列与模型事件 | `AgGridLifecycleManager` | `setQuickFilter`、`setSortModel`、`applyColumnState` 均依赖 ready 队列，需提供 `withApi`/`onReady` 能力防止竞态 |
| `columnLayoutInitialized`, `columnResizeCallback`, `columnOrderChangeCallback`, `quickFilterText` | 控制列宽初始化、回调透传与 quick filter 记忆 | `AgGridColumnService`（列状态）+ `FilterAndSortService`（快速过滤） | `markLayoutDirty`/`resizeColumns` 共用 `columnLayoutInitialized`；过滤文案在 `applyColumnState` 后需重放，拆分时注意顺序 |
| `proxyByDoc`, `focusedDoc`, `focusedRowIndex`, `focusedColId`, `pendingCaptureCancel`, `editing`, `pendingEnterAtLastRow`, `proxyRealignTimer`, `viewportListenerCleanup` | 组合输入代理、键盘导航、剪贴板、视口监听 | `AgGridInteractionController` | `pendingEnterAtLastRow` 同时被事件桥接读取；`viewportListenerCleanup` 与生命周期解绑流程相互依赖 |
| `gridContext`, `cellEditCallback`, `headerEditCallback`, `columnHeaderContextMenuCallback`, `enterAtLastRowCallback` | 对外回调聚合，封装调用层协作 | `AgGridEventBridge` | `gridContext` 目前直接由渲染器读取，拆分后需提供只读访问或事件封装 |

### 纯函数验证草案
- `cloneColumnState` / `deepClone`：编写最小 Jest/Vitest 单测，验证 `null` 透传、不共享引用、排序字段保持原样。可放置于 `tests/grid/columnState.test.ts`。
- `applyWidthClamping`：使用模拟的 `Column` 对象（实现 `getColId/getActualWidth/isResizable`）验证最小/最大宽度边界；同时断言不会对 `#`、`status` 列调用 `setColumnWidths`。
- `distributeSparseSpace`：构造容器宽度与可调整列集合，断言宽度补偿总和等于剩余空间且不会超过 `COLUMN_MAX_WIDTH`；补充零宽/不可调整列的回退用例。
- `setSortModel` 快速验证脚本：伪造 `columnApi.applyColumnState`，确保排序字段转换为 `{ colId, sort, sortIndex }` 并清除默认排序。
- 以上脚本可先放置在 `scripts/dev/verify-column-sizing.ts`，待测试框架落地后迁移为正式单测。

### 交互回归脚本基线
1. **输入法捕获**：在正文列聚焦后使用中文拼音输入，确认候选选择一次性写入且不会触发重复字符；在 pop-out 窗口复测，确保 `CompositionProxy` 仍可捕获（参考 `AgGridAdapter.armProxyForCurrentCell` 流程）。
2. **剪贴板**：普通列 `Ctrl+C` 复制单元格文本；在 `#` 列按 `Ctrl+C` 或双击验证整段 Markdown 复制；在无权限环境下验证退回 `execCommand` 分支提示日志。
3. **快捷键导航**：`Enter` / `Shift+Enter` 垂直移动；最后一行 `Enter` 触发自动增行；`Tab`/`Shift+Tab`、方向键移动保持焦点状态；`Delete/Backspace` 清空非保留列并保持状态列安全。
4. **焦点与代理同步**：通过鼠标/键盘切换单元格后，确认组合输入代理随之重定位（`requestProxyRealign`）；窗口尺寸变化后验证代理、列宽同时刷新。

### i18n 梳理
- 当前 `AgGridAdapter` 仅依赖 `agGrid.*` 相关文案（`editorInputMissing`、`documentBodyUnavailable`、`editorWaitTimeout`、`compositionCaptureFailed`、`copyFailed`），`src/locales/en.json` 与 `zh.json` 均已覆盖。
- 列宽服务/事件桥接拆分后应复用现有 key，避免在子模块中硬编码字符串；若新增提示（例如列宽调试日志、过滤提示），需同步更新 `i18n/index.ts` 与两份 locale 文件。
- 新增模块日志须沿用统一前缀（建议 `[AgGridLifecycle]`、`[AgGridColumn]` 等），便于在 Obsidian 控制台筛选并在翻译文案中保持一致。

## Phase 1 执行记录（2025-10-25）

- 新增 `src/grid/column/AgGridColumnService.ts`，承接列定义组装、列宽初始化、筛选列名单与列状态持久化；对外暴露 `configureCallbacks/attachApis/resizeColumns/markLayoutDirty` 等接口。
- `AgGridAdapter` 精简列相关私有字段，改为通过列服务委派 `buildColumnDefs`、`resizeColumns`、`setSortModel`、`applyColumnState` 与 `setQuickFilter`。
- 销毁流程统一调用列服务的 `detachApis` 与 `configureCallbacks(undefined)`，避免遗留回调引用；`markLayoutDirty` 仅负责触发交互代理重对齐。
- `npm run build`：TypeScript 编译通过，但 `esbuild` 在 WSL 下因二进制与平台不匹配退出（`@esbuild/win32-x64`）。需在正式环境重新安装依赖或使用本地 Windows Node 环境验证产物。

